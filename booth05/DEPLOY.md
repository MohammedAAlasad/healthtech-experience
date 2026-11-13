# Booth 05 — backend update (Apps Script)

The repo copy `apps-script/Code.gs` already contains the Booth 05 additions (`patientTurn`, `patientGrade`, the model chain, `booth05` max 10 points, the dashboard fields). The other actions are unchanged (checked by `node booth05/tools/test_backend.js`).

## Model names to set (in `CONFIG` at the top of Code.gs)

Copy the exact model ids from aistudio.google.com (model picker → "Get code" shows the id). A value starting with `REPLACE_` is skipped.

| Setting | Used by | What to put | Now |
|---|---|---|---|
| `GEMINI_CHAT_MODEL` | Booth 05 patient replies (`patientTurn`, ~12 calls per visitor) | the fast, cheap model | `REPLACE_WITH_FAST_CHAT_MODEL_FROM_AI_STUDIO` |
| `GEMINI_MODEL` | Booth 05 grading (`patientGrade`) **and Booth 03 grading (`grade`)** | the strongest model you can use | `gemini-3.8-flash` (kept: Booth 03 already uses it) |
| `GEMINI_FALLBACK_MODELS` | both Booth 05 actions, in order, after the main model fails | 1–2 other models | `["REPLACE_WITH_FALLBACK_MODEL_1", "REPLACE_WITH_FALLBACK_MODEL_2"]` |

The brief suggested `["gemini-4-hydrogen", "gemini-3.8-flash"]` for the fallbacks. Check that both ids exist in AI Studio before you use them.
If `GEMINI_CHAT_MODEL` stays a placeholder, the patient replies use the fallback models; if those are placeholders too, the booth runs on its scripted patient (it never freezes).

## Steps

1. Open the Google Sheet → **Extensions → Apps Script**.
2. In `Code.gs`, select all and delete, then paste the whole `apps-script/Code.gs` from this repo.
3. Set the three model settings above. **Save** (disk icon).
4. **Deploy → Manage deployments** → the pencil (Edit) on the existing deployment.
5. **Version: New version** → **Deploy**. The Web App URL stays the same; `shared/shared.js` needs no change.
6. Test from a terminal (replace the URL; no `-X POST`, so the Apps Script redirect works):
   ```
   curl -sL "<WEB_APP_URL>" --data '{"action":"patientTurn","lang":"ar","prompt":"You are a dental patient. Say hello to the dentist in one short Saudi Arabic sentence.","leakTerms":[]}'
   ```
   Expect `{"ok":true,"reply":"…","leaked":false,"model":"…"}`. An `"error"` names the models that failed and why (e.g. `404` = wrong model id, `429` = quota).
7. Play one test visitor at `…/booth05/` with an ID starting `999`. The tutor screen should say **Graded by AI against the key** (not "Preliminary grading"), and the score should appear on the dashboard under Virtual Patient.
8. Afterwards: select `clearTestData` → **Run**.

The Gemini key stays in **Project Settings → Script Properties → `GEMINI_API_KEY`**, as before. Nothing else needs to be added.
