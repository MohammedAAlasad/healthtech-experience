#!/usr/bin/env node
/*
 * End-to-end check of booth05/?mock=1 in headless Chrome (no microphone, typed input), plus the dashboard.
 * 1. From the repo root: python3 -m http.server 8000
 * 2. node booth05/tools/e2e_mock.mjs [screenshot-dir] [base-url]
 * Needs Node 22+ (built-in WebSocket) and Google Chrome / Chromium. Starts its own Chrome on port 9333.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "booth05-shots-"));
const BASE = (process.argv[3] || "http://localhost:8000/").replace(/\/?$/, "/");
const PORT = 9333;
fs.mkdirSync(OUT, { recursive: true });
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((p) => fs.existsSync(p));
if (!CHROME) { console.error("Chrome not found"); process.exit(2); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "booth05-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
  "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list = null;
for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0; const pend = {}; const errs = []; const external = []; const bad = [];
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
  const p = d.params || {};
  if (d.method === "Runtime.exceptionThrown") errs.push("exception: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && p.type === "error") errs.push("console.error: " + p.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Network.requestWillBeSent" && !/^(http:\/\/(localhost|127\.0\.0\.1)|data:|about:)/.test(p.request.url)) external.push(p.request.url);
  if (d.method === "Network.responseReceived" && p.response.status >= 400 && !/favicon/.test(p.response.url)) bad.push(p.response.status + " " + p.response.url);
  if (d.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true });
};
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result.result.value;
};
const waitFor = (expr, ms = 15000) => ev(`(async()=>{const t0=Date.now();while(Date.now()-t0<${ms}){try{if(${expr})return true}catch(e){}await new Promise(r=>setTimeout(r,100))}return false})()`);
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log((c ? "PASS  " : "FAIL  ") + n + (x ? "  [" + x + "]" : "")); };
const viewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const type = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||""`);
// Fast-forward helper: performance.now() + offset (the booth timer and the idle reset both use performance.now()).
const CLOCK = `(()=>{if(window.__skip)return;const o=performance.now.bind(performance);let off=0;performance.now=()=>o()+off;window.__skip=(s)=>{off+=s*1000}})()`;
/** Small buttons/inputs that are visible on screen right now (touch target < 48 px). */
const smallTargets = () => ev(`[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&(r.height<48||r.width<48)}).map(e=>(e.id||e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))`);
const overflowX = () => ev(`document.documentElement.scrollWidth>innerWidth+1`);

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });

