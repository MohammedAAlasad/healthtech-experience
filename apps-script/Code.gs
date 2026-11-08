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
 *
 * Secrets: the Gemini key lives ONLY in Project Settings > Script Properties > GEMINI_API_KEY.
 * Manual-only maintenance: run clearTestData() from the editor (not reachable from the web).
 */

const CONFIG = {
  // Copy the current Flash model name from aistudio.google.com (e.g. the model id shown in AI Studio).
  GEMINI_MODEL: "gemini-3.8-flash",
  BOOTHS: ["booth01", "booth02", "booth03", "booth04", "booth05", "booth06"],
  MAX_POINTS: { booth01: 100, booth02: 100, booth03: 30, booth04: 100, booth05: 100, booth06: 40 },
  LEADERBOARD_BOOTHS: ["booth03", "booth06"],
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
    if (boothEntries[booth]) boothEntries[booth].push({ id: id, name: name, points: pts, t: t });
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
      .map(function (e, i) { return { rank: i + 1, name: e.name, idLast4: last4_(e.id), points: e.points }; });
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
