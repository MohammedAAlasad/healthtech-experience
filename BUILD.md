# BUILD BRIEF — HealthTech Experience: Booth 06 game + shared score system

You are building this in ONE autonomous pass inside the current empty folder. Do not split it into days or sessions. Work through everything, test what you can, and only stop to ask me when something truly needs my hands (listed in "What I must do myself"). When finished, print the final report described at the bottom.

## About me
University CS student. Don't explain concepts or terms to me; just build. Everything (code, comments, UI text, README) is in English. Don't ask questions the brief already answers; make small decisions yourself and log them in DECISIONS.md. For steps I must do outside the terminal, give short numbered click-by-click steps only.

## What we are building
Event "HealthTech Experience" (Programming Club, College of Dentistry, IAU). There is NO barcode or camera scanning. At each booth the booth operator types the player's university ID and name into a simple form, presses Start, and the player plays; the score is then saved under that ID automatically. Points from Booth 03 (Read the Scan, max 30) and Booth 06 (Clinical Diagnosis Challenge, max 40) go to a Google Sheet through a Google Apps Script backend and appear on a live leaderboard screen. I build Booth 06 and the shared system. Another person builds Booth 03 and must be able to plug into my system with ~5 lines of code.

## Hard rules
1. Medical content is never final until the dentistry team reviews it. All cases you write are `"reviewStatus":"DRAFT"`. `dx.html` shows a red banner "Sample cases — not yet approved by the dentistry team" while ANY served case is not "APPROVED". Never claim a case is reviewed. Use standard terminology (AAE for pulpal/periapical), conservative textbook-level content.
2. No secrets in the repo. Gemini key only in Apps Script Script Properties (`GEMINI_API_KEY`). Do not hardcode a Gemini model name: `CONFIG.GEMINI_MODEL = "REPLACE_WITH_CURRENT_FLASH_MODEL_FROM_AI_STUDIO"`.
3. Privacy: only student number + name. Leaderboard responses return only the last 4 digits of IDs. Render names with `textContent`, never `innerHTML`. In Code.gs prefix any text starting with `= + - @` with `'` (formula injection). Names max 60 chars.
4. Vanilla HTML/CSS/JS, no build step, no npm deps in the web app. No external scripts at all. Must run on GitHub Pages and locally via `python -m http.server`.
5. Big touch-friendly buttons (min 56px), huge readable text.

## Repo layout
```
README.md  DECISIONS.md  INTEGRATION.md
apps-script/Code.gs
docs/            (GitHub Pages root)
  shared.js  dx.html  dashboard.html  booth03_test.html
data/cases.json
review/cases_for_review.md
tools/validate_cases.py  inject_cases.py  smoke_test.py  seed_fake_data.py
```

## 1) Backend — apps-script/Code.gs
Google Apps Script web app bound to a Google Sheet; creates two tabs if missing:
- `Participants`: studentId | name | registeredAt
- `Scores`: time | studentId | name | booth | points | counted | details (JSON string)

`doGet` for reads, `doPost` for writes. POST body is JSON sent with `Content-Type: text/plain` (avoids the CORS preflight). All responses JSON via ContentService.
- `GET ?action=ping` -> `{ok:true,time}`
- `GET ?action=participant&studentId=` -> `{found,name}`
- `POST {action:"register",studentId,name}` -> create/update participant
- `POST {action:"score",studentId,booth,points,details}` -> append a row. `counted=TRUE` only for the student's FIRST row for that booth; later rows saved with `counted=FALSE`. Also accepts an optional `name`: if the student isn't in Participants yet (e.g. the earlier register call failed offline), create the participant from it. Returns `{counted,points}`. If `details.attemptId` already exists in Scores, don't append again; return the original result (safe retries).
- `GET ?action=leaderboard` -> `{updatedAt,totalParticipants,top:[{rank,name,idLast4,total,perBooth:{booth03,booth06}}],perBooth:{booth03:[top10],booth06:[top10]}}`. Top 20 by total of counted points; ties: whoever reached the total first (time of latest counted row) ranks higher.
- `POST {action:"grade",prompt,imageBase64?,mimeType?}` -> Gemini `generateContent` (generativelanguage.googleapis.com) with `responseMimeType: application/json`, returns parsed JSON; key from Script Properties only. (Used later by Booth 03.)
- Validation: studentId digits only 6–12 chars; booth in booth01..booth06; points 0–100 and ≤ `CONFIG.MAX_POINTS[booth]` (booth03:30, booth06:40). Errors as `{error:"..."}`.
- `LockService` around writes.
- `clearTestData()`: run manually from the editor (not exposed on the web); deletes rows whose studentId starts with `999`. All fake test IDs start with `999`.