async function checkIn(sid, name) {
  await waitFor(`document.getElementById('ht-id')`);
  await type("#ht-id", sid); await type("#ht-name", name); await click(".ht-btn");
  return waitFor(`document.getElementById('startConsultBtn')`, 8000);
}
async function ask(q) {
  const n = await ev(`document.querySelectorAll('.bubble.patient:not(.thinking)').length`);
  await type("#textInput", q);
  await ev(`document.getElementById('textInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await waitFor(`document.querySelectorAll('.bubble.patient:not(.thinking)').length>${n} && !document.getElementById('sendBtn').disabled`, 8000);
  return ev(`[...document.querySelectorAll('.bubble.patient:not(.thinking)')].pop().lastChild.textContent`);
}

const SIZES = [["1080p", 1920, 1080], ["13in", 1280, 800]];
await viewport(1920, 1080);
await send("Page.navigate", { url: BASE + "booth05/?mock=1&case=case01" }); await sleep(800);
await ev(`localStorage.clear()`);
await send("Page.navigate", { url: BASE + "booth05/?mock=1&case=case01" }); await sleep(1000);
const CASES = await ev(`CASES`);
const c1 = CASES.find((c) => c.id === "case01");

ok("red DRAFT banner shown (cases PENDING_REVIEW)", await ev(`!document.getElementById('draftBanner').hidden && document.getElementById('draftBanner').textContent==='Sample cases — not yet approved by Dentistry'`));
ok("MOCK MODE badge shown", (await text(".ht-badge-mock")) === "MOCK MODE");
const hasSR = await ev(`!!(window.SpeechRecognition||window.webkitSpeechRecognition)`);
ok("voice banner matches SpeechRecognition support", (await ev(`document.getElementById('voiceBanner').hidden`)) === hasSR, "SpeechRecognition " + (hasSR ? "present" : "absent"));

ok("check-in -> start screen", await checkIn("999500001", "E2E Visitor One"));
ok("start screen shows case01 (forced by ?case=case01)", (await text(".patient .tag")).startsWith("Fahad, 34"));
for (const [n, w, h] of SIZES) { await viewport(w, h); await sleep(300); await shot(`1_start_${n}`); }
await viewport(1920, 1080);

// Settings drawer + language toggle
await click("#settingsBtn"); await sleep(200);
ok("settings drawer opens with a voice picker", await ev(`!document.getElementById('drawer').hidden && document.getElementById('voiceSelect').options.length>=1`));
await shot("2_settings_1080p");
await click("#drawerClose");
await click("#langBtn");
ok("EN toggle", (await text("#langBtn")) === "EN");
await click("#langBtn");
ok("back to AR", (await text("#langBtn")) === "AR");

// Voice test must never hang (headless: no microphone)
await click("#voiceTestBtn");
const vt = await waitFor(`!document.getElementById('voiceTestBtn').disabled`, 20000);
ok("voice test finishes and reports (no mic in headless)", vt, await text("#voiceTestResult"));

// Consultation
await click("#startConsultBtn");
ok("consultation screen with timer", await waitFor(`document.getElementById('talkBtn') && !document.getElementById('timerBar').hidden`));
ok("timer starts at 5:00", /^(5:00|4:5\d)$/.test(await text("#timerText")), await text("#timerText"));
ok("patient opener shown", (await waitFor(`document.querySelector('.bubble.patient')`)) && (await text(".bubble.patient")).includes(c1.profile.opener));
ok("offline-patient chip shown in mock mode", await ev(`!document.getElementById('offlineChip').hidden`));
await type("#textInput", "x"); await click("#sendBtn"); await sleep(200);
ok("1-character input ignored", (await text("#consultMsg")).includes("Too short") && (await ev(`document.querySelectorAll('.bubble.dentist').length`)) === 0);

if (hasSR) {
  await click("#talkBtn");
  const settled = await waitFor(`!document.getElementById('talkBtn').classList.contains('listening')`, 12000);
  ok("Tap to talk without a microphone degrades gracefully", settled && (await text("#consultMsg")).length > 0, await text("#consultMsg"));
}

const PH = JSON.parse(fs.readFileSync(new URL("./fixtures/fallback_phrasings.json", import.meta.url), "utf8")).phrasings.case01;
let allRight = true;
for (const q of c1.keyQuestions) {
  const r = await ask(PH[q.id][0]);
  if (r !== q.answer) { allRight = false; console.log("      " + q.id + " got: " + r); }
}
ok("8 typed questions -> 8 correct scripted answers", allRight);
ok("asking for the diagnosis -> patient doesn't know", (await ask("وش التشخيص يا ترى؟")) === "ما أدري يا دكتور، عشان كذا جيتك.");
ok("transcript scrolls inside its panel (page does not overflow sideways)", !(await overflowX()));
for (const [n, w, h] of SIZES) { await viewport(w, h); await sleep(300); await shot(`3_consult_${n}`); ok(`consult ${n}: fits on one screen (no vertical scroll)`, await ev(`document.documentElement.scrollHeight<=innerHeight`)); ok(`consult ${n}: touch targets >= 48 px`, (await smallTargets()).length === 0, (await smallTargets()).join(", ")); }
await viewport(1920, 1080);

// Decision
await click("#readyBtn");
ok("I'm ready -> diagnosis step, timer hidden", await waitFor(`document.getElementById('diagnosisInput') && document.getElementById('timerBar').hidden`));
await click("#nextStepBtn");
ok("empty diagnosis is not accepted", (await ev(`!!document.getElementById('diagnosisInput')`)));
await type("#diagnosisInput", "Symptomatic irreversible pulpitis");
await shot("4_diagnosis_1080p");
await click("#nextStepBtn");
ok("treatment step", await waitFor(`document.getElementById('treatmentInput')`));
await type("#treatmentInput", "Start root canal treatment (pulpectomy) today, then a crown");
for (const [n, w, h] of SIZES) { await viewport(w, h); await sleep(300); await shot(`5_treatment_${n}`); }
await viewport(1920, 1080);
await click("#submitBtn");

// Feedback
ok("tutor feedback screen", await waitFor(`document.getElementById('feedback')`, 10000));
ok("score 10 / 10 (8/8 questions, diagnosis, correct plan)", (await text("#totalScore")) === "10 / 10", await text("#totalScore"));
ok("Preliminary grading label in mock mode", (await text("#gradingMode")) === "Preliminary grading");
ok("8 key questions listed, all asked", await ev(`document.querySelectorAll('#questionList li.good').length===8`));
ok("matched plan T1", (await text("#matchedPlan")).startsWith("Pulp therapy"));
for (const [n, w, h] of SIZES) { await viewport(w, h); await sleep(300); await shot(`6_feedback_${n}`); ok(`feedback ${n}: next button visible without scrolling`, await ev(`document.getElementById('toOutcomeBtn').getBoundingClientRect().bottom<=innerHeight`)); ok(`feedback ${n}: touch targets >= 48 px, no sideways scroll`, (await smallTargets()).length === 0 && !(await overflowX()), (await smallTargets()).join(", ")); }
await viewport(1920, 1080);

// After 7 days
await click("#toOutcomeBtn");
ok("after-7-days screen", await waitFor(`document.getElementById('outcome')`));
ok("outcome tier 'Healed' with the pre-written text", (await text("#outcomeTier")) === "Healed" && (await text("#outcomeText")) === c1.treatmentOptions[0].outcome);
ok("avatar relieved", (await ev(`document.querySelector('.av').getAttribute('data-state')`)) === "relieved");
for (const [n, w, h] of SIZES) { await viewport(w, h); await sleep(300); await shot(`7_outcome_${n}`); ok(`outcome ${n}: fits on one screen`, await ev(`document.documentElement.scrollHeight<=innerHeight`)); }
await viewport(1920, 1080);

// Result + save
await click("#toResultBtn");
ok("result screen", await waitFor(`document.getElementById('final')`));
ok("saved to the (mock) Sheet", await waitFor(`/added to the leaderboard/.test(document.getElementById('saveStatus').textContent)`, 5000), await text("#saveStatus"));
const saved = await ev(`JSON.parse(localStorage.getItem('htMockDb')).scores.filter(s=>s.booth==='booth05'&&s.studentId==='999500001')`);
ok("mock Sheet row: booth05, 10 points, case01, healed, duration", saved.length === 1 && saved[0].points === 10 && saved[0].details.caseId === "case01" &&
  saved[0].details.outcomeTier === "healed" && saved[0].details.durationS >= 0 && saved[0].details.mode === "local", JSON.stringify(saved[0] && saved[0].details));
ok("idle countdown shown", /^Resets for the next visitor in 1:[23]\d$/.test(await text("#idleNote")), await text("#idleNote"));
for (const [n, w, h] of SIZES) { await viewport(w, h); await sleep(300); await shot(`8_result_${n}`); ok(`result ${n}: Next visitor visible without scrolling`, await ev(`document.getElementById('nextVisitorBtn').getBoundingClientRect().bottom<=innerHeight`)); }
await viewport(1920, 1080);
await ev(`window.__skip(91)`);
ok("auto-reset after 90 s of inactivity -> check-in", await waitFor(`document.getElementById('ht-id')`, 3000));

// Visitor 2: random case avoids case01; timer runs out -> decision
await send("Page.navigate", { url: BASE + "booth05/?mock=1" }); await sleep(800);
ok("visitor 2 check-in", await checkIn("999500002", "E2E Visitor Two"));
ok("visitor 2 gets a different case than visitor 1", !(await text(".patient .tag")).startsWith("Fahad"), await text(".patient .tag"));
await click("#startConsultBtn");
await waitFor(`document.getElementById('talkBtn')`);
await ask("السلام عليكم، وين مكان الألم؟");
await ev(`window.__skip(301)`);
ok("timer end -> decision screen automatically", await waitFor(`document.getElementById('diagnosisInput')`, 3000));
await type("#diagnosisInput", "no idea"); await click("#nextStepBtn");
await waitFor(`document.getElementById('treatmentInput')`);
await type("#treatmentInput", "I will think about it");
await click("#submitBtn");
ok("unrecognised plan -> supervisor flag", await waitFor(`document.getElementById('supervisorFlag')`, 10000));
await click("#toOutcomeBtn");
ok("unrecognised plan -> 'Unclear' outcome", (await waitFor(`document.getElementById('outcomeTier')`)) && (await text("#outcomeTier")).startsWith("Unclear"));
await click("#toResultBtn");
await waitFor(`/added to the leaderboard/.test(document.getElementById('saveStatus').textContent)`, 5000);
await click("#nextVisitorBtn");
ok("Next visitor -> check-in", await waitFor(`document.getElementById('ht-id')`, 3000));

// Dashboard shows the mock results
await send("Page.navigate", { url: BASE + "dashboard/?mock=1" });
ok("dashboard: Virtual Patient top 3 lists visitor 1 with case/outcome/duration",
  await waitFor(`[...document.querySelectorAll('#b05 li')].some(li=>li.textContent.includes('E2E Visitor One')&&li.textContent.includes('case01 · Healed'))`, 8000), await text("#b05"));
ok("dashboard: rows have a Virtual Patient chip", await ev(`document.querySelectorAll('.row .chip.b05').length>0`));
ok("dashboard: other boards still filled", await ev(`document.querySelectorAll('#b03 li').length>0 && document.querySelectorAll('#b06 li').length>0 && document.querySelectorAll('.row').length>0`));
for (const [n, w, h] of [["1080p", 1920, 1080]]) {
  await viewport(w, h); await sleep(600); await shot(`9_dashboard_${n}`);
  ok("dashboard 1080p: nothing cut off (rows and side panels fit, names readable)", await ev(`(()=>{const b=[...document.querySelectorAll('aside .panel')].pop().getBoundingClientRect();const rows=[...document.querySelectorAll('.row')];return b.bottom<=innerHeight+1&&rows.every(r=>r.scrollWidth<=r.clientWidth+1)&&[...document.querySelectorAll('.row .name')].every(n=>n.clientWidth>=250)})()`));
}

ok("no exceptions or console errors", errs.length === 0, errs.join(" | "));
ok("no external network calls in mock mode", external.length === 0, external.join(" | "));
ok("no failed requests", bad.length === 0, bad.join(" | "));
console.log(`\n${pass} passed, ${fail} failed. Screenshots: ${OUT}`);
ws.close();
await new Promise((r) => { chrome.once("exit", r); chrome.kill(); setTimeout(r, 3000); });
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp dir, ignore */ }
process.exit(fail ? 1 : 0);
