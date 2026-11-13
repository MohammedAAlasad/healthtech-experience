# HealthTech Experience — event repo

Programming Club, College of Dentistry, IAU. One repo, one folder per booth. GitHub Pages serves the **repo root**.

| Folder | What it is |
|---|---|
| `index.html` | Landing page with links to every booth and the leaderboard |
| `booth06/` | **Booth 06 – Clinical Diagnosis Challenge** (max 40): `index.html`, `data/`, `review/`, `tools/` |
| `booth03/` | **Booth 03 – Read the Scan** (max 30): `index.html`, `images/`, `data/`, `review/`, `tools/` (details: `booth03/README.md`) |
| `booth05/` | **Booth 05 – Virtual Patient** (max 10): voice consultation with an AI patient; `index.html`, `data/`, `tools/` (details: `booth05/README.md`, backend update: `booth05/DEPLOY.md`) |
| `booth02/` | Booth 02 takeaway page |
| `dashboard/` | TV leaderboard |
| `shared/shared.js` | The single shared client for all booths: check-in form, API calls, offline queue, mock mode |
| `apps-script/Code.gs` | Backend (Google Sheet + Apps Script): storage, rules, leaderboard, Gemini grading |
| `tools/` | Shared backend tools: `smoke_test.py`, `seed_fake_data.py` |
| `briefs/` | Original build briefs + `INTEGRATION.md` (how a booth plugs in) |
| `DECISIONS.md` | Small decisions made during the builds |

No barcode/camera: the operator types the University ID and name, presses Start, and the score is saved under that ID. Only the **first attempt per booth counts**.

> ⚠️ All medical cases are **DRAFT** until the dentistry team approves them. Each booth shows a red banner while any served case is not `APPROVED`.

Run every command below from the **repo root**. On macOS use `python3`; on Windows use `python`.

---

## a. Run locally in mock mode (no backend needed)

1. `python3 -m http.server 8000`
2. Open:
   - http://localhost:8000/?mock=1 (landing page; its links keep `?mock=1`)
   - http://localhost:8000/booth06/?mock=1 (Booth 06)
   - http://localhost:8000/booth03/?mock=1 (Booth 03)
   - http://localhost:8000/booth05/?mock=1 (Booth 05; voice needs Chrome or Edge)
   - http://localhost:8000/dashboard/?mock=1 (TV leaderboard)
3. Mock mode stores everything in the browser's `localStorage` and shows a yellow **MOCK MODE** badge. All pages are on one origin, so scores from both booths show up on the dashboard in the same browser.
4. Optional console helpers (DevTools > Console): `htMockOffline(true)` simulates a Wi-Fi drop, `htMockOffline(false)` restores it, `htMockReset()` clears mock data, `runScoringTests()` (on Booth 06) runs the scoring tests.

Mock mode is also used automatically while `API_URL` in `shared/shared.js` is empty.

## b. Deploy the backend (Google Sheet + Apps Script)

1. Sign in with the **club** Google account. Go to https://sheets.new to create a new Google Sheet. Name it `HealthTech Experience Scores`.
2. In the Sheet: **Extensions > Apps Script**.
3. Delete the sample code in `Code.gs`, paste the full contents of `apps-script/Code.gs`, and click **Save** (disk icon).
4. Gemini key: open https://aistudio.google.com, click **Get API key > Create API key**, then copy it.
5. In Apps Script: **Project Settings** (gear icon, left) > **Script Properties** > **Add script property** > Property `GEMINI_API_KEY`, Value = the key > **Save script properties**.
6. Back in the **Editor** (`< >` icon): in `Code.gs`, set `CONFIG.GEMINI_MODEL` to the current Flash model name shown in AI Studio (the model picker shows the id). Save.
7. In the function dropdown at the top, choose `setup` and click **Run**. Approve the permission prompts (Review permissions > choose the club account > Advanced > Go to project (unsafe) > Allow). This creates the `Participants` and `Scores` tabs.
8. **Deploy > New deployment** > gear icon next to "Select type" > **Web app**.
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then **Authorize access** if asked.
9. Copy the **Web App URL** (ends with `/exec`).
10. Browser test: open `<URL>?action=ping` (should show `{"ok":true,...}`) and `<URL>?action=leaderboard`.

## c. Connect the web pages + smoke test

1. Open `shared/shared.js` and paste the URL into **line 8**:
   `const API_URL = "https://script.google.com/macros/s/XXXX/exec";`
   This one file is used by every booth and the dashboard.
2. Run `python3 tools/smoke_test.py "<WEB_APP_URL>"`. Every line must say PASS.
3. Clean up the fake rows: Apps Script editor > function dropdown > `clearTestData` > **Run** (deletes every row whose ID starts with `999`).

## d. Update Code.gs later WITHOUT changing the URL

