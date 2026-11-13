#!/usr/bin/env node
/*
 * End-to-end check of Booth 05 in headless Chrome, plus the dashboard.
 * 1. From the repo root: python3 -m http.server 8000
 * 2. node booth05/tools/e2e_mock.mjs [screenshot-dir] [base-url]
 * Needs Node 22+ (built-in WebSocket) and Google Chrome / Chromium. Starts its own Chrome on port 9333.
 *
 * Part A: ?mock=1 (scripted patient, keyword grading, mock Sheet in localStorage) with a photo avatar for case01
 *         (portraits are served by request interception, nothing is written to disk) and the SVG fallback for the others.
 * Part B: the real page code against a FAKE Apps Script backend (requests to script.google.com are intercepted and
 *         answered here; nothing leaves the machine): AI replies, FAST_SCRIPTED_FIRST, 8-turn trimming, filler,
 *         ?debug=1 timings, fake speech recognition (Heard line, re-say), sentence-chunked speech, ?tts=gemini.
 * Part C: voice auto-selection with fake voice lists (natural / standard / none).
 * Speech output is a fake speechSynthesis that records every utterance (headless Chrome has no voices).
 */
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
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

/* ---------------- test helpers ---------------- */
let id = 0; const pend = {}; let errs = [], external = [], bad = [];
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
  const p = d.params || {};
  if (d.method === "Fetch.requestPaused") { onPaused(p); return; }
  if (d.method === "Runtime.exceptionThrown") errs.push("exception: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && p.type === "error") errs.push("console.error: " + p.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Network.requestWillBeSent" && !/^(http:\/\/(localhost|127\.0\.0\.1)|data:|about:|blob:)/.test(p.request.url)) external.push(p.request.url);
  // Missing portraits are expected (they are probed and the SVG is used): not counted as failures.
  if (d.method === "Network.responseReceived" && p.response.status >= 400 && !/favicon|\/images\/avatar\//.test(p.response.url)) bad.push(p.response.status + " " + p.response.url);
  if (d.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true });
};
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result.result.value;
};
const waitFor = (expr, ms = 15000) => ev(`(async()=>{const t0=Date.now();while(Date.now()-t0<${ms}){try{if(${expr})return true}catch(e){}await new Promise(r=>setTimeout(r,50))}return false})()`);
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log((c ? "PASS  " : "FAIL  ") + n + (x ? "  [" + x + "]" : "")); };
const viewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const type = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||""`);
const nav = async (url, local) => {
  if (local) for (const [k, v] of Object.entries(local)) await ev(`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})`);
  await send("Page.navigate", { url: BASE + url });
  await waitFor(`document.readyState==='complete'`, 8000);
  await sleep(300);
};
const smallTargets = () => ev(`[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&(r.height<48||r.width<48)}).map(e=>(e.id||e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))`);
const overflowX = () => ev(`document.documentElement.scrollWidth>innerWidth+1`);
const avatarState = () => ev(`(()=>{const p=document.querySelector('#patientPanel .portrait');if(p)return 'photo:'+p.getAttribute('data-state');const s=document.querySelector('#patientPanel svg.av');return s?'svg:'+s.getAttribute('data-state'):'none'})()`);
const idleSpeech = () => waitFor(`!document.querySelector('#patientPanel .meter.on') && !document.getElementById('sendBtn').disabled`, 6000);

/* ---------------- injected before every page: clock offset, fake speech output, fake speech recognition ---------------- */
const INJECT = `(()=>{try{
  if(!window.__skip){const o=performance.now.bind(performance);let off=0;performance.now=()=>o()+off;window.__skip=(s)=>{off+=s*1000};}
  const mode=localStorage.getItem('__fakeVoices')||'natural';
  const lists={natural:[['Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)','ar-SA'],['Maged','ar-SA'],['Samantha','en-US']],
    standard:[['Maged','ar-SA'],['Microsoft Naayf - Arabic (Saudi)','ar-SA'],['Samantha','en-US']],none:[['Samantha','en-US']]};
  const voices=(lists[mode]||lists.natural).map(([name,lang])=>({name,lang,voiceURI:name,localService:true,default:false}));
  window.__spoken=[];let current=null,timers=[];
  const synth={speaking:false,pending:false,paused:false,onvoiceschanged:null,getVoices:()=>voices,addEventListener(){},removeEventListener(){},
    speak(u){const w=String(u.text||'').split(/\\s+/).filter(Boolean).length;const rec={text:u.text,queued:performance.now(),voice:u.voice&&u.voice.name,rate:u.rate,lang:u.lang};
      window.__spoken.push(rec);current=u;synth.speaking=true;
      timers.push(setTimeout(()=>{rec.started=performance.now();u.onstart&&u.onstart({})},15));
      for(let i=0;i<w;i++)timers.push(setTimeout(()=>{u.onboundary&&u.onboundary({})},25+i*45));
      timers.push(setTimeout(()=>{synth.speaking=false;current=null;rec.ended=performance.now();u.onend&&u.onend({})},40+w*45));},
    cancel(){timers.forEach(clearTimeout);timers=[];const u=current;current=null;synth.speaking=false;if(u&&u.onend)u.onend({})},pause(){},resume(){}};
  Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
  window.SpeechSynthesisUtterance=function(t){this.text=t};
  if(localStorage.getItem('__fakeSR')==='1'){
    function FakeSR(){} FakeSR.prototype.start=function(){const self=this;const t=window.__nextUtterance||'';self.__t=[
      setTimeout(()=>{self.onresult&&self.onresult({resultIndex:0,results:[Object.assign([{transcript:t.slice(0,Math.ceil(t.length/2))}],{isFinal:false})]})},60),
      setTimeout(()=>{window.__interimSeen=document.getElementById('heardLine')?document.getElementById('heardLine').textContent:'';
        self.onresult&&self.onresult({resultIndex:0,results:[Object.assign([{transcript:t}],{isFinal:true})]});self.onend&&self.onend()},200)]};
    FakeSR.prototype.stop=function(){};FakeSR.prototype.abort=function(){(this.__t||[]).forEach(clearTimeout);this.onend&&this.onend()};
    window.SpeechRecognition=FakeSR;window.webkitSpeechRecognition=FakeSR;
  }
}catch(e){}})()`;

/* ---------------- fake backend + portrait files (request interception) ---------------- */
function crc32(buf) { let crc = 0xffffffff; for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
/** Neutral test portrait: coloured background (one colour per state) with a plain oval. Not a face, not a person. */
function png(w, h, [r, g, b]) {
  const row = w * 3 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * row + 1 + x * 3; const oval = ((x - w / 2) / (w * 0.3)) ** 2 + ((y - h * 0.42) / (h * 0.28)) ** 2 < 1;
    raw[o] = oval ? 200 : r; raw[o + 1] = oval ? 200 : g; raw[o + 2] = oval ? 200 : b; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PORTRAITS = { neutral: png(800, 1000, [60, 90, 110]), pain: png(800, 1000, [130, 40, 40]), worried: png(800, 1000, [120, 100, 30]), relieved: png(800, 1000, [40, 120, 70]) };
function wav(seconds) {
  const n = Math.round(24000 * seconds) * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
}
const FAKE = { latency: 300, reply: "طيب يا دكتور. الوجع يجي ويروح، وما أدري وش السبب.", tts: "error", calls: [] };
async function onPaused(p) {
  const url = p.request.url;
  const fulfill = (code, body, type) => send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: code,
    responseHeaders: [{ name: "Content-Type", value: type || "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
    body: Buffer.from(body).toString("base64") });
  const m = url.match(/\/booth05\/images\/avatar\/case01\/(\w+)\.jpg/);
  if (m) return PORTRAITS[m[1]] ? fulfill(200, PORTRAITS[m[1]], "image/png") : fulfill(404, "not found", "text/plain");
  let body = {};
  if (p.request.method === "GET") body = Object.fromEntries(new URL(url).searchParams);
  else { try { body = JSON.parse(p.request.postData || "{}"); } catch { body = {}; } }
  FAKE.calls.push({ t: Date.now(), action: body.action, body });
  const json = (o) => fulfill(200, JSON.stringify(o));
  switch (body.action) {
    case "ping": return json({ ok: true });
    case "participant": return json({ found: false });
    case "register": return json({ ok: true, created: true, name: body.name });
    case "score": return json({ counted: true, points: body.points });
    case "leaderboard": return json({ updatedAt: new Date().toISOString(), totalParticipants: 0, top: [], perBooth: {} });
    case "patientTurn": await sleep(FAKE.latency); return json({ ok: true, reply: FAKE.reply, leaked: false, model: "fake-flash-lite" });
    case "patientGrade": await sleep(200); return json({ ok: true, model: "fake-pro", result: { questionsAsked: [{ id: "Q2", credit: 1 }, { id: "Q4", credit: 1 }],
      diagnosis: { credit: 1 }, treatment: { optionId: "T1", credit: 1 }, injectionSuspected: false, total: 6.3 } });
    case "ttsSpeak": await sleep(150);
      return FAKE.tts === "ok" ? json({ ok: true, audio: wav(0.25).toString("base64"), mimeType: "audio/wav", model: "fake-tts" })
        : json({ error: "No TTS model is configured on the server (CONFIG.GEMINI_TTS_MODEL)." });
    default: return json({ error: "Unknown action." });
  }
}
const calls = (a) => FAKE.calls.filter((c) => c.action === a);

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
await send("Fetch.enable", { patterns: [{ urlPattern: "*script.google.com*" }, { urlPattern: "*script.googleusercontent.com*" }, { urlPattern: "*/booth05/images/avatar/case01/*" }] });

async function checkIn(sid, name) {
  await waitFor(`document.getElementById('ht-id')`);
  await type("#ht-id", sid); await type("#ht-name", name); await click(".ht-btn");
  return waitFor(`document.getElementById('startConsultBtn')`, 10000);
}
async function ask(q) {
  const n = await ev(`document.querySelectorAll('.bubble.patient:not(.thinking)').length`);
  await type("#textInput", q);
  await ev(`document.getElementById('textInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await waitFor(`document.querySelectorAll('.bubble.patient:not(.thinking)').length>${n} && !document.getElementById('sendBtn').disabled`, 8000);
  return ev(`[...document.querySelectorAll('.bubble.patient:not(.thinking)')].pop().lastChild.textContent`);
}
const SIZES = [["1080p", 1920, 1080], ["13in", 1280, 800]];

