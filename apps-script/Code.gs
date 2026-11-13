/**
 * HealthTech Experience — shared score backend (Google Apps Script web app).
 *
 * Bound to a Google Sheet. Creates two tabs if missing:
 *   Participants: studentId | name | registeredAt
 *   Scores:       time | studentId | name | booth | points | counted | details
 *
 * GET  ?action=ping | participant&studentId= | leaderboard
 * POST (JSON body, sent as Content-Type: text/plain)
 *      {action:"register", studentId, name}
 *      {action:"score", studentId, booth, points, details, name?}
 *      {action:"grade", prompt, imageBase64?, mimeType?}
 *      {action:"patientTurn", caseId, lang, prompt, leakTerms}   (Booth 05: one virtual-patient reply)
 *      {action:"patientGrade", caseId, prompt}                   (Booth 05: grading JSON)
 *
 * Gemini models: CONFIG.GEMINI_MODEL (strongest; Booth 03 "grade" and Booth 05 "patientGrade"),
 * CONFIG.GEMINI_CHAT_MODEL (fast and cheap; Booth 05 "patientTurn"). The Booth 05 actions retry once on
 * 429/5xx, then try CONFIG.GEMINI_FALLBACK_MODELS in order; if all fail the page uses its scripted patient.
 *
 * Secrets: the Gemini key lives ONLY in Project Settings > Script Properties > GEMINI_API_KEY.
 * Manual-only maintenance: run clearTestData() from the editor (not reachable from the web).
 */

const CONFIG = {
  // Copy the current Flash model name from aistudio.google.com (e.g. the model id shown in AI Studio).
  GEMINI_MODEL: "gemini-3.8-flash",
  // Booth 05. Leave a "REPLACE_..." value to skip that slot. See booth05/DEPLOY.md.
  GEMINI_CHAT_MODEL: "REPLACE_WITH_FAST_CHAT_MODEL_FROM_AI_STUDIO",
  GEMINI_FALLBACK_MODELS: ["REPLACE_WITH_FALLBACK_MODEL_1", "REPLACE_WITH_FALLBACK_MODEL_2"],
  CHAT_BUDGET_MS: 10000,    // stop trying new models after this (the page waits 15 s, then answers from its script)
  GRADE_BUDGET_MS: 35000,   // the page waits 45 s for patientGrade
  RETRY_SLEEP_MS: 800,
  PATIENT_PROMPT_MAX_CHARS: 24000,
  PATIENT_MAX_WORDS: 35,
  BOOTHS: ["booth01", "booth02", "booth03", "booth04", "booth05", "booth06"],
  MAX_POINTS: { booth01: 100, booth02: 100, booth03: 30, booth04: 100, booth05: 10, booth06: 40 },
  LEADERBOARD_BOOTHS: ["booth03", "booth06", "booth05"],
  // Extra fields copied from the score details into the per-booth top list (short strings / numbers only).
  LEADERBOARD_INFO: { booth05: ["caseId", "outcomeTier", "durationS"] },
  TOP_N: 20,
  PER_BOOTH_N: 10,
  NAME_MAX: 60,
  DETAILS_MAX_CHARS: 5000,
  PROMPT_MAX_CHARS: 20000,
  IMAGE_MAX_BASE64_CHARS: 7000000, // ~5 MB image
  TEST_ID_PREFIX: "999",
  LOCK_WAIT_MS: 20000
};

const SHEET_PARTICIPANTS = "Participants";
const SHEET_SCORES = "Scores";
const P_HEADERS = ["studentId", "name", "registeredAt"];
const S_HEADERS = ["time", "studentId", "name", "booth", "points", "counted", "details"];
// Column indexes (0-based) inside each tab
const P = { ID: 0, NAME: 1, AT: 2 };
const S = { TIME: 0, ID: 1, NAME: 2, BOOTH: 3, POINTS: 4, COUNTED: 5, DETAILS: 6 };

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  return respond_(function () {
    const p = (e && e.parameter) || {};
    switch (p.action) {
      case "ping":
        return { ok: true, time: new Date().toISOString() };
      case "participant":
        return getParticipant_(p.studentId);
      case "leaderboard":
        return leaderboard_();
      default:
        throw userError_("Unknown action.");
    }
  });
}

