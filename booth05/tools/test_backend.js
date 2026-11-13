#!/usr/bin/env node
/*
 * Runs apps-script/Code.gs in Node with fake Apps Script services (Sheet, UrlFetchApp, LockService, ...).
 * Checks the Booth 05 actions (patientTurn, patientGrade: model chain, retry, fallback, leak check, word cap)
 * and that the existing actions (register, score, leaderboard, grade) still behave as before.
 * Usage: node booth05/tools/test_backend.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(path.join(REPO, "apps-script", "Code.gs"), "utf8");

let passed = 0, failed = 0;
function eq(name, got, exp) {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (ok) { passed++; console.log("PASS  " + name); }
  else { failed++; console.log("FAIL  " + name + "\n      expected " + JSON.stringify(exp) + "\n      got      " + JSON.stringify(got)); }
}

/* ---------------- fake Apps Script ---------------- */
function fakeSheet() {
  const data = []; // rows of values (row 1 = data[0])
  const sh = {
    data,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => Math.max(1000, data.length),
    insertRowsAfter() {},
    setFrozenRows() {},
    deleteRows(start, n) { data.splice(start - 1, n); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        setValues(v) { for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } return rng; },
        setValue(v) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; return rng; },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((data[r - 1 + i] || [])[c - 1 + j]) ?? ""); out.push(row); } return out; },
        setNumberFormat() { return rng; },
        setFontWeight() { return rng; }
      };
      return rng;
    }
  };
  return sh;
}

function makeEnv() {
  const sheets = {};
  const fetches = [];
  const sleeps = [];
  const logs = [];
  let responder = () => ({ code: 200, body: "{}" });
  const env = {
    sheets, fetches, sleeps, logs,
    setResponder(f) { responder = f; },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = fakeSheet()) }),
      flush() {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "GEMINI_API_KEY" ? "test-key" : null) }) },
    UrlFetchApp: {
      fetch(url, opts) {
        const model = decodeURIComponent(url.match(/models\/([^:]+):/)[1]);
        const payload = JSON.parse(opts.payload);
        fetches.push({ model, payload, key: opts.headers["x-goog-api-key"] });
        const r = responder(model, payload, fetches.length);
        if (r.throw) throw new Error(r.throw);
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      }
    },
    Utilities: { sleep: (ms) => sleeps.push(ms) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => ({ text: s }) }) },
    Logger: { log: (s) => logs.push(String(s)) },
    console: { error: (s) => logs.push("E " + s), warn: (s) => logs.push("W " + s), log: (s) => logs.push(String(s)) }
  };
  vm.createContext(env);
  vm.runInContext(SRC + "\n;this.CONFIG = CONFIG;", env, { filename: "Code.gs" });
  env.post = (body) => JSON.parse(env.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  env.get = (p) => JSON.parse(env.doGet({ parameter: p }).text);
  return env;
}
const gem = (text, extraParts) => ({ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: (extraParts || []).concat([{ text }]) } }] }) });