/* =================== Part A: mock mode =================== */
console.log("--- Part A: ?mock=1");
await viewport(1920, 1080);
await nav("booth05/?mock=1&case=case01");
await ev(`localStorage.clear()`);
await nav("booth05/?mock=1&case=case01");
const CASES = await ev(`CASES`);
const c1 = CASES.find((c) => c.id === "case01");

ok("red DRAFT banner shown (cases PENDING_REVIEW)", await ev(`!document.getElementById('draftBanner').hidden && document.getElementById('draftBanner').textContent==='Sample cases — not yet approved by Dentistry'`));
ok("MOCK MODE badge shown", (await text(".ht-badge-mock")) === "MOCK MODE");
const hasSR = await ev(`!!(window.SpeechRecognition||window.webkitSpeechRecognition)`);
ok("voice banner matches SpeechRecognition support", (await ev(`document.getElementById('voiceBanner').hidden`)) === hasSR, "SpeechRecognition " + (hasSR ? "present" : "absent"));
ok("debug overlay hidden without ?debug=1", await ev(`document.getElementById('debugOverlay').hidden`));

ok("check-in -> start screen", await checkIn("999500001", "E2E Visitor One"));
ok("start screen shows case01 (forced by ?case=case01)", (await text(".patient .tag")).startsWith("Fahad, 34"));
ok("photo avatar used when all 4 portraits exist", (await ev(`document.getElementById('patientPanel').dataset.avatar`)) === "photo");
ok("photo avatar: 'AI-generated patient' caption", (await text("#patientPanel .ai-cap")) === "AI-generated patient");
ok("start screen shows the chosen voice + Natural badge", /Hamed.*Natural/.test(await text("#voiceTestVoice")) && await ev(`document.getElementById('voiceTestHint').hidden`), await text("#voiceTestVoice"));
for (const [n, w, h] of SIZES) {
  await viewport(w, h); await sleep(400); await shot(`1_start_photo_${n}`);
  ok(`portrait ${n}: 4:5, fully visible in the left panel`, await ev(`(()=>{const p=document.querySelector('.portrait').getBoundingClientRect(),c=document.getElementById('patientPanel').getBoundingClientRect();
    return Math.abs(p.width/p.height-0.8)<0.03 && p.left>=c.left && p.right<=c.right && p.top>=c.top && p.bottom<=innerHeight && p.height>=0.4*innerHeight})()`));
}
await viewport(1920, 1080);