function doPost(e) {
  return respond_(function () {
    let body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || "");
    } catch (err) {
      throw userError_("Request body must be JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw userError_("Request body must be a JSON object.");
    }
    switch (body.action) {
      case "register":
        return withLock_(function () { return register_(body.studentId, body.name); });
      case "score":
        return withLock_(function () { return score_(body); });
      case "grade":
        return grade_(body);
      case "patientTurn":
        return patientTurn_(body);
      case "patientGrade":
        return patientGrade_(body);
      default:
        throw userError_("Unknown action.");
    }
  });
}

/** Run once from the editor to create the tabs and trigger the authorization prompt. */
function setup() {
  sheet_(SHEET_PARTICIPANTS, P_HEADERS, P.ID);
  sheet_(SHEET_SCORES, S_HEADERS, S.ID);
  Logger.log("Tabs ready.");
}

/**
 * MANUAL ONLY (run from the Apps Script editor). Deletes every row whose studentId
 * starts with "999" (all fake/test IDs) from Participants and Scores.
 */
function clearTestData() {
  withLock_(function () {
    const targets = [
      { name: SHEET_PARTICIPANTS, headers: P_HEADERS, idCol: P.ID },
      { name: SHEET_SCORES, headers: S_HEADERS, idCol: S.ID }
    ];
    targets.forEach(function (t) {
      const sh = sheet_(t.name, t.headers, t.idCol);
      const rows = readRows_(sh);
      let deleted = 0;
      // Delete contiguous blocks from the bottom up so row numbers stay valid.
      let i = rows.length - 1;
      while (i >= 0) {
        if (normId_(rows[i][t.idCol]).indexOf(CONFIG.TEST_ID_PREFIX) === 0) {
          let start = i;
          while (start - 1 >= 0 && normId_(rows[start - 1][t.idCol]).indexOf(CONFIG.TEST_ID_PREFIX) === 0) start--;
          const count = i - start + 1;
          sh.deleteRows(start + 2, count); // +2: header row + 1-based rows
          deleted += count;
          i = start - 1;
        } else {
          i--;
        }
      }
      Logger.log(t.name + ": deleted " + deleted + " test row(s).");
    });
    SpreadsheetApp.flush();
  });
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function getParticipant_(studentId) {
  const id = validId_(studentId);
  const sh = sheet_(SHEET_PARTICIPANTS, P_HEADERS, P.ID);
  const rows = readRows_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (normId_(rows[i][P.ID]) === id) return { found: true, name: String(rows[i][P.NAME]) };
  }
  return { found: false };
}

function register_(studentId, name) {
  const id = validId_(studentId);
  const nm = validName_(name);
  const created = upsertParticipant_(id, nm);
  SpreadsheetApp.flush();
  return { ok: true, created: created, name: nm };
}

/** Creates or updates a participant. Returns true if a new row was created. Caller holds the lock. */
function upsertParticipant_(id, nm) {
  const sh = sheet_(SHEET_PARTICIPANTS, P_HEADERS, P.ID);
  const rows = readRows_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (normId_(rows[i][P.ID]) === id) {
      if (String(rows[i][P.NAME]) !== nm) sh.getRange(i + 2, P.NAME + 1).setValue(safeText_(nm));
      return false;
    }
  }
  appendRow_(sh, [id, safeText_(nm), new Date()], P.ID);
  return true;
}

