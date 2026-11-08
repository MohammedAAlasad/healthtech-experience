# HealthTech Experience — Booth 06 + shared score system

Programming Club, College of Dentistry, IAU.

- **Booth 06 – Clinical Diagnosis Challenge** (`docs/dx.html`, max 40 points)
- **Shared score system**: Google Sheet + Apps Script backend (`apps-script/Code.gs`), shared browser library (`docs/shared.js`), TV leaderboard (`docs/dashboard.html`)
- **Booth 03 – Read the Scan** (max 30) is built by someone else and plugs in via `INTEGRATION.md`. `docs/booth03_test.html` is a stand-in for testing.

No barcode/camera: the operator types the University ID and name, presses Start, and the score is saved under that ID. Only the **first attempt per booth counts**.

> ⚠️ All medical cases are **DRAFT** (AI-generated) until the dentistry team approves them. `dx.html` shows a red banner while any case is not `APPROVED`.

On macOS use `python3` (there is no `python` command by default). On Windows use `python`.

---

## a. Run locally in mock mode (no backend needed)

1. `cd docs && python3 -m http.server 8000`
2. Open:
   - http://localhost:8000/dx.html?mock=1 (Booth 06)
   - http://localhost:8000/dashboard.html?mock=1 (TV leaderboard)
   - http://localhost:8000/booth03_test.html?mock=1 (Booth 03 stand-in)
3. Mock mode stores everything in the browser's `localStorage` and shows a yellow **MOCK MODE** badge. All tabs in the same browser share the data, so a score from `dx.html` appears on `dashboard.html`.
4. Optional console helpers (DevTools > Console): `htMockOffline(true)` simulates a Wi-Fi drop, `htMockOffline(false)` restores it, `htMockReset()` clears mock data, `runScoringTests()` (on dx.html) runs the scoring tests.

Mock mode is also used automatically while `API_URL` in `docs/shared.js` is empty.

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

1. Open `docs/shared.js` and paste the URL into **line 8**:
   `const API_URL = "https://script.google.com/macros/s/XXXX/exec";`
2. From the repo root run: `python3 tools/smoke_test.py "<WEB_APP_URL>"`. Every line must say PASS.
3. Clean up the fake rows: Apps Script editor > function dropdown > `clearTestData` > **Run** (deletes every row whose ID starts with `999`).

## d. Update Code.gs later WITHOUT changing the URL

1. Paste the new code, then **Save**.
2. **Deploy > Manage deployments** > pencil icon (Edit) on the existing deployment.
3. **Version: New version** > **Deploy**. The URL stays the same.

(Creating a *new deployment* instead would give a new URL, and every booth would need updating.)

## e. Publish on GitHub Pages

1. Create a new repo on GitHub (e.g. `healthtech-experience`), public or private with Pages enabled.
2. From this folder:
   ```
   git init && git add . && git commit -m "Booth 06 + shared score system"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. On GitHub: **Settings > Pages > Build and deployment > Source: Deploy from a branch > Branch: `main`, folder `/docs` > Save**.
4. Wait 1–2 minutes and refresh the page until the green "Your site is live at https://<you>.github.io/<repo>/" appears.
5. Event laptops:
   - Booth 06 laptop: `https://<you>.github.io/<repo>/dx.html`
   - TV: `https://<you>.github.io/<repo>/dashboard.html` (press F11 for full screen)

## f. Pre-event test checklist

- [ ] Use one **real** student ID + name at Booth 06 (`dx.html`) and at Booth 03 (real Booth 03 or `booth03_test.html`). The dashboard total = both scores added.
- [ ] Play again with the same ID: it says "Practice attempt — not counted" and the total does not change.
- [ ] Load test from two booths at once: `python3 tools/seed_fake_data.py "<WEB_APP_URL>" --n 20` reports 0 errors and 0 mismatches.
- [ ] Check totals and ranking on the dashboard (ties: whoever reached the total first ranks higher).
- [ ] Run `clearTestData()` in the Apps Script editor to remove all `999…` test rows.
- [ ] Wi-Fi drop: turn Wi-Fi off on the booth laptop and finish a round. You should see "No connection…" plus an orange "1 unsent score" badge. Turn Wi-Fi back on: within 15 s the badge disappears and the score is on the dashboard. A reload while offline keeps the queue.
- [ ] After prizes are given: delete all rows except the header in both tabs, or delete the Sheet.

## g. Known limits

- Answers are inside the page: a visitor could read them in view-source. It's a fun event game, not an exam.
- The Web App URL is the only protection: anyone with it can call the API (and look up a name by student ID). Don't post it publicly; delete the data after the event.
- No secrets are in the repo: the Gemini key lives only in Script Properties.
- Apps Script handles about 30 simultaneous requests; plenty for a few booths, but requests take 1–3 s each.

## Editing the cases

1. Edit `data/cases.json` (or apply the dentistry team's comments from `review/cases_for_review.md`).
2. `python3 tools/validate_cases.py data/cases.json`
3. `python3 tools/inject_cases.py` (copies the cases into `docs/dx.html`; it refuses if validation fails)
4. `python3 tools/export_review.py` (regenerates the printable review document)
5. Only set `"reviewStatus": "APPROVED"` on a case after the dentistry team has approved it. The red banner disappears only when **every** case is APPROVED.

## Files

| Path | What it is |
|---|---|
| `apps-script/Code.gs` | Backend: Sheets storage, scoring rules, leaderboard, Gemini grading proxy |
| `docs/shared.js` | Shared library: API calls, check-in form, offline queue, mock mode |
| `docs/dx.html` | Booth 06 game |
| `docs/dashboard.html` | TV leaderboard |
| `docs/booth03_test.html` | Booth 03 stand-in for testing |
| `data/cases.json` | Source of truth for the cases |
| `review/cases_for_review.md` | Printable review document for the dentistry team |
| `tools/*.py` | validate, inject, export review, smoke test, load test |
| `INTEGRATION.md` | How Booth 03 plugs in |
| `DECISIONS.md` | Small decisions made during the build |
