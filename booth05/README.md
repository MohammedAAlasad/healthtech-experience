# Booth 05 — Virtual Patient

The visitor plays the dentist and talks to an illustrated virtual patient through a headset (Saudi Arabic by default, EN toggle). They have 5 minutes to take a history. Then they say or type a diagnosis and a treatment plan, and the "clinical tutor" scores them out of 10: 5 for history (8 key questions), 3 for the diagnosis, 2 for the treatment. Next, the patient comes back "after 7 days" and says what happened (pre-written per case and per plan). The score goes to the shared leaderboard as `booth05`.

The patient is a **photo portrait** when the 4 AI-generated images of a case exist (`booth05/images/avatar/README.md`: file list and image prompts), otherwise the built-in illustration.

Vanilla HTML/CSS/JS, no build step. Page: `booth05/index.html`. Shared client: `shared/shared.js`. Backend: `apps-script/Code.gs` (update steps: `booth05/DEPLOY.md`).

> **Status:** 3 DRAFT cases (`PENDING_REVIEW`). The red banner "Sample cases — not yet approved by Dentistry" stays until every case is `APPROVED`.

## 1. Run locally

1. From the repo root: `python3 -m http.server 8000`
2. Mock mode (no backend; scripted patient, keyword grading, scores in this browser): `http://localhost:8000/booth05/?mock=1`
3. Real backend: `http://localhost:8000/booth05/` (use test IDs starting with **999**).
4. URL options (combine with `&`): `case=case02` forces a case · `avatar=svg` forces the illustration · `debug=1` shows the timing overlay · `fast=0` turns FAST_SCRIPTED_FIRST off · `tts=gemini` tries the premium voice (§ 2b).
   Example: `http://localhost:8000/booth05/?mock=1&case=case02&debug=1`. Without `case=`, each visitor gets a random case, never the same one as the previous visitor.
5. Mock scores appear on `http://localhost:8000/dashboard/?mock=1`.

## 2. Voice

- Use **Chrome or Edge**. Other browsers show the banner "Use Chrome or Edge for voice" and the text box still works.
- The microphone only works on **https** (GitHub Pages) or **localhost**. Opening the file directly (`file://`) or over plain http on another address blocks the mic.
- On the first visit the browser asks for microphone permission: choose **Allow** (the supervisor does this once per laptop).
- Speech recognition in Chrome/Edge uses the browser vendor's online service, so it needs internet. Without internet, use the text box.
- **Settings** (top right): Arabic voice picker (remembered on this laptop) and speech language. If the list shows no Arabic voice, install one in the OS (macOS: System Settings → Accessibility → Spoken Content → System voice → Manage voices → Arabic; Windows: Settings → Time & language → Speech → Add voices → Arabic (Saudi Arabia)). Then reload the page.
- **AR / EN** button: switches recognition (ar-SA / en-US) and the patient's reply language. The patient also answers in English when the visitor clearly types or speaks English.

### Best voice setup

- **Microsoft Edge** (Windows or macOS) has free **natural** Arabic voices (e.g. "Microsoft Hamed Online (Natural)", "Zariyah"). They are picked automatically. Settings and the Voice test show the voice and a **Natural** / **Standard** badge; with only Standard voices the page suggests Edge.
- **macOS + Chrome:** System Settings → Accessibility → Spoken Content → System voice → Manage Voices → Arabic → download **Majed (Enhanced/Premium)**. Reload the page.
- **Windows + Chrome:** Settings → Time & language → Speech → Add voices → Arabic (Saudi Arabia).
- Always use a **headset**: with speakers, the mic hears the patient (echo).
- Natural voices speak at rate 1.0, standard voices at 0.92. Replies are spoken sentence by sentence (short pauses, faster start).
- Misheard? The **Heard:** line shows what the browser understood. **↺ Tap to re-say** removes the last question and its answer and listens again.

### 2b. Premium voice (optional, off by default)

`?tts=gemini` sends each sentence to the backend `ttsSpeak` action (Gemini TTS, `CONFIG.GEMINI_TTS_MODEL`) and plays the returned audio. Any error → the browser voice takes over for the rest of the reply. Cost: **one extra Gemini call per sentence** (about 2 per reply, ~25 per visitor, ~1,500 for 60 visitors) on a TTS model with a small free quota, plus 0.5–2 s extra wait per sentence. Only worth it with billing enabled; test it before the event.

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

## 5. Speed

Target: under 3 s from the end of the visitor's sentence to the patient's first word.