1. Paste the new code, then **Save**.
2. **Deploy > Manage deployments** > pencil icon (Edit) on the existing deployment.
3. **Version: New version** > **Deploy**. The URL stays the same.

(Creating a *new deployment* instead would give a new URL, and `shared/shared.js` would need updating.)

## e. Publish on GitHub Pages (repo root)

1. Push to `main` (see the git commands in the last change summary).
2. On GitHub: **Settings > Pages > Build and deployment > Source: Deploy from a branch > Branch: `main`, folder `/ (root)` > Save**.
3. Wait 1–2 minutes and refresh until "Your site is live at https://<you>.github.io/<repo>/" appears.
4. Event laptops:
   - Booth 06 laptop: `https://<you>.github.io/<repo>/booth06/`
   - Booth 03 laptop: `https://<you>.github.io/<repo>/booth03/`
   - Booth 05 laptop (Chrome or Edge, headset): `https://<you>.github.io/<repo>/booth05/`
   - TV: `https://<you>.github.io/<repo>/dashboard/` (press F11 for full screen)

The empty `.nojekyll` file tells GitHub Pages to serve the files as they are (no Jekyll processing).

**Everything in the repo is public on the Pages site** (briefs, answer keys, review files, Code.gs, not just the booth pages). There are no secrets in the repo, and the answers are inside the booth pages anyway. If the Booth 03 X-ray images may not be public, see `booth03/README.md` § 3.

## f. Pre-event test checklist

- [ ] Use one **real** student ID + name at Booth 06 and at Booth 03. The dashboard total = both scores added.
- [ ] Play again with the same ID: it says "Practice attempt — not counted" and the total does not change.
- [ ] Load test from two booths at once: `python3 tools/seed_fake_data.py "<WEB_APP_URL>" --n 20` reports 0 errors and 0 mismatches.
- [ ] Check totals and ranking on the dashboard (ties: whoever reached the total first ranks higher).
- [ ] Run `clearTestData()` in the Apps Script editor to remove all `999…` test rows.
- [ ] Wi-Fi drop: turn Wi-Fi off on a booth laptop and finish a round. You should see "No connection…" plus an orange "1 unsent score" badge. Turn Wi-Fi back on: within 15 s the badge disappears and the score is on the dashboard. A reload while offline keeps the queue.
- [ ] Booth 03 extras (keyboard, grader test): `booth03/README.md` § 4–5.
- [ ] Booth 05 extras (headset, voice test, model names): `booth05/README.md` § 4 and `booth05/DEPLOY.md`.
- [ ] After prizes are given: delete all rows except the header in both tabs, or delete the Sheet.

## g. Known limits

- Answers are inside the pages: a visitor could read them in view-source. It's a fun event game, not an exam.
- The Web App URL is the only protection: anyone with it can call the API (and look up a name by student ID). Don't post it publicly; delete the data after the event.
- No secrets are in the repo: the Gemini key lives only in Script Properties.
- Apps Script handles about 30 simultaneous requests; plenty for a few booths, but requests take 1–3 s each.

## Editing the Booth 06 cases

1. Edit `booth06/data/cases.json` (or apply the dentistry team's comments from `booth06/review/cases_for_review.md`).
2. `python3 booth06/tools/validate_cases.py booth06/data/cases.json`
3. `python3 booth06/tools/inject_cases.py` (copies the cases into `booth06/index.html`; it refuses if validation fails)
4. `python3 booth06/tools/export_review.py` (regenerates the printable review document)
5. Only set `"reviewStatus": "APPROVED"` on a case after the dentistry team has approved it. The red banner disappears only when **every** case is APPROVED.

Booth 03 cases: `booth03/README.md` § 2. Booth 05 cases: `booth05/README.md` § 6.

## Tests

```
python3 booth06/tools/validate_cases.py booth06/data/cases.json
python3 booth06/tools/inject_cases.py
python3 booth03/tools/validate_cases.py booth03/data/cases.json
python3 booth03/tools/inject_cases.py
node booth03/tools/test_guard.js
python3 booth03/tools/prepare_ai_readings.py --self-test
python3 booth05/tools/validate_cases.py
node booth05/tools/test_guard.js
python3 booth05/tools/patient_guard.py --self-test
node booth05/tools/test_backend.js               # Code.gs with fake Apps Script services
node booth05/tools/e2e_mock.mjs                  # needs python3 -m http.server 8000 running + Chrome
python3 tools/smoke_test.py "<WEB_APP_URL>"      # needs the deployed backend
```
Booth 06 scoring tests: open `booth06/?mock=1`, then run `runScoringTests()` in the console.

## Adding a booth

Create `boothNN/index.html`, load `<script src="../shared/shared.js"></script>`, and follow `briefs/INTEGRATION.md`. Add a link to the root `index.html`.