## 2) shared.js (global functions, used by every booth)
- `API_URL` constant at top. If empty, or the URL has `?mock=1`, use MOCK MODE: a fake backend in `localStorage` implementing the same functions/rules (first attempt counts, per-booth max, leaderboard with demo rows). Show a small yellow "MOCK MODE" badge.
- `getParticipant, register, saveScore, getLeaderboard, grade`: fetch wrappers, 15 s timeout, friendly English error messages. `saveScore` automatically attaches the name entered in the last `startCheckIn`, and the offline queue stores it too.
- `startCheckIn(containerElement, onReady)`: a simple operator form with two big fields, "University ID" (auto-focused, numeric keypad on touch) and "Name", and a big "Start" button (Enter also submits). Validate the ID as 6–12 digits and the name as non-empty (max 60) with inline error messages. When the ID field has a valid ID, look it up with `getParticipant` and auto-fill the name if found (operator can still edit it). On Start: call `register` (creates or updates the participant), show "Welcome <name>" for 1 s, then `onReady({studentId,name})`. Keep the form usable offline: if `register`/`getParticipant` fail, continue with the typed values (the server will upsert the participant when the score is saved, see backend note below) and don't block the player.
- Offline safety: if `saveScore` fails, push to localStorage queue `pendingScores` (with attemptId), retry every 15 s, survive reloads, show a corner badge with the number of unsent scores.