function score_(b) {
  const id = validId_(b.studentId);
  const booth = validBooth_(b.booth);
  const points = validPoints_(b.points, booth);

  let details = b.details;
  if (details === undefined || details === null) details = {};
  if (typeof details !== "object" || Array.isArray(details)) throw userError_("details must be an object.");
  const attemptId = details.attemptId !== undefined && details.attemptId !== null ? String(details.attemptId) : "";
  const detailsStr = JSON.stringify(details);
  if (detailsStr.length > CONFIG.DETAILS_MAX_CHARS) throw userError_("details is too large.");

  const scores = sheet_(SHEET_SCORES, S_HEADERS, S.ID);
  const rows = readRows_(scores);
  let hasPrevious = false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (attemptId) {
      const d = parseJson_(r[S.DETAILS]);
      if (d && d.attemptId !== undefined && d.attemptId !== null && String(d.attemptId) === attemptId) {
        // Safe retry: same attempt already stored. Return the original result, append nothing.
        return { counted: isTrue_(r[S.COUNTED]), points: Number(r[S.POINTS]), duplicate: true };
      }
    }
    if (normId_(r[S.ID]) === id && String(r[S.BOOTH]) === booth) hasPrevious = true;
  }

  // Find (or create from the optional name) the participant.
  const found = getParticipant_(id);
  let name = found.found ? found.name : "";
  if (!found.found) {
    const given = cleanName_(b.name).slice(0, CONFIG.NAME_MAX);
    if (given) {
      upsertParticipant_(id, given);
      name = given;
    }
  }

  const counted = !hasPrevious;
  appendRow_(scores, [new Date(), id, safeText_(name), booth, points, counted, detailsStr], S.ID);
  SpreadsheetApp.flush();
  return { counted: counted, points: points };
}

function leaderboard_() {
  const pRows = readRows_(sheet_(SHEET_PARTICIPANTS, P_HEADERS, P.ID));
  const sRows = readRows_(sheet_(SHEET_SCORES, S_HEADERS, S.ID));

  const names = {};
  pRows.forEach(function (r) {
    const id = normId_(r[P.ID]);
    if (id) names[id] = String(r[P.NAME]);
  });

  const players = {};
  const boothEntries = {};
  CONFIG.LEADERBOARD_BOOTHS.forEach(function (bt) { boothEntries[bt] = []; });

  sRows.forEach(function (r) {
    if (!isTrue_(r[S.COUNTED])) return;
    const id = normId_(r[S.ID]);
    if (!id) return;
    const booth = String(r[S.BOOTH]);
    const pts = Number(r[S.POINTS]) || 0;
    const t = toTime_(r[S.TIME]);
    const name = names[id] || String(r[S.NAME] || "");
    let p = players[id];
    if (!p) {
      p = { id: id, name: name, total: 0, perBooth: {}, last: 0 };
      players[id] = p;
    }
    p.total += pts;
    p.perBooth[booth] = (p.perBooth[booth] || 0) + pts;
    if (t > p.last) p.last = t;
    if (boothEntries[booth]) {
      const entry = { id: id, name: name, points: pts, t: t };
      const infoKeys = CONFIG.LEADERBOARD_INFO[booth];
      if (infoKeys) entry.info = pickInfo_(parseJson_(r[S.DETAILS]), infoKeys);
      boothEntries[booth].push(entry);
    }
  });

  const sorted = Object.keys(players).map(function (k) { return players[k]; });
  // Highest total first; tie -> whoever reached the total first (earlier latest counted row).
  sorted.sort(function (a, b) { return b.total - a.total || a.last - b.last; });

  const top = sorted.slice(0, CONFIG.TOP_N).map(function (p, i) {
    const perBooth = {};
    CONFIG.LEADERBOARD_BOOTHS.forEach(function (bt) { perBooth[bt] = p.perBooth[bt] || 0; });
    return { rank: i + 1, name: p.name, idLast4: last4_(p.id), total: p.total, perBooth: perBooth };
  });

  const perBooth = {};
  CONFIG.LEADERBOARD_BOOTHS.forEach(function (bt) {
    perBooth[bt] = boothEntries[bt]
      .sort(function (a, b) { return b.points - a.points || a.t - b.t; })
      .slice(0, CONFIG.PER_BOOTH_N)
      .map(function (e, i) {
        const o = { rank: i + 1, name: e.name, idLast4: last4_(e.id), points: e.points };
        if (e.info) o.info = e.info;
        return o;
      });
  });

  const uniqueParticipants = {};
  pRows.forEach(function (r) { const id = normId_(r[P.ID]); if (id) uniqueParticipants[id] = true; });

  return {
    updatedAt: new Date().toISOString(),
    totalParticipants: Object.keys(uniqueParticipants).length,
    top: top,
    perBooth: perBooth
  };
}

