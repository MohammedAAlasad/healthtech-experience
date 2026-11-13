# Booth 05 — backend update (Apps Script)

The repo copy `apps-script/Code.gs` contains everything Booth 05 needs. **After every change to Code.gs: paste the whole file into the Apps Script editor and deploy a New version** (steps below). Until you do, the deployed backend runs the old code. The page then cannot get AI replies in the v2 format, so it answers from its scripted patient. It never freezes.

The other actions are unchanged (checked by `node booth05/tools/test_backend.js`).

## Booth 05 actions in Code.gs

| Action | What it does |
|---|---|
| `ping` (GET) | Already existed. The page calls it on load, on the start screen and every 4 minutes to keep Apps Script warm. |
| `patientTurn` | One patient reply. Gets the short system prompt + the last 8 turns + the new text, calls `GEMINI_CHAT_MODEL` with `temperature 0.7`, `maxOutputTokens 120` and the lowest thinking setting the model accepts, then applies the leak check and 35-word cap. |
| `patientGrade` | Grading JSON from `GEMINI_MODEL`. |
| `ttsSpeak` | Premium voice, only used with `?tts=gemini` (off by default): one sentence → WAV audio from `GEMINI_TTS_MODEL`. |

**Thinking handling:** `CHAT_THINKING_OPTIONS` (default `[{ thinkingBudget: 0 }]`) is tried first. If the model answers HTTP 400 for it, the call is repeated once without `thinkingConfig`. The setting that worked is remembered per model for 6 hours (CacheService), so later turns don't pay for the retry. For Gemini 3 models you can add `{ thinkingLevel: "minimal" }` to the list.

## Model names to set (in `CONFIG` at the top of Code.gs)

Copy the exact model ids from aistudio.google.com (model picker → "Get code" shows the id). A value starting with `REPLACE_` is skipped.

| Setting | Used by | What to put | Now |
|---|---|---|---|
| `GEMINI_CHAT_MODEL` | patient replies (`patientTurn`, ~12 calls per visitor) | **a Flash-Lite class model** (fastest, cheapest) | `REPLACE_WITH_FAST_CHAT_MODEL_FROM_AI_STUDIO` |
| `GEMINI_MODEL` | Booth 05 grading **and Booth 03 grading** | the strongest model you can use | `gemini-3.8-flash` (kept: Booth 03 already uses it) |
| `GEMINI_FALLBACK_MODELS` | both Booth 05 actions, in order, after the main model fails | 1–2 other models | `["REPLACE_WITH_FALLBACK_MODEL_1", "REPLACE_WITH_FALLBACK_MODEL_2"]` |
| `GEMINI_TTS_MODEL` | `ttsSpeak` only (premium voice, off by default) | a Gemini TTS model id | `REPLACE_WITH_TTS_MODEL_FROM_AI_STUDIO` |
| `GEMINI_TTS_VOICE` | `ttsSpeak` | a prebuilt voice name from AI Studio | `Kore` |

The first brief suggested `["gemini-4-hydrogen", "gemini-3.8-flash"]` for the fallbacks. Check that both ids exist in AI Studio before you use them.

**Choosing the chat model with the timing overlay:** open `…/booth05/?debug=1`, check in a test visitor and ask 5–6 open questions (ones the script can't answer, e.g. "كيف كانت إجازتك؟"). Read **sent→reply** on the overlay. That is Apps Script + Gemini time, and it should be under about 2 s. Try each candidate model, keep the fastest one that still answers sensibly, and put the second fastest in `GEMINI_FALLBACK_MODELS`. If **final→sent** or **reply→voice** is large, the problem is the laptop or browser, not the model.

## Steps

1. Open the Google Sheet → **Extensions → Apps Script**.
2. In `Code.gs`, select all and delete, then paste the whole `apps-script/Code.gs` from this repo.
3. Set the model settings above. **Save** (disk icon).
4. **Deploy → Manage deployments** → the pencil (Edit) on the existing deployment.
5. **Version: New version** → **Deploy**. The Web App URL stays the same; `shared/shared.js` needs no change.
6. Test from a terminal (replace the URL; no `-X POST`, so the Apps Script redirect works):
   ```
   curl -sL "<WEB_APP_URL>" --data '{"action":"patientTurn","lang":"ar","system":"You are a dental patient. Answer in one short Saudi Arabic sentence.","turns":[],"text":"السلام عليكم، وش فيك؟","leakTerms":[]}'
   ```
   Expect `{"ok":true,"reply":"…","model":"…","thinking":"…"}`. An `"error"` names the models that failed and why (`404` = wrong model id, `429` = quota).
7. Open `…/booth05/?debug=1` and play one test visitor with an ID starting `999`: check the timings (see above). The tutor screen should say **Graded by AI against the key**, and the score should appear on the dashboard under Virtual Patient.
8. Afterwards: select `clearTestData` → **Run**.

The Gemini key stays in **Project Settings → Script Properties → `GEMINI_API_KEY`**, as before. CacheService needs no setup.