## 3) Booth 06 — docs/dx.html
Includes shared.js. Top of script: `CASES` array between `// BEGIN CASES` and `// END CASES` (so `tools/inject_cases.py` can replace it from `data/cases.json`), and:
```js
const SCORING = { perAcceptedDifferential:4, maxDifferentials:12, wrongDifferential:-2,
  investigationsTotal:10, unnecessaryInvestigation:-2, finalDiagnosis:15,
  perMinuteLeft:1, maxSpeedBonus:3, speedBonusRequiresCorrectFinal:true,
  timeLimitSeconds:240, finalFromSelectedOnly:true };
```
Case schema: `{id,title,patient,chiefComplaint(English, in the patient's words),history(2-3 short lines),differentials[6],acceptedDifferentials[2-3],investigations[6 x {name,result,essential}],finalDiagnosis,teachingPoint,reviewStatus}`. 2–3 essential investigations, rest plausible but unnecessary, results written specifically for that patient.
Flow (one random case per visitor, not the same as the last one shown on this device; timer bar always visible):
0. `startCheckIn` -> "Welcome Dr. <name>"
1. Case card (patient, chief complaint, history). Button "Start Diagnosis" starts the timer.
2. Differentials: 6 big toggle buttons, select 2–3 (next disabled until 2, 4th blocked).
3. Investigations: 6 cards; tapping orders the test and flips the card to show its result (can't undo). Case card stays visible on the side.
4. Final diagnosis: pick one of the visitor's selected differentials, then "Submit Diagnosis".
5. Result: per-step breakdown (each step floored at 0), correct answers highlighted, teaching point, total /40. Call `saveScore(studentId,"booth06",total,{caseId,picks,attemptId})`. Show "Your points were added to the leaderboard" or, if `counted:false`, "Practice attempt — not counted". Button "New Participant" back to check-in.
Scoring: differentials = min(12, 4×acceptedPicked) − 2×wrongPicked; investigations = 10 split equally among essential tests, earned per essential ordered, −2 per unnecessary ordered; final = 15 if correct; speed = min(3, floor(secondsLeft/60)) only if final correct and submitted before timeout. Max 12+10+15+3 = 40. Timeout auto-submits whatever is selected. Works fully offline (cases inline); only saving needs network.
Include `runScoringTests()` (console-callable) covering: perfect run = 40, empty = 0, all wrong = 0, one unnecessary test, timeout submit. Run these tests yourself via node or a headless browser and show me the result.

## 4) data/cases.json — 8 DRAFT cases
Mix: endodontics, periodontics, oral medicine, oral surgery, pediatric dentistry, orthodontics. Case 1 must be: 25-year-old male, severe molar pain on cold water that lingers after the stimulus is removed. Differentials: Reversible pulpitis, Symptomatic irreversible pulpitis, Dentin hypersensitivity, Cracked tooth, Acute apical abscess + one more plausible option. Essential tests: Cold test, Percussion test, Periapical radiograph. Unnecessary: Bite test, Blood test, CBCT (results show why they add nothing here). Final: Symptomatic irreversible pulpitis.
Also write `review/cases_for_review.md`: clean printable doc for the dentistry team (per case: patient, complaint, history, the 6 differentials with accepted ones marked, 6 investigations with result + essential yes/no, final diagnosis, teaching point, and an "Approve / Edit / Reject + comment" line). Header: DRAFT, AI-generated, requires specialist review.

## 5) dashboard.html
`dashboard.html`: full-screen TV leaderboard, calls `getLeaderboard()` every 5 s. Title "Leaderboard" + "HealthTech Experience". Top 10: rank, name, last 4 digits, total, small per-booth breakdown (Read the Scan / Diagnosis Challenge). Gold/silver/bronze top 3, animate rank changes, flash a new entry for 3 s. Side panel: top 3 per booth + participants count. Dark theme, readable from 5 m. Show last-updated time; keep last data on screen if a request fails (never blank). `?mock=1` shows demo data.

## 6) Linking the dashboard with BOTH booths (03 and 06)
The dashboard doesn't talk to the booths directly: both booths write to the same Sheet through the same `API_URL`, and the dashboard reads it. So:
- Write `INTEGRATION.md` (English, short, copy-paste-ready for the person building Booth 03): include shared.js; the exact `<script>` lines; a 10-line example: `startCheckIn(container, ({studentId,name}) => { /* play */ })` then `saveScore(studentId, "booth03", points /*0-30*/, {attemptId: crypto.randomUUID(), rounds:[...]})`; the booth ids (`booth03`, `booth06`); the point caps; "first attempt counts"; how `grade()` works for Gemini grading; what the shared API_URL is; and how to test with `?mock=1`.
- Write `docs/booth03_test.html`: a tiny stand-in for Booth 03 (check-in, then three buttons giving 0/10/20/30 points, calls `saveScore(...,"booth03",...)`) so I can verify that Booth 03 + Booth 06 points add up on the dashboard before the real Booth 03 exists.
- `tools/smoke_test.py <WEB_APP_URL>` (stdlib only), with fake IDs starting `999`: register; score (first counted, second not counted); same attemptId twice (no duplicate row); invalid input rejected; points above the booth cap rejected; leaderboard has booth03+booth06 totals summed correctly; no full student ID in any leaderboard response. PASS/FAIL per check.
- `tools/seed_fake_data.py <WEB_APP_URL> [--n 20]`: creates fake participants and scores for both booths for load-testing.

## 7) tools
- `validate_cases.py data/cases.json`: schema check; exactly 6 differentials and 6 investigations; 2–3 accepted (all inside differentials); finalDiagnosis inside differentials AND accepted; 2–3 essential; unique ids; non-empty chief complaint. Readable errors.
- `inject_cases.py`: replaces the block between the markers in `docs/dx.html` with `const CASES = <json>;`; refuses to run if validation fails.

## 8) README.md (English, numbered steps)
a. Run locally in mock mode: `cd docs && python -m http.server 8000` -> open `http://localhost:8000/dx.html?mock=1`, `dashboard.html?mock=1`, `booth03_test.html?mock=1`.
b. Deploy the backend: create a Google Sheet under the club account > Extensions > Apps Script > paste Code.gs > Project Settings > Script Properties > add `GEMINI_API_KEY` (from aistudio.google.com > Get API key) and set `CONFIG.GEMINI_MODEL` > Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > authorize > copy the Web App URL. Browser test: `<URL>?action=ping`, `<URL>?action=leaderboard`.
c. Paste the URL into `API_URL` in docs/shared.js (say which line). Run smoke_test.py.
d. Update Code.gs later WITHOUT changing the URL: Deploy > Manage deployments > Edit > Version: New version > Deploy.
e. GitHub Pages: create repo, push, Settings > Pages > Deploy from branch `main`, folder `/docs`, wait for the https URL; the pages to open on event laptops (dx.html for Booth 06, dashboard.html for the TV).
f. Pre-event test checklist: enter a real student ID and name at both booths for the same person and confirm the points add up; 20 fake registrations from two booths at once (seed_fake_data.py); check totals and ranking on the dashboard; run `clearTestData()`; Wi-Fi drop behaviour (queue); wipe the Sheet after prizes are given.
g. Known limits: answers are inside the page (a visitor could read them in view-source); the Web App URL is the only protection; no secrets in the repo.

## Test before you report
Run `python tools/validate_cases.py data/cases.json`, `python tools/inject_cases.py`, `node --check` on all JS (extract inline scripts if needed), the scoring tests, and if a headless browser is available, load dx.html?mock=1, play a full round and confirm the score appears on dashboard.html?mock=1 (same browser storage). Fix everything you find. For Code.gs you can't run Apps Script; re-read it carefully and say so.

## What I must do myself (list these in the final report with exact steps, skip nothing)
1. Create/choose the club Google account, the Google Sheet, paste Code.gs, deploy, copy the Web App URL.
2. Get the Gemini API key and store it in Script Properties; set the Gemini model name.
3. Paste the Web App URL into `API_URL`; run the smoke test.
4. Create the GitHub repo and enable Pages.
5. Send `review/cases_for_review.md` to the dentistry team; later paste back their edits so you can set APPROVED.
6. Test with one real student ID at both booths.
7. Give `INTEGRATION.md` + the Web App URL + the GitHub Pages URL to the Booth 03 owner.

## Final report (print at the end)
1. Files created (one line each). 2. What I tested and results. 3. What I could NOT test. 4. My manual steps, numbered with exact clicks. 5. Three lines: `DONE:` / `NOT DONE:` / `NEXT:`.