function grade_(b) {
  const prompt = String(b.prompt === undefined || b.prompt === null ? "" : b.prompt).trim();
  if (!prompt) throw userError_("prompt is required.");
  if (prompt.length > CONFIG.PROMPT_MAX_CHARS) throw userError_("prompt is too long.");

  const model = String(CONFIG.GEMINI_MODEL).replace(/^models\//, "").trim();
  if (!model || model.indexOf("REPLACE_") === 0) {
    throw userError_("Gemini model is not configured on the server (CONFIG.GEMINI_MODEL in Code.gs).");
  }
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) throw userError_("Gemini API key is missing on the server (Script Properties > GEMINI_API_KEY).");

  const parts = [{ text: prompt }];
  if (b.imageBase64) {
    const mimeType = String(b.mimeType || "");
    if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(mimeType)) {
      throw userError_("mimeType must be image/png, image/jpeg, image/webp, image/heic or image/heif.");
    }
    const data = String(b.imageBase64).replace(/^data:[^,]*,/, "");
    if (data.length > CONFIG.IMAGE_MAX_BASE64_CHARS) throw userError_("Image is too large (max ~5 MB).");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw userError_("imageBase64 is not valid base64.");
    parts.push({ inline_data: { mime_type: mimeType, data: data } });
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent";
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": key },
    payload: JSON.stringify({
      contents: [{ role: "user", parts: parts }],
      generationConfig: { responseMimeType: "application/json" }
    }),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    console.error("Gemini HTTP " + code + ": " + res.getContentText().slice(0, 500));
    throw userError_("AI grading failed (HTTP " + code + "). Please try again.");
  }
  let text = "";
  try {
    const json = JSON.parse(res.getContentText());
    const cand = (json.candidates || [])[0] || {};
    const cParts = (cand.content && cand.content.parts) || [];
    text = cParts.map(function (p) { return p.text || ""; }).join("");
  } catch (err) {
    throw userError_("AI service returned an unreadable answer. Please try again.");
  }
  try {
    return { ok: true, result: JSON.parse(text) };
  } catch (err) {
    throw userError_("AI answer was not valid JSON. Please try again.");
  }
}

/* ------------------------------------------------------------------ */
/* Booth 05 — Virtual Patient                                          */
/* The page builds the prompts (case content stays in the page, as     */
/* with Booth 03); the server picks the model, retries, falls back,    */
/* and guards the patient reply (leak check + word cap).               */
/* ------------------------------------------------------------------ */

function patientTurn_(b) {
  const prompt = patientPrompt_(b.prompt);
  const lang = b.lang === "en" ? "en" : "ar";
  const caseId = /^[A-Za-z0-9_-]{1,32}$/.test(String(b.caseId || "")) ? String(b.caseId) : "?";
  const terms = (Array.isArray(b.leakTerms) ? b.leakTerms : []).slice(0, 80)
    .map(function (t) { return String(t === undefined || t === null ? "" : t).slice(0, 120); })
    .filter(function (t) { return t.trim() !== ""; });
  const out = geminiChain_(modelChain_(CONFIG.GEMINI_CHAT_MODEL), {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
  }, CONFIG.CHAT_BUDGET_MS, function (text) {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (!t) throw new Error("empty reply");
    return t;
  });
  let reply = out.value;
  let leaked = false;
  if (leaks_(reply, terms)) {
    console.warn("patientTurn " + caseId + ": reply blocked by the leak check: " + reply.slice(0, 200));
    reply = lang === "en" ? "I don't know, doctor, you're the doctor!" : "ما أدري يا دكتور، أنت الدكتور!";
    leaked = true;
  }
  return { ok: true, reply: capWords_(reply, CONFIG.PATIENT_MAX_WORDS), leaked: leaked, model: out.model };
}

