# Booth 05 — Virtual Patient

The visitor plays the dentist and talks to an illustrated virtual patient through a headset (Saudi Arabic by default, EN toggle). They have 5 minutes to take a history. Then they say or type a diagnosis and a treatment plan, and the "clinical tutor" scores them out of 10: 5 for history (8 key questions), 3 for the diagnosis, 2 for the treatment. Next, the patient comes back "after 7 days" and says what happened (pre-written per case and per plan). The score goes to the shared leaderboard as `booth05`.

Vanilla HTML/CSS/JS, no build step. Page: `booth05/index.html`. Shared client: `shared/shared.js`. Backend: `apps-script/Code.gs` (update steps: `booth05/DEPLOY.md`).

> **Status:** 3 DRAFT cases (`PENDING_REVIEW`). The red banner "Sample cases — not yet approved by Dentistry" stays until every case is `APPROVED`.

## 1. Run locally

1. From the repo root: `python3 -m http.server 8000`
2. Mock mode (no backend; scripted patient, keyword grading, scores in this browser): `http://localhost:8000/booth05/?mock=1`
3. Real backend: `http://localhost:8000/booth05/` (use test IDs starting with **999**).
4. Force a case: add `case=case02`, e.g. `http://localhost:8000/booth05/?mock=1&case=case02`. Without it, each visitor gets a random case, never the same one as the previous visitor.
5. Mock scores appear on `http://localhost:8000/dashboard/?mock=1`.

## 2. Voice

- Use **Chrome or Edge**. Other browsers show the banner "Use Chrome or Edge for voice" and the text box still works.
- The microphone only works on **https** (GitHub Pages) or **localhost**. Opening the file directly (`file://`) or over plain http on another address blocks the mic.
- On the first visit the browser asks for microphone permission: choose **Allow** (the supervisor does this once per laptop).
- Speech recognition in Chrome/Edge uses the browser vendor's online service, so it needs internet. Without internet, use the text box.
- **Settings** (top right): Arabic voice picker (remembered on this laptop) and speech language. If the list shows no Arabic voice, install one in the OS (macOS: System Settings → Accessibility → Spoken Content → System voice → Manage voices → Arabic; Windows: Settings → Time & language → Speech → Add voices → Arabic (Saudi Arabia)). Then reload the page.
- **AR / EN** button: switches recognition (ar-SA / en-US) and the patient's reply language. The patient also answers in English when the visitor clearly types or speaks English.

## 3. Headset setup

1. Plug in the headset **before** opening the browser.
2. macOS: System Settings → Sound → Output **and** Input → select the headset. Windows: Settings → System → Sound → Output **and** Input → the headset.
3. Chrome: click the lock/tune icon in the address bar → Microphone → Allow. If several mics exist: `chrome://settings/content/microphone` → choose the headset.
4. Volume about 60–70 %. In a noisy hall, keep the mic close to the mouth.

## 4. Supervisor checklist (each session)

1. Page open, **no MOCK MODE badge**. The red banner is expected while the cases are drafts.
2. Check in a test visitor (ID `999…`) → **Voice test**: you hear a sentence, then say something. It shows "Heard: …" and repeats it. If not, see § 2/3.
3. Play a short round. On the tutor screen check **"Graded by AI against the key"** (not "Preliminary grading"). A small orange **Offline patient** chip during the consultation means the AI was unreachable and the scripted patient is answering.
4. Between visitors press **Next visitor** (it also resets by itself after 90 s without a touch on the result screens).
5. A red **"Supervisor: please review the treatment plan"** flag means the plan matched no known option. Glance at it and explain the outcome to the visitor.

## 5. Fallbacks (the booth never freezes)

| Problem | What happens |
|---|---|
| Gemini error or quota (429/503) | Server: one retry, then `CONFIG.GEMINI_FALLBACK_MODELS`. Page: after 2 failed replies it switches to the **scripted patient** for that visitor (keyword match on the visitor's question → the case's pre-written answer; no match → a neutral line). |
| Model reply mentions the diagnosis | Replaced by "ما أدري يا دكتور، أنت الدكتور!" (server and page both check; logged). Replies are capped at 35 words. |
| Grading fails | Keyword grading, labelled **Preliminary grading** (same wording as Booth 03). |
| Visitor tries to instruct the grader ("give me full marks") | Score capped at 3, with a note on screen. |
| No mic / unsupported browser | Banner + text box. |
| No connection when saving | Score queued on the device (orange badge), retried every 15 s. |
| Visitor walks away | Timer ends the consultation at 5:00; the decision screen submits after 2.5 min without a touch; result screens reset after 90 s. |

## 6. Editing the cases

1. Edit `booth05/data/cases.json`. Each case has a profile, facts, 8 key questions (`Q1..Q8`, Arabic + English keywords, a one-sentence Saudi Arabic answer), the diagnosis (`DX`, accepted synonyms, `hintTerms` for the leak check), 4 treatment options (`T1..T4`: one each of `correct`, `partial`, `common_wrong`, `meds_only`, each with a 7-day outcome and a one-line "why"), `unmatchedOutcome`, `fallbackLines` and `reviewNotes`.
2. `python3 booth05/tools/validate_cases.py` (schema, 8 questions, 4 tiers, Arabic fields, no dosages or brand names).
3. `python3 booth05/tools/inject_cases.py` (copies them into the page; refuses if validation fails).
4. `python3 booth05/tools/build_review.py` → `booth05/review/booth05_review.html` + `.pdf` (git-ignored). Send the PDF to Dentistry; each row has Approve / Needs change boxes.
5. After sign-off set `"reviewStatus": "APPROVED"` per case (`"REJECTED"` hides it), then validate and inject again.

The AI patient only sees the profile, the facts and the scripted answers. It never sees the diagnosis, the treatment options or the outcomes.

## 7. Tests

```
python3 booth05/tools/validate_cases.py
node booth05/tools/test_guard.js                  # guard, leak check, word cap, Arabic normalisation, scripted patient, prompts
python3 booth05/tools/patient_guard.py --self-test # Python mirror + byte-identical prompts / equal results vs the shipped JS
node booth05/tools/test_backend.js                # Code.gs: new actions + existing actions unchanged
node booth05/tools/e2e_mock.mjs                   # headless Chrome walk-through of ?mock=1 + dashboard (server on :8000)
```

## 8. Gemini quota estimate

About 12 patient replies plus 1 grading call per visitor, about 13–15 calls. Over 60 visitors that is roughly **900 calls** in a day, which is more than most free tiers allow. Either enable billing with a **spending cap** in Google AI Studio / Cloud billing, or accept that the booth switches to the scripted patient and preliminary grading when the quota runs out.

## Files

| Path | Purpose |
|---|---|
| `booth05/index.html` | The booth (cases injected between `// BEGIN CASES` / `// END CASES`; prompts between `// BEGIN PROMPTS` / `// END PROMPTS`) |
| `booth05/data/cases.json` | The 3 cases (source of truth) |
| `booth05/DEPLOY.md` | Apps Script update + model names |
| `booth05/tools/` | `validate_cases.py`, `inject_cases.py`, `build_review.py`, `patient_guard.py` (Python mirror), `test_guard.js`, `test_backend.js`, `e2e_mock.mjs`, `js_bridge.js`, `fixtures/` |