/* ---------------- existing actions unchanged ---------------- */
{
  let head = "";
  try { head = execFileSync("git", ["show", "HEAD:apps-script/Code.gs"], { cwd: REPO, encoding: "utf8" }); } catch (e) { head = ""; }
  const fnSrc = (src, name) => { const m = src.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n}\\n")); return m ? m[0] : null; };
  if (!head) console.log("SKIP  source comparison with HEAD (git not available)");
  else {
    for (const f of ["doGet", "getParticipant_", "register_", "upsertParticipant_", "score_", "grade_", "validId_", "validName_", "validBooth_",
      "validPoints_", "safeText_", "respond_", "withLock_", "sheet_", "readRows_", "appendRow_", "clearTestData", "setup"]) {
      eq("unchanged since HEAD: " + f + "()", fnSrc(SRC, f) !== null && fnSrc(SRC, f) === fnSrc(head, f), true);
    }
  }
}
{
  const E = makeEnv();
  eq("register", E.post({ action: "register", studentId: "999000001", name: "=Test One" }).ok, true);
  eq("formula guard kept", E.sheets.Participants.data[1][1], "'=Test One");
  eq("booth03 score 25 accepted", E.post({ action: "score", studentId: "999000001", booth: "booth03", points: 25, details: { attemptId: "a1" } }), { counted: true, points: 25 });
  eq("booth06 score 31 accepted", E.post({ action: "score", studentId: "999000001", booth: "booth06", points: 31, details: { attemptId: "a2" } }).counted, true);
  eq("booth03 retry with same attemptId -> duplicate", E.post({ action: "score", studentId: "999000001", booth: "booth03", points: 25, details: { attemptId: "a1" } }).duplicate, true);
  eq("booth03 max still 30", E.post({ action: "score", studentId: "999000001", booth: "booth03", points: 31, details: {} }).error, "points for booth03 must be at most 30.");
  eq("booth05 max is now 10", E.post({ action: "score", studentId: "999000001", booth: "booth05", points: 10.5, details: {} }).error, "points for booth05 must be at most 10.");
  eq("booth05 score 8.5 accepted", E.post({ action: "score", studentId: "999000001", booth: "booth05", points: 8.5,
    details: { attemptId: "a3", caseId: "case02", outcomeTier: "healed", durationS: 262, history: 3.8, mode: "ai" } }).counted, true);
  E.post({ action: "register", studentId: "999000002", name: "Test Two" });
  E.post({ action: "score", studentId: "999000002", booth: "booth05", points: 4, details: { attemptId: "b1", caseId: "x".repeat(30), outcomeTier: "worse", durationS: 300 } });
  const lb = E.get({ action: "leaderboard" });
  eq("leaderboard: totals include booth05", lb.top[0].total, 64.5);
  eq("leaderboard: perBooth chips include booth05", lb.top[0].perBooth, { booth03: 25, booth06: 31, booth05: 8.5 });
  eq("leaderboard: booth05 top list with case/outcome/duration", lb.perBooth.booth05[0], { rank: 1, name: "'=Test One", idLast4: "0001", points: 8.5,
    info: { caseId: "case02", outcomeTier: "healed", durationS: 262 } });
  eq("leaderboard: long strings are dropped from info", lb.perBooth.booth05[1].info, { outcomeTier: "worse", durationS: 300 });
  eq("leaderboard: booth03 entries have no info field", Object.keys(lb.perBooth.booth03[0]), ["rank", "name", "idLast4", "points"]);
  eq("leaderboard: no full student ids", JSON.stringify(lb).includes("999000001"), false);

  E.setResponder(() => gem('{"score": 7, "matched": [], "wrong": [], "feedback": "ok"}'));
  const g = E.post({ action: "grade", prompt: "grade this" });
  eq("grade (Booth 03): result parsed", g, { ok: true, result: { score: 7, matched: [], wrong: [], feedback: "ok" } });
  eq("grade (Booth 03): uses CONFIG.GEMINI_MODEL, JSON mode", [E.fetches[0].model, E.fetches[0].payload.generationConfig.responseMimeType], [E.CONFIG.GEMINI_MODEL, "application/json"]);
  E.setResponder(() => ({ code: 503, body: "busy" }));
  eq("grade (Booth 03): no retry/fallback added (one call, same error text)", [E.post({ action: "grade", prompt: "x" }).error, E.fetches.length], ["AI grading failed (HTTP 503). Please try again.", 2]);
  eq("unknown action still rejected", E.post({ action: "nope" }).error, "Unknown action.");
}