function patientGrade_(b) {
  const prompt = patientPrompt_(b.prompt);
  const out = geminiChain_(modelChain_(CONFIG.GEMINI_MODEL), {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" }
  }, CONFIG.GRADE_BUDGET_MS, function (text) {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
    return v;
  });
  return { ok: true, result: out.value, model: out.model };
}

function patientPrompt_(v) {
  const prompt = String(v === undefined || v === null ? "" : v).trim();
  if (!prompt) throw userError_("prompt is required.");
  if (prompt.length > CONFIG.PATIENT_PROMPT_MAX_CHARS) throw userError_("prompt is too long.");
  return prompt;
}

/** [primary, ...CONFIG.GEMINI_FALLBACK_MODELS] without placeholders and duplicates. */
function modelChain_(primary) {
  const out = [];
  [primary].concat(CONFIG.GEMINI_FALLBACK_MODELS || []).forEach(function (m) {
    m = String(m === undefined || m === null ? "" : m).replace(/^models\//, "").trim();
    if (m && m.indexOf("REPLACE_") !== 0 && out.indexOf(m) === -1) out.push(m);
  });
  return out;
}

/**
 * Tries each model in order: one retry on 429/500/503/504 or a network error, then the next model.
 * accept(text) parses/validates the answer (throw = treat as a failure of that model).
 * Gives up when budgetMs has passed. -> {value, model}
 */
function geminiChain_(models, payload, budgetMs, accept) {
  if (!models.length) throw userError_("No Gemini model is configured on the server (CONFIG in Code.gs).");
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) throw userError_("Gemini API key is missing on the server (Script Properties > GEMINI_API_KEY).");
  const start = Date.now();
  const tried = [];
  for (let i = 0; i < models.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - start > budgetMs) {
        tried.push("time budget used up");
        throw userError_("AI is unavailable right now (" + tried.join(", ") + ").");
      }
      const r = geminiCall_(models[i], key, payload);
      if (r.ok) {
        try {
          return { value: accept(r.text), model: models[i] };
        } catch (err) {
          r.retry = false;
          r.code = "bad answer";
        }
      }
      tried.push(models[i] + " " + r.code);
      console.warn("Gemini " + models[i] + " failed (" + r.code + "): " + String(r.error || "").slice(0, 300));
      if (!r.retry) break;
      if (attempt === 0) Utilities.sleep(CONFIG.RETRY_SLEEP_MS);
    }
  }
  throw userError_("AI is unavailable right now (" + tried.join(", ") + ").");
}

/** One generateContent call. -> {ok, text} or {ok:false, retry, code, error} */
function geminiCall_(model, key, payload) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": key },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, retry: true, code: "network", error: String(err) };
  }
  const code = res.getResponseCode();
  if (code !== 200) {
    return { ok: false, retry: code === 429 || code === 500 || code === 503 || code === 504, code: code, error: res.getContentText() };
  }
  try {
    const json = JSON.parse(res.getContentText());
    const cand = (json.candidates || [])[0] || {};
    const parts = (cand.content && cand.content.parts) || [];
    const text = parts.filter(function (p) { return p.thought !== true; }).map(function (p) { return p.text || ""; }).join("");
    if (!text.trim()) return { ok: false, retry: false, code: "empty", error: cand.finishReason || "" };
    return { ok: true, text: text };
  } catch (err) {
    return { ok: false, retry: false, code: "unreadable", error: String(err) };
  }
}

/** Same normalisation as the page: lower case, no tashkeel, unified alef/yaa/taa marbuta, punctuation -> space. */
function normAr_(text) {
  let out = "";
  const s = String(text === undefined || text === null ? "" : text);
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    const o = ch.charCodeAt(0);
    if ((o >= 0x064B && o <= 0x065F) || o === 0x0670 || o === 0x0640) continue;
    if ("أإآٱ".indexOf(ch) !== -1) ch = "ا";
    else if (ch === "ة") ch = "ه";
    else if (ch === "ى") ch = "ي";
    else if (ch === "ؤ") ch = "و";
    else if (ch === "ئ") ch = "ي";
    else if (o >= 0x0660 && o <= 0x0669) ch = String(o - 0x0660);
    else if (o >= 0x06F0 && o <= 0x06F9) ch = String(o - 0x06F0);
    else if (!/[\p{L}\p{M}\p{N}\s]/u.test(ch)) ch = " ";
    out += ch.toLowerCase();
  }
  return out.replace(/\s+/g, " ").trim();
}

