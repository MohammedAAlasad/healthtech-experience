/*
 * HealthTech Experience — shared.js (used by every booth and the dashboard).
 * Global functions: startCheckIn, getParticipant, register, saveScore, getLeaderboard, grade, patientTurn, patientGrade, htMakeId.
 * Vanilla JS, no dependencies.
 */

// ▼▼▼ Paste the Apps Script Web App URL here (it ends with /exec). Empty string = MOCK MODE. ▼▼▼
const API_URL = "https://script.google.com/macros/s/AKfycbzDyvGIYVkOT54iKVp5ACUlGRtv6ivV1n1zikpW2rZQ9HapE-Kc_gXOLspS2WifXNEnnQ/exec";
// ▲▲▲ ------------------------------------------------------------------------------------- ▲▲▲

const HT_TIMEOUT_MS = 15000;       // all calls except grade()
const HT_GRADE_TIMEOUT_MS = 45000; // grade(): Gemini can be slow, especially with images
const HT_RETRY_MS = 15000;
const HT_QUEUE_KEY = "pendingScores";
const HT_MOCK_DB_KEY = "htMockDb";
const HT_BOOTHS = ["booth01", "booth02", "booth03", "booth04", "booth05", "booth06"];
const HT_MAX_POINTS = { booth01: 100, booth02: 100, booth03: 30, booth04: 100, booth05: 10, booth06: 40 };
const HT_LEADERBOARD_BOOTHS = ["booth03", "booth06", "booth05"];
const HT_LEADERBOARD_INFO = { booth05: ["caseId", "outcomeTier", "durationS"] }; // extra fields in perBooth entries
const HT_NAME_MAX = 60;

const HT_MOCK = (function () {
  try {
    return !API_URL || new URLSearchParams(location.search).get("mock") === "1";
  } catch (e) {
    return true;
  }
})();

let _htLastCheckIn = null; // {studentId, name} from the most recent startCheckIn

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

class HtError extends Error {
  /** kind: "network" (retryable) or "server" (the server rejected the request) */
  constructor(message, kind) {
    super(message);
    this.name = "HtError";
    this.kind = kind;
  }
}