await click("#settingsBtn"); await sleep(200);
ok("settings drawer: voice picker + chosen voice + badge", await ev(`!document.getElementById('drawer').hidden && document.getElementById('voiceSelect').options.length>=3 && /Natural/.test(document.getElementById('voiceChosen').textContent)`));
await ev(`(()=>{const s=document.getElementById('voiceSelect');s.value='Maged';s.dispatchEvent(new Event('change'))})()`);
ok("voice picker: choice is remembered and shown", (await ev(`localStorage.getItem('patient_voiceName')`)) === "Maged" && /Maged.*Standard/.test(await text("#voiceChosen")));
await ev(`(()=>{const s=document.getElementById('voiceSelect');s.value='';s.dispatchEvent(new Event('change'))})()`);
await shot("2_settings_1080p");
await click("#drawerClose");
await click("#langBtn");
ok("EN toggle", (await text("#langBtn")) === "EN");
await click("#langBtn");
ok("back to AR", (await text("#langBtn")) === "AR");

await click("#voiceTestBtn");
ok("voice test finishes and reports (no mic in headless)", await waitFor(`!document.getElementById('voiceTestBtn').disabled`, 20000), await text("#voiceTestResult"));

await ev(`window.__spoken.length=0`);
await click("#startConsultBtn");
ok("consultation screen with timer", await waitFor(`document.getElementById('talkBtn') && !document.getElementById('timerBar').hidden`));
ok("timer starts at 5:00", /^(5:00|4:5\d)$/.test(await text("#timerText")), await text("#timerText"));
ok("opener said in pain (portrait state)", (await avatarState()) === "photo:pain", await avatarState());
ok("patient opener shown", (await waitFor(`document.querySelector('.bubble.patient')`)) && (await text(".bubble.patient")).includes(c1.profile.opener));
ok("voice meter animates while speaking", await waitFor(`document.querySelector('#patientPanel .meter.on')`, 2000));
await idleSpeech();
ok("opener spoken sentence by sentence, in order, Natural voice at rate 1.0",
  JSON.stringify(await ev(`window.__spoken.map(s=>s.text)`)) === JSON.stringify(await ev(`splitSentences(${JSON.stringify(c1.profile.opener)})`)) &&
  (await ev(`window.__spoken.length>=2 && window.__spoken.every(s=>/Hamed/.test(s.voice)&&s.rate===1)`)), JSON.stringify(await ev(`window.__spoken.map(s=>[s.text,s.voice,s.rate])`)));