/** true if any leak term occurs in the reply (Latin terms only at a word start). */
function leaks_(reply, terms) {
  const n = normAr_(reply);
  return terms.some(function (t) {
    const kw = normAr_(t);
    if (!kw) return false;
    const latin = /^[a-z0-9]/.test(kw);
    let from = 0;
    while (true) {
      const i = n.indexOf(kw, from);
      if (i < 0) return false;
      if (!latin || i === 0 || !/[\p{L}\p{N}]/u.test(n[i - 1])) return true;
      from = i + 1;
    }
  });
}

function capWords_(s, n) {
  const w = String(s).split(/\s+/).filter(function (x) { return x; });
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ") + "…";
}

/** Short strings / finite numbers only, from a parsed details object. */
function pickInfo_(d, keys) {
  const out = {};
  if (!d || typeof d !== "object") return out;
  keys.forEach(function (k) {
    const v = d[k];
    if (typeof v === "number" && isFinite(v)) out[k] = v;
    else if (typeof v === "string" && v.length <= 24) out[k] = v;
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation & helpers                                                */
/* ------------------------------------------------------------------ */

function validId_(v) {
  const id = String(v === undefined || v === null ? "" : v).trim();
  if (!/^\d{6,12}$/.test(id)) throw userError_("studentId must be 6-12 digits.");
  return id;
}

function cleanName_(v) {
  return String(v === undefined || v === null ? "" : v)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validName_(v) {
  const nm = cleanName_(v);
  if (!nm) throw userError_("name is required.");
  if (nm.length > CONFIG.NAME_MAX) throw userError_("name must be at most " + CONFIG.NAME_MAX + " characters.");
  return nm;
}

function validBooth_(v) {
  const booth = String(v === undefined || v === null ? "" : v);
  if (CONFIG.BOOTHS.indexOf(booth) === -1) throw userError_("booth must be one of booth01..booth06.");
  return booth;
}

function validPoints_(v, booth) {
  if (typeof v !== "number" || !isFinite(v)) throw userError_("points must be a number.");
  if (v < 0 || v > 100) throw userError_("points must be between 0 and 100.");
  const max = CONFIG.MAX_POINTS[booth];
  if (v > max) throw userError_("points for " + booth + " must be at most " + max + ".");
  return v;
}

/** Formula-injection guard: text starting with = + - @ is stored as plain text. */
function safeText_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function normId_(v) {
  return String(v === undefined || v === null ? "" : v).trim();
}

function last4_(id) {
  return String(id).slice(-4);
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === "TRUE";
}

function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function parseJson_(s) {
  if (!s) return null;
  try { return JSON.parse(String(s)); } catch (err) { return null; }
}

function userError_(msg) {
  const e = new Error(msg);
  e.isUserError = true;
  return e;
}

function respond_(fn) {
  let out;
  try {
    out = fn();
  } catch (err) {
    if (err && err.isUserError) {
      out = { error: err.message };
    } else {
      console.error(err && err.stack ? err.stack : err);
      out = { error: "Server error. Please try again." };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw userError_("Server is busy. Please try again.");
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Returns the tab, creating it (with headers, ID column as plain text) if missing. */
function sheet_(name, headers, idCol) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange(1, idCol + 1, sh.getMaxRows(), 1).setNumberFormat("@");
  }
  return sh;
}

/** All data rows (without the header). */
function readRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

/** Appends a row; the ID cell is forced to plain text so IDs never become numbers. */
function appendRow_(sh, values, idCol) {
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(row, idCol + 1).setNumberFormat("@");
  sh.getRange(row, 1, 1, values.length).setValues([values]);
}