/** Unique id. crypto.randomUUID only exists on https/localhost, so fall back to getRandomValues. */
function htMakeId() {
  try {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

function _htCleanName(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function _htValidId(id) {
  return /^\d{6,12}$/.test(String(id == null ? "" : id));
}

function _htSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _htEl(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Same rules as the server; throws HtError("server") so invalid scores are never queued. */
function _htValidateScore(studentId, booth, points) {
  if (!_htValidId(studentId)) throw new HtError("studentId must be 6-12 digits.", "server");
  if (!HT_BOOTHS.includes(booth)) throw new HtError("booth must be one of booth01..booth06.", "server");
  if (typeof points !== "number" || !isFinite(points)) throw new HtError("points must be a number.", "server");
  if (points < 0 || points > 100) throw new HtError("points must be between 0 and 100.", "server");
  if (points > HT_MAX_POINTS[booth]) throw new HtError("points for " + booth + " must be at most " + HT_MAX_POINTS[booth] + ".", "server");
}

/* ------------------------------------------------------------------ */
/* Network layer                                                       */
/* ------------------------------------------------------------------ */

async function _htRequest(method, params, body, timeoutMs = HT_TIMEOUT_MS) {
  if (HT_MOCK) return _htMockHandle(method === "GET" ? params : body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      if (method === "GET") {
        const sep = API_URL.includes("?") ? "&" : "?";
        res = await fetch(API_URL + sep + new URLSearchParams(params), { signal: ctrl.signal, redirect: "follow" });
      } else {
        res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain = no CORS preflight
          body: JSON.stringify(body),
          signal: ctrl.signal,
          redirect: "follow"
        });
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new HtError("The server took too long to answer (" + timeoutMs / 1000 + " s). Check the Wi-Fi and try again.", "network");
      }
      throw new HtError("Can't reach the server. Check the Wi-Fi connection.", "network");
    }
    if (!res.ok) throw new HtError("The server answered with an error (HTTP " + res.status + "). Please try again.", "network");
    let data;
    try {
      data = await res.json();
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new HtError("The server took too long to answer (" + timeoutMs / 1000 + " s). Check the Wi-Fi and try again.", "network");
      }
      throw new HtError("The server sent an unexpected answer. Check that API_URL is the Web App URL ending in /exec.", "network");
    }
    if (data && data.error) throw new HtError(data.error, "server");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** -> {found:boolean, name?:string} */
async function getParticipant(studentId) {
  return _htRequest("GET", { action: "participant", studentId: String(studentId) });
}

/** Creates or updates a participant. -> {ok, created, name} */
async function register(studentId, name) {
  return _htRequest("POST", null, { action: "register", studentId: String(studentId), name: _htCleanName(name) });
}

/**
 * Saves a score. -> {counted:boolean, points} on success,
 * or {queued:true, counted:null, points, error} when offline (it will be retried automatically).
 * Throws HtError (kind "server") if the score is invalid.
 */
async function saveScore(studentId, booth, points, details) {
  studentId = String(studentId);
  _htValidateScore(studentId, booth, points);
  const d = Object.assign({}, details || {});
  if (!d.attemptId) d.attemptId = htMakeId();
  const item = { studentId, booth, points, details: d };
  if (_htLastCheckIn && _htLastCheckIn.studentId === studentId) item.name = _htLastCheckIn.name;
  try {
    const r = await _htSendScore(item);
    _htFlushQueue();
    return r;
  } catch (err) {
    if (err.kind === "server") throw err;
    _htQueuePush(item);
    return { queued: true, counted: null, points, error: err.message };
  }
}

/** -> {updatedAt,totalParticipants,top:[...],perBooth:{booth03:[...],booth06:[...]}} */
async function getLeaderboard() {
  return _htRequest("GET", { action: "leaderboard" });
}

/**
 * AI grading through the backend (Gemini). Resolves with the model's parsed JSON answer.
 * imageBase64 may be raw base64 or a data: URL; mimeType e.g. "image/jpeg".
 */
async function grade(prompt, imageBase64, mimeType) {
  const body = { action: "grade", prompt: String(prompt) };
  if (imageBase64) {
    body.imageBase64 = imageBase64;
    body.mimeType = mimeType;
  }
  const r = await _htRequest("POST", null, body, HT_GRADE_TIMEOUT_MS);
  return r.result;
}

/**
 * Booth 05: one virtual-patient reply. body: {caseId, lang, prompt, leakTerms}. -> {ok, reply, leaked, model}
 * Waits at most 15 s (the page then answers from its scripted patient). Rejects in mock mode.
 */
async function patientTurn(body) {
  return _htRequest("POST", null, Object.assign({}, body, { action: "patientTurn" }), HT_TIMEOUT_MS);
}

/** Booth 05: grading. body: {caseId, prompt}. Resolves with the model's parsed JSON. Waits up to 45 s. */
async function patientGrade(body) {
  const r = await _htRequest("POST", null, Object.assign({}, body, { action: "patientGrade" }), HT_GRADE_TIMEOUT_MS);
  return r.result;
}

function _htSendScore(item) {
  const body = { action: "score", studentId: item.studentId, booth: item.booth, points: item.points, details: item.details };
  if (item.name) body.name = item.name;
  return _htRequest("POST", null, body);
}

/* ------------------------------------------------------------------ */
/* Offline queue                                                       */
/* ------------------------------------------------------------------ */

function _htQueueRead() {
  try {
    const q = JSON.parse(localStorage.getItem(HT_QUEUE_KEY) || "[]");
    return Array.isArray(q) ? q : [];
  } catch (e) {
    return [];
  }
}

function _htQueueWrite(q) {
  localStorage.setItem(HT_QUEUE_KEY, JSON.stringify(q));
  _htUpdateBadges();
}

function _htQueuePush(item) {
  const q = _htQueueRead();
  if (!q.some((x) => x.details && x.details.attemptId === item.details.attemptId)) q.push(item);
  _htQueueWrite(q);
}

function _htQueueRemove(attemptId) {
  _htQueueWrite(_htQueueRead().filter((x) => !(x.details && x.details.attemptId === attemptId)));
}

let _htFlushing = false;
async function _htFlushQueue() {
  if (_htFlushing) return;
  _htFlushing = true;
  try {
    for (const item of _htQueueRead()) {
      try {
        await _htSendScore(item);
        _htQueueRemove(item.details.attemptId);
      } catch (err) {
        if (err.kind === "server") {
          console.warn("Dropping a queued score the server rejected:", err.message, item);
          _htQueueRemove(item.details.attemptId);
        } else {
          break; // still offline; try again later
        }
      }
    }
  } finally {
    _htFlushing = false;
    _htUpdateBadges();
  }
}

/* ------------------------------------------------------------------ */
/* Check-in form                                                       */
/* ------------------------------------------------------------------ */

/**
 * Operator form: University ID + Name + Start.
 * onReady({studentId, name}) is called after a 1 s welcome message.
 * options: {title, welcomePrefix ("Dr. "), subtitle}
 */
function startCheckIn(container, onReady, options) {
  options = options || {};
  _htInit();
  container.textContent = "";

  const idInput = _htEl("input", {
    id: "ht-id", class: "ht-input", type: "text", inputmode: "numeric", pattern: "[0-9]*",
    autocomplete: "off", maxlength: "12", placeholder: "e.g. 2210001234", "aria-describedby": "ht-id-err"
  });
  const nameInput = _htEl("input", {
    id: "ht-name", class: "ht-input", type: "text", autocomplete: "off", maxlength: String(HT_NAME_MAX),
    placeholder: "Full name", "aria-describedby": "ht-name-err"
  });
  const idErr = _htEl("div", { id: "ht-id-err", class: "ht-err", role: "alert" });
  const nameErr = _htEl("div", { id: "ht-name-err", class: "ht-err", role: "alert" });
  const status = _htEl("div", { class: "ht-status", "aria-live": "polite" });
  const btn = _htEl("button", { class: "ht-btn", type: "submit", text: "Start" });

  const form = _htEl("form", { class: "ht-checkin", novalidate: true },
    _htEl("h2", { class: "ht-title", text: options.title || "Participant check-in" }),
    options.subtitle ? _htEl("p", { class: "ht-sub", text: options.subtitle }) : null,
    _htEl("label", { class: "ht-label", for: "ht-id", text: "University ID" }), idInput, idErr,
    _htEl("label", { class: "ht-label", for: "ht-name", text: "Name" }), nameInput, nameErr,
    status, btn
  );
  container.appendChild(form);
  setTimeout(() => idInput.focus(), 0);

  let lookupTimer = null;
  let lookupSeq = 0;

  idInput.addEventListener("input", () => {
    const digits = idInput.value.replace(/\D/g, "");
    if (digits !== idInput.value) idInput.value = digits;
    idErr.textContent = "";
    status.textContent = "";
    clearTimeout(lookupTimer);
    if (!_htValidId(digits)) return;
    lookupTimer = setTimeout(async () => {
      const seq = ++lookupSeq;
      status.textContent = "Looking up…";
      try {
        const r = await Promise.race([getParticipant(digits), _htSleep(5000).then(() => null)]);
        if (seq !== lookupSeq || idInput.value !== digits) return;
        if (r && r.found) {
          if (!nameInput.value.trim() || nameInput.dataset.autofilled === "1") {
            nameInput.value = r.name;
            nameInput.dataset.autofilled = "1";
          }
          status.textContent = "Returning participant: name filled in (you can edit it).";
        } else {
          status.textContent = r ? "New participant." : "";
        }
      } catch (err) {
        if (seq === lookupSeq) status.textContent = ""; // offline: just type the name
      }
    }, 350);
  });

  nameInput.addEventListener("input", () => {
    nameInput.dataset.autofilled = "0";
    nameErr.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    const id = idInput.value.trim();
    const name = _htCleanName(nameInput.value);
    let ok = true;
    if (!_htValidId(id)) {
      idErr.textContent = "Enter a University ID of 6 to 12 digits.";
      ok = false;
    }
    if (!name) {
      nameErr.textContent = "Enter the participant's name.";
      ok = false;
    } else if (name.length > HT_NAME_MAX) {
      nameErr.textContent = "Name must be at most " + HT_NAME_MAX + " characters.";
      ok = false;
    }
    if (!ok) {
      (!_htValidId(id) ? idInput : nameInput).focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = "Starting…";
    // Don't block the player: wait for the server at most 3 s, then continue anyway.
    const reg = register(id, name).then(
      () => ({ ok: true }),
      (err) => (err.kind === "server" ? { serverError: err } : { offline: true })
    );
    const r = await Promise.race([reg, _htSleep(3000).then(() => ({ slow: true }))]);
    if (r.serverError) {
      status.textContent = r.serverError.message;
      btn.disabled = false;
      btn.textContent = "Start";
      return;
    }

    _htLastCheckIn = { studentId: id, name };
    container.textContent = "";
    container.appendChild(_htEl("div", { class: "ht-welcome", text: "Welcome " + (options.welcomePrefix || "") + name }));
    setTimeout(() => onReady({ studentId: id, name }), 1000);
  });
}

/* ------------------------------------------------------------------ */
/* Badges & styles                                                     */
/* ------------------------------------------------------------------ */

let _htInitDone = false;
function _htInit() {
  if (_htInitDone || typeof document === "undefined" || !document.body) return;
  _htInitDone = true;
  const css = `
  .ht-checkin{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:10px;font-size:1.25rem}
  .ht-title{font-size:2rem;margin:0 0 4px}
  .ht-sub{margin:0 0 8px;opacity:.8}
  .ht-label{font-weight:700;font-size:1.3rem;margin-top:8px}
  .ht-input{font-size:1.8rem;min-height:64px;padding:8px 16px;border:3px solid #9ab;border-radius:12px;width:100%;box-sizing:border-box}
  .ht-input:focus{outline:none;border-color:#0a7e8c;box-shadow:0 0 0 4px rgba(10,126,140,.25)}
  .ht-err{color:#b00020;min-height:1.4em;font-weight:600}
  .ht-status{min-height:1.4em;opacity:.85}
  .ht-btn{font-size:1.8rem;min-height:72px;border:0;border-radius:14px;background:#0a7e8c;color:#fff;font-weight:800;cursor:pointer;margin-top:8px}
  .ht-btn:disabled{opacity:.6;cursor:wait}
  .ht-welcome{font-size:clamp(2rem,6vw,4rem);font-weight:800;text-align:center;padding:15vh 16px}
  .ht-badge{position:fixed;z-index:9999;font:700 14px/1.2 system-ui,sans-serif;padding:6px 10px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none}
  .ht-badge-mock{left:8px;bottom:8px;background:#ffd600;color:#000}
  .ht-badge-queue{right:8px;bottom:8px;background:#ff6d00;color:#fff}
  `;
  document.head.appendChild(_htEl("style", { text: css }));
  if (HT_MOCK) document.body.appendChild(_htEl("div", { class: "ht-badge ht-badge-mock", text: "MOCK MODE" }));
  document.body.appendChild(_htEl("div", { id: "ht-queue-badge", class: "ht-badge ht-badge-queue", hidden: true }));
  _htUpdateBadges();
  _htFlushQueue();
  setInterval(_htFlushQueue, HT_RETRY_MS);
  window.addEventListener("online", _htFlushQueue);
  window.addEventListener("storage", (e) => { if (e.key === HT_QUEUE_KEY) _htUpdateBadges(); });
}

function _htUpdateBadges() {
  if (typeof document === "undefined") return;
  const b = document.getElementById("ht-queue-badge");
  if (!b) return;
  const n = _htQueueRead().length;
  b.hidden = n === 0;
  b.textContent = n + " unsent score" + (n === 1 ? "" : "s") + " — retrying every 15 s";
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _htInit);
  else _htInit();
}

/* ------------------------------------------------------------------ */
/* MOCK MODE: fake backend in localStorage, same rules as Code.gs      */
/* Console helper: htMockOffline(true) simulates a Wi-Fi drop.         */
/* ------------------------------------------------------------------ */

function htMockOffline(on) {
  localStorage.setItem("htMockOffline", on ? "1" : "0");
  return "Mock offline = " + !!on;
}

function htMockReset() {
  localStorage.removeItem(HT_MOCK_DB_KEY);
  localStorage.removeItem(HT_QUEUE_KEY);
  _htUpdateBadges();
  return "Mock data reset";
}

function _htMockDb() {
  let db = null;
  try { db = JSON.parse(localStorage.getItem(HT_MOCK_DB_KEY) || "null"); } catch (e) { db = null; }
  if (!db || !db.participants || !Array.isArray(db.scores)) {
    db = { participants: {}, scores: [] };
    const demo = [
      ["999000101", "Sara Alqahtani", 25, 36], ["999000102", "Omar Alharbi", 30, 31],
      ["999000103", "Lama Alotaibi", 20, 38], ["999000104", "Faisal Alzahrani", 10, 29],
      ["999000105", "Noura Alshehri", 30, null], ["999000106", "Yousef Almutairi", null, 33],
      ["999000107", "Reem Aldossary", 15, 22], ["999000108", "Khalid Alghamdi", 20, 18]
    ];
    const t0 = Date.now() - 3600 * 1000;
    const demo5 = { "999000101": [8.5, "case01", "healed", 262], "999000103": [6, "case02", "improved", 291], "999000106": [4.5, "case03", "worse", 300] };
    demo.forEach(([id, name, b3, b6], i) => {
      db.participants[id] = { name, registeredAt: new Date(t0 + i * 60000).toISOString() };
      if (b3 != null) db.scores.push({ time: t0 + i * 60000 + 1000, studentId: id, name, booth: "booth03", points: b3, counted: true, details: { attemptId: "demo-3-" + id } });
      if (b6 != null) db.scores.push({ time: t0 + i * 60000 + 2000, studentId: id, name, booth: "booth06", points: b6, counted: true, details: { attemptId: "demo-6-" + id } });
      const d5 = demo5[id];
      if (d5) db.scores.push({ time: t0 + i * 60000 + 3000, studentId: id, name, booth: "booth05", points: d5[0], counted: true,
        details: { attemptId: "demo-5-" + id, caseId: d5[1], outcomeTier: d5[2], durationS: d5[3] } });
    });
    localStorage.setItem(HT_MOCK_DB_KEY, JSON.stringify(db));
  }
  return db;
}

async function _htMockHandle(req) {
  await _htSleep(150);
  if (localStorage.getItem("htMockOffline") === "1") {
    throw new HtError("Can't reach the server. Check the Wi-Fi connection.", "network");
  }
  const db = _htMockDb();
  const save = () => localStorage.setItem(HT_MOCK_DB_KEY, JSON.stringify(db));
  const fail = (m) => { throw new HtError(m, "server"); };
  const id = String(req.studentId == null ? "" : req.studentId);
  switch (req.action) {
    case "ping":
      return { ok: true, time: new Date().toISOString(), mock: true };
    case "participant": {
      if (!_htValidId(id)) fail("studentId must be 6-12 digits.");
      const p = db.participants[id];
      return p ? { found: true, name: p.name } : { found: false };
    }
    case "register": {
      if (!_htValidId(id)) fail("studentId must be 6-12 digits.");
      const nm = _htCleanName(req.name);
      if (!nm) fail("name is required.");
      if (nm.length > HT_NAME_MAX) fail("name must be at most " + HT_NAME_MAX + " characters.");
      const created = !db.participants[id];
      db.participants[id] = { name: nm, registeredAt: created ? new Date().toISOString() : db.participants[id].registeredAt };
      save();
      return { ok: true, created, name: nm };
    }
    case "score": {
      _htValidateScore(id, req.booth, req.points);
      const details = req.details || {};
      if (details.attemptId) {
        const dup = db.scores.find((s) => s.details && s.details.attemptId === details.attemptId);
        if (dup) return { counted: dup.counted, points: dup.points, duplicate: true };
      }
      let name = db.participants[id] ? db.participants[id].name : "";
      if (!name) {
        const given = _htCleanName(req.name).slice(0, HT_NAME_MAX);
        if (given) {
          db.participants[id] = { name: given, registeredAt: new Date().toISOString() };
          name = given;
        }
      }
      const counted = !db.scores.some((s) => s.studentId === id && s.booth === req.booth);
      db.scores.push({ time: Date.now(), studentId: id, name, booth: req.booth, points: req.points, counted, details });
      save();
      return { counted, points: req.points };
    }
    case "leaderboard":
      return _htBuildLeaderboard(db);
    case "grade":
      if (!String(req.prompt || "").trim()) fail("prompt is required.");
      return { ok: true, result: { mock: true, score: 7, maxScore: 10, feedback: "Mock grading: connect API_URL for real Gemini grading." } };
    case "patientTurn":
    case "patientGrade":
      fail("AI is not available in mock mode.");
      break;
    default:
      fail("Unknown action.");
  }
}

function _htBuildLeaderboard(db) {
  const players = {};
  const boothEntries = {};
  HT_LEADERBOARD_BOOTHS.forEach((b) => (boothEntries[b] = []));
  for (const s of db.scores) {
    if (!s.counted) continue;
    const name = (db.participants[s.studentId] && db.participants[s.studentId].name) || s.name || "";
    const p = players[s.studentId] || (players[s.studentId] = { id: s.studentId, name, total: 0, perBooth: {}, last: 0 });
    p.total += s.points;
    p.perBooth[s.booth] = (p.perBooth[s.booth] || 0) + s.points;
    p.last = Math.max(p.last, s.time);
    if (boothEntries[s.booth]) {
      const e = { id: s.studentId, name, points: s.points, t: s.time };
      const keys = HT_LEADERBOARD_INFO[s.booth];
      if (keys) {
        e.info = {};
        for (const k of keys) {
          const v = s.details && s.details[k];
          if ((typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.length <= 24)) e.info[k] = v;
        }
      }
      boothEntries[s.booth].push(e);
    }
  }
  const top = Object.values(players)
    .sort((a, b) => b.total - a.total || a.last - b.last)
    .slice(0, 20)
    .map((p, i) => ({
      rank: i + 1, name: p.name, idLast4: p.id.slice(-4), total: p.total,
      perBooth: Object.fromEntries(HT_LEADERBOARD_BOOTHS.map((b) => [b, p.perBooth[b] || 0]))
    }));
  const perBooth = {};
  HT_LEADERBOARD_BOOTHS.forEach((b) => {
    perBooth[b] = boothEntries[b]
      .sort((x, y) => y.points - x.points || x.t - y.t)
      .slice(0, 10)
      .map((e, i) => Object.assign({ rank: i + 1, name: e.name, idLast4: e.id.slice(-4), points: e.points }, e.info ? { info: e.info } : {}));
  });
  return { updatedAt: new Date().toISOString(), totalParticipants: Object.keys(db.participants).length, top, perBooth, mock: true };
}