/* ---------------- Booth 05 ---------------- */
{
  const E = makeEnv();
  eq("config: chat model is a placeholder", E.CONFIG.GEMINI_CHAT_MODEL.indexOf("REPLACE_") === 0, true);
  eq("config: fallback models are placeholders", E.CONFIG.GEMINI_FALLBACK_MODELS.every((m) => m.indexOf("REPLACE_") === 0), true);
  eq("modelChain_: placeholders skipped, GEMINI_MODEL first for grading", E.modelChain_(E.CONFIG.GEMINI_MODEL), [E.CONFIG.GEMINI_MODEL]);
  eq("patientTurn with only placeholders -> clear error (page uses its script)", E.post({ action: "patientTurn", prompt: "p" }).error,
    "No Gemini model is configured on the server (CONFIG in Code.gs).");

  E.CONFIG.GEMINI_CHAT_MODEL = "chat-a";
  E.CONFIG.GEMINI_FALLBACK_MODELS = ["models/fb-1", "fb-2", "chat-a"];
  eq("modelChain_: 'models/' prefix removed, duplicates removed", E.modelChain_(E.CONFIG.GEMINI_CHAT_MODEL), ["chat-a", "fb-1", "fb-2"]);

  E.setResponder((m) => (m === "fb-2" ? gem("تحت يمين، الضروس اللي ورا.") : { code: m === "chat-a" ? 429 : 503, body: "quota" }));
  let r = E.post({ action: "patientTurn", caseId: "case01", lang: "ar", prompt: "p", leakTerms: ["pulpitis", "التهاب العصب"] });
  eq("chain: 429 -> retry once -> next model 503 x2 -> third model answers", [r.reply, r.model, r.leaked], ["تحت يمين، الضروس اللي ورا.", "fb-2", false]);
  eq("chain: call order", E.fetches.map((f) => f.model), ["chat-a", "chat-a", "fb-1", "fb-1", "fb-2"]);
  eq("chain: one short sleep before each retry", E.sleeps, [800, 800]);
  eq("chain: patientTurn uses plain text (no JSON mode)", E.fetches[0].payload.generationConfig.responseMimeType, undefined);

  E.fetches.length = 0;
  E.setResponder((m) => (m === "chat-a" ? { code: 404, body: "model not found" } : gem("ok")));
  r = E.post({ action: "patientTurn", prompt: "p" });
  eq("chain: 404 (bad model name) -> no retry, next model", [E.fetches.map((f) => f.model), r.model], [["chat-a", "fb-1"], "fb-1"]);

  E.fetches.length = 0;
  E.setResponder((m, p, n) => (n === 1 ? { throw: "Timeout" } : gem("ok")));
  eq("chain: network error -> retried on the same model", [E.post({ action: "patientTurn", prompt: "p" }).model, E.fetches.length], ["chat-a", 2]);

  E.setResponder(() => gem("يمكن عندي التِهاب العَصَب يا دكتور"));
  r = E.post({ action: "patientTurn", lang: "ar", prompt: "p", leakTerms: ["pulpitis", "التهاب العصب"] });
  eq("leak check (server): Arabic diagnosis -> safe line", [r.reply, r.leaked], ["ما أدري يا دكتور، أنت الدكتور!", true]);
  eq("leak check (server): logged", E.logs.some((l) => /leak check/.test(l)), true);
  E.setResponder(() => gem("I think it is Pulpitis."));
  eq("leak check (server): English, case-insensitive, lang en", E.post({ action: "patientTurn", lang: "en", prompt: "p", leakTerms: ["pulpitis"] }).reply, "I don't know, doctor, you're the doctor!");
  E.setResponder(() => gem(Array.from({ length: 50 }, (_, i) => "w" + i).join(" ")));
  r = E.post({ action: "patientTurn", prompt: "p", leakTerms: [] });
  eq("word cap (server): 50 -> 35 words + …", [r.reply.split(" ").length, r.reply.endsWith("…")], [35, true]);
  E.setResponder(() => gem("الجواب", [{ text: "thinking about pulpitis", thought: true }]));
  eq("thought parts are ignored", E.post({ action: "patientTurn", prompt: "p", leakTerms: ["pulpitis"] }).reply, "الجواب");
  E.setResponder(() => ({ code: 200, body: JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }) }));
  eq("empty answers from every model -> error (page falls back)", /AI is unavailable/.test(E.post({ action: "patientTurn", prompt: "p" }).error), true);
  eq("prompt required", E.post({ action: "patientTurn", prompt: " " }).error, "prompt is required.");
  eq("prompt length capped", E.post({ action: "patientTurn", prompt: "x".repeat(24001) }).error, "prompt is too long.");

  E.fetches.length = 0;
  E.setResponder((m) => (m === E.CONFIG.GEMINI_MODEL ? gem("not json") : gem('{"questionsAsked":[],"total":1}')));
  r = E.post({ action: "patientGrade", caseId: "case01", prompt: "grade" });
  eq("patientGrade: GEMINI_MODEL first, then the fallbacks (not the chat model); invalid JSON -> next model", [E.fetches.map((f) => f.model), r.model, r.result.total],
    [[E.CONFIG.GEMINI_MODEL, "fb-1"], "fb-1", 1]);
  eq("patientGrade: JSON mode, temperature 0", [E.fetches[0].payload.generationConfig.responseMimeType, E.fetches[0].payload.generationConfig.temperature], ["application/json", 0]);
  E.setResponder(() => gem("[1,2]"));
  eq("patientGrade: JSON array rejected everywhere -> error", /AI is unavailable/.test(E.post({ action: "patientGrade", prompt: "g" }).error), true);

  E.fetches.length = 0;
  E.CONFIG.CHAT_BUDGET_MS = -1;
  eq("time budget used up -> stop trying", [/time budget/.test(E.post({ action: "patientTurn", prompt: "p" }).error), E.fetches.length], [true, 0]);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