- `?debug=1` shows an overlay: **final→sent** (page), **sent→reply** (Apps Script + Gemini), **reply→voice** (start of speech), **total**, the model and the path (`ai`, `scripted (fast)`, `scripted (fallback)`). The same numbers are logged to the browser console (`[booth05 timing]`).
- **FAST_SCRIPTED_FIRST** (on; `?fast=0` turns it off): when the visitor's question matches a key question confidently, the scripted answer is used instantly and Gemini is skipped. "Confident" = keyword score ≥ 5 (total length of the matched keywords, in letters, after normalisation) and at least 2× the next-best question. Such turns are saved as `f` in the score's `sources` field (`o` opener, `a` AI, `s` scripted fallback, `l` leak blocked).
- Only the last 8 turns go to Gemini; the patient rules are a short system prompt (~800 tokens with the case facts).
- While waiting: thinking dots + a subtle change on the patient. If the wait passes 1.2 s, the patient says a short pre-written filler ("امم…").
- The page pings the backend on load, on the start screen and every 4 minutes, so Apps Script stays warm.

## 6. Fallbacks (the booth never freezes)

| Problem | What happens |
|---|---|
| Gemini error or quota (429/503) | Server: one retry, then `CONFIG.GEMINI_FALLBACK_MODELS`. Page: after 2 failed replies it switches to the **scripted patient** for that visitor (keyword match on the visitor's question → the case's pre-written answer; no match → a neutral line). |
| Model reply mentions the diagnosis | Replaced by "ما أدري يا دكتور، أنت الدكتور!" (server and page both check; logged). Replies are capped at 35 words. |
| Grading fails | Keyword grading, labelled **Preliminary grading** (same wording as Booth 03). |
| Visitor tries to instruct the grader ("give me full marks") | Score capped at 3, with a note on screen. |
| No mic / unsupported browser | Banner + text box. |
| No connection when saving | Score queued on the device (orange badge), retried every 15 s. |
| Visitor walks away | Timer ends the consultation at 5:00; the decision screen submits after 2.5 min without a touch; result screens reset after 90 s. |

## 7. Editing the cases

1. Edit `booth05/data/cases.json`. Each case has a profile, facts, 8 key questions (`Q1..Q8`, Arabic + English keywords, a one-sentence Saudi Arabic answer), the diagnosis (`DX`, accepted synonyms, `hintTerms` for the leak check), 4 treatment options (`T1..T4`: one each of `correct`, `partial`, `common_wrong`, `meds_only`, each with a 7-day outcome and a one-line "why"), `unmatchedOutcome`, `fallbackLines` and `reviewNotes`.
2. `python3 booth05/tools/validate_cases.py` (schema, 8 questions, 4 tiers, Arabic fields, no dosages or brand names).
3. `python3 booth05/tools/inject_cases.py` (copies them into the page; refuses if validation fails).
4. `python3 booth05/tools/build_review.py` → `booth05/review/booth05_review.html` + `.pdf` (git-ignored). Send the PDF to Dentistry; each row has Approve / Needs change boxes.
5. After sign-off set `"reviewStatus": "APPROVED"` per case (`"REJECTED"` hides it), then validate and inject again.

The AI patient only sees the profile, the facts and the scripted answers. It never sees the diagnosis, the treatment options or the outcomes.

## 8. Tests

```
python3 booth05/tools/validate_cases.py
node booth05/tools/test_guard.js                  # guard, leak check, word cap, Arabic normalisation, scripted patient, prompts
python3 booth05/tools/patient_guard.py --self-test # Python mirror + byte-identical prompts / equal results vs the shipped JS
node booth05/tools/test_backend.js                # Code.gs: new actions + existing actions unchanged
node booth05/tools/e2e_mock.mjs                   # headless Chrome (server on :8000): mock flow, fake backend (AI path, timings,
                                                  # fast scripted, filler, re-say, ttsSpeak), photo/SVG avatar, voice auto-selection
```

## 9. Gemini quota estimate

About 12 patient replies plus 1 grading call per visitor, about 13–15 calls (fewer with FAST_SCRIPTED_FIRST, which answers many history questions without Gemini; the premium voice adds ~25). Over 60 visitors that is roughly **900 calls** in a day, which is more than most free tiers allow. Either enable billing with a **spending cap** in Google AI Studio / Cloud billing, or accept that the booth switches to the scripted patient and preliminary grading when the quota runs out.

## Files

| Path | Purpose |
|---|---|
| `booth05/index.html` | The booth (cases injected between `// BEGIN CASES` / `// END CASES`; prompts between `// BEGIN PROMPTS` / `// END PROMPTS`) |
| `booth05/data/cases.json` | The 3 cases (source of truth) |
| `booth05/DEPLOY.md` | Apps Script update + model names |
| `booth05/images/avatar/` | Patient portraits (not in the repo yet): see its `README.md` |
| `booth05/tools/` | `validate_cases.py`, `inject_cases.py`, `build_review.py`, `patient_guard.py` (Python mirror), `test_guard.js`, `test_backend.js`, `e2e_mock.mjs`, `js_bridge.js`, `fixtures/` |