ok("offline-patient chip shown in mock mode", await ev(`!document.getElementById('offlineChip').hidden`));
await type("#textInput", "x"); await click("#sendBtn"); await sleep(200);
ok("1-character input ignored", (await text("#consultMsg")).includes("Too short") && (await ev(`document.querySelectorAll('.bubble.dentist').length`)) === 0);
if (hasSR) {
  await click("#talkBtn");
  const settled = await waitFor(`!document.getElementById('talkBtn').classList.contains('listening')`, 12000);
  ok("Tap to talk without a microphone degrades gracefully", settled && (await text("#consultMsg")).length > 0, await text("#consultMsg"));
}
await idleSpeech();
await type("#textInput", "كم تعطي الألم من عشرة؟");
await ev(`document.getElementById('textInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
await sleep(60);
ok("severity question -> worried state (crossfade)", (await avatarState()) === "photo:worried", await avatarState());
await idleSpeech(); await sleep(100);
ok("after the answer -> back to the case's base state (pain)", (await avatarState()) === "photo:pain", await avatarState());

const PH = JSON.parse(fs.readFileSync(new URL("./fixtures/fallback_phrasings.json", import.meta.url), "utf8")).phrasings.case01;
let allRight = true;
for (const q of c1.keyQuestions) {
  const r = await ask(PH[q.id][0]);
  if (r !== q.answer) { allRight = false; console.log("      " + q.id + " got: " + r); }
}
ok("8 typed questions -> 8 correct scripted answers", allRight);
ok("asking for the diagnosis -> patient doesn't know", (await ask("وش التشخيص يا ترى؟")) === "ما أدري يا دكتور، عشان كذا جيتك.");
ok("transcript scrolls inside its panel (page does not overflow sideways)", !(await overflowX()));
for (const [n, w, h] of SIZES) {
  await viewport(w, h); await sleep(300); await shot(`3_consult_photo_${n}`);
  ok(`consult ${n}: fits on one screen (no vertical scroll)`, await ev(`document.documentElement.scrollHeight<=innerHeight`), await ev(`document.documentElement.scrollHeight+' > '+innerHeight`));
  ok(`consult ${n}: touch targets >= 48 px`, (await smallTargets()).length === 0, (await smallTargets()).join(", "));
}
await viewport(1920, 1080);

await click("#readyBtn");
ok("I'm ready -> diagnosis step, timer hidden", await waitFor(`document.getElementById('diagnosisInput') && document.getElementById('timerBar').hidden`));
await click("#nextStepBtn");
ok("empty diagnosis is not accepted", await ev(`!!document.getElementById('diagnosisInput')`));
await type("#diagnosisInput", "Symptomatic irreversible pulpitis");
await shot("4_diagnosis_1080p");
await click("#nextStepBtn");
ok("treatment step", await waitFor(`document.getElementById('treatmentInput')`));
await type("#treatmentInput", "Start root canal treatment (pulpectomy) today, then a crown");
await click("#submitBtn");

ok("tutor feedback screen", await waitFor(`document.getElementById('feedback')`, 10000));
ok("score 10 / 10 (8/8 questions, diagnosis, correct plan)", (await text("#totalScore")) === "10 / 10", await text("#totalScore"));
ok("Preliminary grading label in mock mode", (await text("#gradingMode")) === "Preliminary grading");
ok("8 key questions listed, all asked", await ev(`document.querySelectorAll('#questionList li.good').length===8`));
ok("matched plan T1", (await text("#matchedPlan")).startsWith("Pulp therapy"));
for (const [n, w, h] of SIZES) {
  await viewport(w, h); await sleep(300); await shot(`6_feedback_${n}`);
  ok(`feedback ${n}: next button visible without scrolling`, await ev(`document.getElementById('toOutcomeBtn').getBoundingClientRect().bottom<=innerHeight`));
  ok(`feedback ${n}: touch targets >= 48 px, no sideways scroll`, (await smallTargets()).length === 0 && !(await overflowX()), (await smallTargets()).join(", "));
}
await viewport(1920, 1080);

await click("#toOutcomeBtn");
ok("after-7-days screen", await waitFor(`document.getElementById('outcome')`));
ok("outcome tier 'Healed' with the pre-written text", (await text("#outcomeTier")) === "Healed" && (await text("#outcomeText")) === c1.treatmentOptions[0].outcome);
await sleep(300);
ok("relieved portrait for a good outcome", (await avatarState()) === "photo:relieved", await avatarState());
for (const [n, w, h] of SIZES) {
  await viewport(w, h); await sleep(400); await shot(`7_outcome_photo_${n}`);
  ok(`outcome ${n}: fits on one screen`, await ev(`document.documentElement.scrollHeight<=innerHeight`));
}
await viewport(1920, 1080);

await click("#toResultBtn");
ok("result screen", await waitFor(`document.getElementById('final')`));
ok("saved to the (mock) Sheet", await waitFor(`/added to the leaderboard/.test(document.getElementById('saveStatus').textContent)`, 5000), await text("#saveStatus"));
const saved = await ev(`JSON.parse(localStorage.getItem('htMockDb')).scores.filter(s=>s.booth==='booth05'&&s.studentId==='999500001')`);
ok("mock Sheet row: booth05, 10 points, case01, healed, sources, photo avatar", saved.length === 1 && saved[0].points === 10 && saved[0].details.caseId === "case01" &&
  saved[0].details.outcomeTier === "healed" && /^o[fs]+$/.test(saved[0].details.sources) && saved[0].details.avatar === "photo", JSON.stringify(saved[0] && saved[0].details));
ok("idle countdown shown", /^Resets for the next visitor in 1:[23]\d$/.test(await text("#idleNote")), await text("#idleNote"));
for (const [n, w, h] of SIZES) {
  await viewport(w, h); await sleep(300); await shot(`8_result_${n}`);
  ok(`result ${n}: Next visitor visible without scrolling`, await ev(`document.getElementById('nextVisitorBtn').getBoundingClientRect().bottom<=innerHeight`));
}
await viewport(1920, 1080);
await ev(`window.__skip(91)`);
ok("auto-reset after 90 s of inactivity -> check-in", await waitFor(`document.getElementById('ht-id')`, 3000));

// ?avatar=svg forces the illustration even when portraits exist
await nav("booth05/?mock=1&case=case01&avatar=svg");
await checkIn("999500003", "E2E Svg");
ok("?avatar=svg -> SVG illustration although the portraits exist", (await ev(`document.getElementById('patientPanel').dataset.avatar`)) === "svg" &&
  (await ev(`!!document.querySelector('#patientPanel svg.av') && !document.querySelector('.portrait')`)));
await click("#startConsultBtn"); await waitFor(`document.getElementById('talkBtn')`); await ask("من متى بدأ معك الألم؟");
for (const [n, w, h] of SIZES) {
  await viewport(w, h); await sleep(300); await shot(`3_consult_svg_${n}`);
  ok(`consult (SVG) ${n}: fits on one screen`, await ev(`document.documentElement.scrollHeight<=innerHeight`), await ev(`document.documentElement.scrollHeight+' > '+innerHeight`));
}
await viewport(1920, 1080);

// Visitor 2: random case (no portrait files) -> silent SVG fallback; timer runs out -> decision
await nav("booth05/?mock=1");
ok("visitor 2 check-in", await checkIn("999500002", "E2E Visitor Two"));
ok("visitor 2 gets a different case than the previous visitor", !(await text(".patient .tag")).startsWith("Fahad"), await text(".patient .tag"));
ok("missing portrait files -> SVG fallback, no error shown", (await ev(`document.getElementById('patientPanel').dataset.avatar`)) === "svg");
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

await send("Page.navigate", { url: BASE + "dashboard/?mock=1" });
ok("dashboard: Virtual Patient top 3 lists visitor 1 with case/outcome/duration",
  await waitFor(`[...document.querySelectorAll('#b05 li')].some(li=>li.textContent.includes('E2E Visitor One')&&li.textContent.includes('case01 · Healed'))`, 8000), await text("#b05"));
ok("dashboard: other boards still filled", await ev(`document.querySelectorAll('#b03 li').length>0 && document.querySelectorAll('#b06 li').length>0 && document.querySelectorAll('.row .chip.b05').length>0`));
await sleep(600); await shot("9_dashboard_1080p");
ok("dashboard 1080p: nothing cut off, names readable", await ev(`(()=>{const b=[...document.querySelectorAll('aside .panel')].pop().getBoundingClientRect();const rows=[...document.querySelectorAll('.row')];return b.bottom<=innerHeight+1&&rows.every(r=>r.scrollWidth<=r.clientWidth+1)&&[...document.querySelectorAll('.row .name')].every(n=>n.clientWidth>=250)})()`));
ok("Part A: no exceptions or console errors", errs.length === 0, errs.join(" | "));
ok("Part A: no external network calls in mock mode", external.length === 0, external.join(" | "));
ok("Part A: no failed requests (missing portraits excepted)", bad.length === 0, bad.join(" | "));

/* =================== Part B: fake backend (AI path, speed features) =================== */
console.log("--- Part B: fake Apps Script backend, ?debug=1, fake speech recognition");
errs = []; external = []; bad = []; FAKE.calls.length = 0;
await nav("booth05/?debug=1&case=case01", { __fakeSR: "1", __fakeVoices: "natural" });
ok("debug overlay visible with ?debug=1", await ev(`!document.getElementById('debugOverlay').hidden`));
ok("warm-up ping on page load", (await waitFor(`true`, 10)) && calls("ping").length >= 1);
const pings0 = calls("ping").length;
await checkIn("999500010", "E2E Fake Backend");
ok("warm-up ping again on the start screen", calls("ping").length > pings0);
const pings1 = calls("ping").length;
await ev(`window.__skip(1)`);
await click("#startConsultBtn");
await waitFor(`document.getElementById('talkBtn')`);
await idleSpeech();

// 1) confident question -> scripted answer instantly, no AI call
let n0 = calls("patientTurn").length;
const fastAns = await ask("من متى بدأ معك الألم؟");
ok("FAST_SCRIPTED_FIRST: confident question answered from the script, no AI call", fastAns === c1.keyQuestions[1].answer && calls("patientTurn").length === n0);
await waitFor(`/path: scripted \\(fast\\)/.test(document.getElementById('debugOverlay').textContent)`, 3000);
const tFast = (await ev(`window.__patientTimings`)).pop();
ok("debug overlay: fast path shown with timings", tFast.total !== "—" && tFast.sentToReply === "—", await text("#debugOverlay"));

// 2) open question -> AI (fake backend, 300 ms), sentence-chunked speech, overlay with 4 durations + model
await idleSpeech();
await ev(`window.__spoken.length=0`);
n0 = calls("patientTurn").length;
const aiAns = await ask("كيف كانت الإجازة؟");
ok("AI path: reply from the backend", aiAns === FAKE.reply && calls("patientTurn").length === n0 + 1);
const body = calls("patientTurn").pop().body;
ok("request: system prompt + turns + text (diagnosis not in the system prompt)", typeof body.system === "string" && Array.isArray(body.turns) &&
  body.text === "كيف كانت الإجازة؟" && !("prompt" in body) && !body.system.includes(c1.diagnosis.label));
await idleSpeech();
ok("reply spoken sentence by sentence, in order", JSON.stringify(await ev(`window.__spoken.map(s=>s.text)`)) === JSON.stringify(await ev(`splitSentences(${JSON.stringify(FAKE.reply)})`)),
  JSON.stringify(await ev(`window.__spoken.map(s=>s.text)`)));
ok("audio starts after the first sentence (before the next one is queued)", await ev(`window.__spoken.length>=2 && window.__spoken[0].started < window.__spoken[1].queued`));
await waitFor(`/model: fake-flash-lite/.test(document.getElementById('debugOverlay').textContent)`, 3000);
const ov = await text("#debugOverlay");
ok("debug overlay: 4 durations + model", /final→sent \d+ ms \| sent→reply \d+ ms \| reply→voice \d+ ms \| total \d+ ms/.test(ov) && /model: fake-flash-lite · path: ai/.test(ov), ov);
const tAi = (await ev(`window.__patientTimings`)).pop();

// 3) many turns -> only the last 8 are sent
for (const q of ["هل تنام زين؟", "وش شغلك؟", "تحب القهوة؟", "كم عمرك؟"]) { await idleSpeech(); await ask(q); }
const lastTurns = calls("patientTurn").pop().body.turns;
ok("only the last 8 turns are sent", lastTurns.length === 8, "sent " + lastTurns.length + " of " + ((await ev(`document.querySelectorAll('.bubble:not(.thinking)').length`)) - 1));

// 4) slow backend -> pre-written filler after 1.2 s, then the reply (filler cut off)
FAKE.latency = 1800;
await idleSpeech();
await ev(`window.__spoken.length=0`);
await type("#textInput", "وش رايك في الزحمة اليوم؟");
await ev(`document.getElementById('textInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
await sleep(300);
ok("thinking indicator on the patient while waiting", await ev(`document.getElementById('patientPanel').classList.contains('thinking') && !!document.getElementById('thinkingBubble')`));
await waitFor(`!document.getElementById('sendBtn').disabled`, 6000);
await idleSpeech();
const spokenSlow = await ev(`window.__spoken.map(s=>s.text)`);
ok("slow reply: a pre-written filler first, then the reply", (await ev(`FILLERS.ar.includes(window.__spoken[0].text)`)) && spokenSlow[1] === (await ev(`splitSentences(${JSON.stringify(FAKE.reply)})[0]`)), JSON.stringify(spokenSlow));
FAKE.latency = 300;

// 5) voice turn with fake recognition: Heard line, re-say
await idleSpeech();
await ev(`window.__nextUtterance='كيف الجو عندكم اليوم'`);
const nMarks = await ev(`window.__patientTimings.length`);
await click("#talkBtn");
await waitFor(`[...document.querySelectorAll('.bubble.dentist')].pop().lastChild.textContent==='كيف الجو عندكم اليوم'`, 4000);
ok("'Heard:' line shows the interim transcript while listening", /^Heard: كيف الج/.test(await ev(`window.__interimSeen`)), await ev(`window.__interimSeen`));
await waitFor(`!document.getElementById('sendBtn').disabled && !document.getElementById('resayBtn').hidden && window.__patientTimings.length>${nMarks}`, 5000);
const tVoice = (await ev(`window.__patientTimings`))[nMarks];
const before = await ev(`document.querySelectorAll('.bubble:not(.thinking)').length`);
ok("'Tap to re-say' offered after a voice question", !(await ev(`document.getElementById('resayBtn').hidden`)));
await ev(`window.__nextUtterance='كيف الطقس عندكم اليوم'`);
await click("#resayBtn");
await waitFor(`[...document.querySelectorAll('.bubble.dentist')].pop().lastChild.textContent==='كيف الطقس عندكم اليوم' && !document.getElementById('sendBtn').disabled`, 5000);
await waitFor(`document.querySelectorAll('.bubble:not(.thinking)').length===${before}`, 3000);
const after = await ev(`document.querySelectorAll('.bubble:not(.thinking)').length`);
ok("re-say: last question + its answer replaced by the new one", after === before && !(await ev(`[...document.querySelectorAll('.bubble.dentist')].some(b=>b.lastChild.textContent==='كيف الجو عندكم اليوم')`)), before + " -> " + after);
await idleSpeech();
await shot("10_consult_debug_1080p");
await ev(`window.__skip(241)`);
for (let i = 0; i < 70 && calls("ping").length <= pings1; i++) await sleep(100);
ok("warm-up ping repeats every 4 minutes", calls("ping").length > pings1);

// 6) grading through the (fake) backend
await click("#readyBtn");
await waitFor(`document.getElementById('diagnosisInput')`);
await type("#diagnosisInput", "irreversible pulpitis"); await click("#nextStepBtn");
await waitFor(`document.getElementById('treatmentInput')`);
await type("#treatmentInput", "root canal treatment"); await click("#submitBtn");
ok("graded by the (fake) backend", (await waitFor(`document.getElementById('gradingMode')`, 10000)) && (await text("#gradingMode")) === "Graded by AI against the key");
await sleep(600);
const scoreBody = calls("score").pop();
ok("saved score marks fast / AI turns in 'sources'", !!scoreBody && /^o.*f.*a/.test(scoreBody.body.details.sources) && scoreBody.body.booth === "booth05", scoreBody && scoreBody.body.details.sources);
ok("Part B: no exceptions or console errors", errs.length === 0, errs.join(" | "));
ok("Part B: the only external host is the Apps Script URL (intercepted)", external.every((u) => /^https:\/\/script\.google(usercontent)?\.com\//.test(u)), [...new Set(external.map((u) => new URL(u).host))].join(", "));

// 7) ?tts=gemini: backend voice fails -> browser voice takes over; backend voice works -> <audio>, no browser voice
for (const mode of ["error", "ok"]) {
  FAKE.tts = mode; FAKE.calls.length = 0;
  await nav("booth05/?tts=gemini&case=case01", { __fakeSR: "1" });
  await checkIn("99950002" + (mode === "ok" ? "1" : "0"), "E2E TTS " + mode);
  await ev(`window.__spoken.length=0`);
  await click("#startConsultBtn");
  await waitFor(`document.querySelector('.bubble.patient')`, 5000);
  await sleep(mode === "ok" ? 2500 : 1500);
  const spoken = await ev(`window.__spoken.map(s=>s.text)`);
  const nOpen = await ev(`splitSentences(${JSON.stringify(c1.profile.opener)}).length`);
  if (mode === "error") ok("?tts=gemini + backend error -> browser voice speaks every sentence", calls("ttsSpeak").length >= 1 && spoken.length === nOpen, JSON.stringify(spoken));
  else ok("?tts=gemini + backend audio -> played via <audio> sentence by sentence, browser voice not used", calls("ttsSpeak").length === nOpen && spoken.length === 0,
    calls("ttsSpeak").length + " tts calls, browser spoke " + JSON.stringify(spoken));
}

/* =================== Part C: voice auto-selection =================== */
console.log("--- Part C: voice auto-selection");
for (const [mode, expName, expQ, hint] of [["natural", "Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)", "Natural", false], ["standard", "Maged", "Standard", true],
  ["none", "Browser default", "Standard", true]]) {
  await nav("booth05/?mock=1", { __fakeVoices: mode, __fakeSR: "0", patient_voiceName: "" });
  await click("#settingsBtn"); await sleep(200);
  const line = await text("#voiceChosen");
  ok(`voices '${mode}': auto-selects ${expName} (${expQ})`, line.includes(expName) && (await ev(`document.querySelector('#voiceChosen .q-badge').dataset.quality`)) === expQ, line);
  ok(`voices '${mode}': Edge hint ${hint ? "shown" : "hidden"}`, (await ev(`!document.getElementById('edgeHint').hidden`)) === hint);
  if (mode === "standard") await shot("11_settings_standard_1080p");
  await click("#drawerTest"); await sleep(500);
  const r = await ev(`window.__spoken.map(s=>[s.voice||null,s.rate])`);
  ok(`voices '${mode}': rate ${expQ === "Natural" ? "1.0" : "0.92"}, sample spoken with that voice`, r.length > 0 && r.every(([v, rate]) => rate === (expQ === "Natural" ? 1 : 0.92) && (mode === "none" ? v === null : v === expName)), JSON.stringify(r));
}

console.log("\nMeasured with ?debug=1 (fake backend latency 300 ms, fake speech output):");
for (const [n, t] of [["typed, fast scripted", tFast], ["typed, AI", tAi], ["voice, AI", tVoice]]) {
  console.log(`  ${n.padEnd(22)} final→sent ${t.finalToSent.padStart(7)} | sent→reply ${t.sentToReply.padStart(7)} | reply→voice ${t.replyToVoice.padStart(7)} | total ${t.total.padStart(7)} | ${t.model} / ${t.path}`);
}
console.log(`\n${pass} passed, ${fail} failed. Screenshots: ${OUT}`);
ws.close();
await new Promise((r) => { chrome.once("exit", r); chrome.kill(); setTimeout(r, 3000); });
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp dir, ignore */ }
process.exit(fail ? 1 : 0);
