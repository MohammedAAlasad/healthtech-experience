# Decisions log

Small decisions made during the builds that the briefs left open.

# Booth 06 + shared system

## Scoring / game
1. **Every case has exactly 3 accepted differentials.** The brief allows 2–3, but with 2 the differential step caps at 8, so a perfect run could never reach 40. The validator still accepts 2–3.
2. **Investigation points are rounded to whole numbers** after flooring at 0 (3 essentials = 3.33 each, so 2 of 3 gives 7). All saved scores are integers.
3. **Final diagnosis not among the selected differentials scores 0**, enforced in the scoring function as well as the UI (`finalFromSelectedOnly`).
4. **Speed bonus uses the exact seconds left at submit**, floored to whole minutes, max 3. No bonus on timeout or with a wrong final.
5. **Timeout auto-submits the current state.** On the final step a highlighted (not yet submitted) final diagnosis counts.
6. **Differentials and investigations are shuffled each round** so the first options aren't always the answers.
7. **No back navigation** between steps (keeps scoring simple and the 4 minutes meaningful).
8. Timer starts on "Start Diagnosis" (reading the case is untimed); the bar is always visible and turns amber at 1:30 and red at 0:30.
9. Leaving the page during a running round asks for confirmation (`beforeunload`).
10. `runScoringTests()` includes 4 extra cases beyond the 5 required ones (final not in selection, partial speed bonus, wrong final without bonus, mixed differentials).
11. The case history is stored as an array of 2–3 strings.

## Shared system
12. **Score response for duplicates** includes `duplicate:true` in addition to `{counted, points}`. That makes safe retries observable in the smoke test.
13. **`grade` returns `{ok:true, result:<parsed JSON>}`** on the wire, so a model answer that itself contains an `error` field can't be mistaken for a server error. `grade()` in shared.js unwraps it and resolves with the parsed JSON only.
14. **Booths 01, 02, 04 and 05 have a 100-point cap** (only booth03/booth06 caps were specified). The leaderboard total sums all booths; the per-booth breakdown shows only booth03 and booth06.
15. **Check-in waits at most 3 s for `register`** before continuing, so a slow or offline network never blocks the player. Register keeps running in the background, and `saveScore` sends the name anyway.
16. **The ID field strips non-digits as you type**, which is easier for operators. Validation still shows an error if the length is not 6–12.
17. **Name auto-fill** only overwrites the name field if it is empty or was auto-filled before (never what the operator typed).
18. **Queued scores the server rejects as invalid are dropped** (logged to console) instead of retrying forever. Invalid scores are also blocked before queueing by the same validation as the server.
19. Welcome text: shared.js shows "Welcome <prefix><name>"; Booth 06 passes `welcomePrefix: "Dr. "`.
20. Mock mode seeds 8 demo players (IDs `999000101`…) so the dashboard isn't empty, and adds the console helpers `htMockOffline()` and `htMockReset()` to test the offline queue.
21. `htMakeId()` is used for `attemptId` because `crypto.randomUUID` only exists on https/localhost.
22. Student IDs are written into text-formatted cells so leading zeros and long numbers survive.
23. `Participants` names are stored with the `'` prefix only when they start with `= + - @`. Sheets hides the apostrophe, so lookups return the original name.
24. Gemini is called with the key in the `x-goog-api-key` header (not the URL, so it never appears in logs). A `models/` prefix in `CONFIG.GEMINI_MODEL` is stripped automatically.
24b. **`grade()` has a 45 s timeout** (`HT_GRADE_TIMEOUT_MS`); every other call keeps 15 s (`HT_TIMEOUT_MS`). The timeout error message shows the actual limit. Grading is never queued offline.
25. `setup()` was added (manual-run) to create the tabs and trigger the authorization prompt before the first deployment.

## Dashboard
26. A row flashes for 3 s when it is new to the top 10 **or** its total changed. No flashing on the first load.
27. Polling uses `setTimeout` after each response (not `setInterval`), so slow responses never pile up.

## Tooling / docs
28. Added `booth06/tools/export_review.py` (not in the brief's layout) to regenerate `booth06/review/cases_for_review.md` from `booth06/data/cases.json` after edits.
29. README uses `python3` because macOS has no `python` command by default.
30. The brief said "Don't explain terms"; the user's chat message asked for explanations as I go, and that newer instruction was followed in the chat only. The docs stay terse.

# Booth 03 (Read the Scan)

1. **shared.js** copied unchanged from booth_06. It already had `HT_GRADE_TIMEOUT_MS = 45000`, so no edit was needed (the brief's "raise 15 s → 45 s" was already done upstream). `API_URL` kept as is.
2. **Mock-mode `grade()`** returns `{mock:true, score:7}` without `matched`. The guard treats any `mock:true` answer as unusable, so mock mode always uses local keyword grading with the "Preliminary grading" label. This makes the whole flow testable offline with real, deterministic scores.
3. **Only 2 placeholder cases but 3 rounds.** With fewer cases than rounds, `pickCases` repeats cases but never the same case twice in a row (e.g. 02, 01, 02). With ≥ 3 cases there are no repeats. The first case avoids the previous visitor's first case (stored in `localStorage.scan_lastFirstCaseId`).
4. **Guard details.**
   - `matched`/`missed` items are accepted if they equal a key finding **or the diagnosis** text, after trimming and ignoring case. The diagnosis counts through `matched` (the prompt has no separate diagnosis field).
   - Recomputed score = sum of accepted matched points − 1 per `wrong` entry (max 3 counted), clamped 0–10. Model score kept if within 1.5 of it, else replaced (console warning).
   - `missed` shown to the visitor = every key item not accepted as matched (so it is always complete and only contains key items).
   - Extra rule: if the answer looks like a prompt injection (English/Arabic patterns, e.g. "ignore the rules", "give 10 points", "تجاهل"), the score is capped at the local keyword score. False positives only cost the visitor the AI's synonym leniency.
   - The model's feedback is replaced by a neutral local line when the guard overrides the score.
   - The student's text is cut to 2000 chars and any `<student_answer>`/`</student_answer>` tag inside it is replaced by `[removed tag]`, so it cannot leave the data block.
5. **Empty answer** (including timeout with nothing typed) scores 0 without calling `grade()` and without the analysing animation; labelled "Preliminary grading (empty answer)".
6. **Keyword matching** (offline fallback + green highlights): case-insensitive, Arabic normalised (hamza forms of alef → ا, ة → ه, ى → ي, tashkeel/tatweel removed). Latin keywords must start at a word boundary ("xfinding a" doesn't match "finding a"); Arabic keywords are plain substrings so prefixes like و/ال/ب still match. Highlights use the keywords of the items that were matched; when the AI matched via a synonym with no keyword hit, the item is still listed under "Found".
7. **Score details** sent with `saveScore`: `{perCase:[{caseId,score,aiScore,mode}], attemptId}` — `mode` ("ai" / "local" / "empty") was added so preliminary grades can be audited in the Scores tab.
8. **Save messages:** `counted:false` → "Practice attempt — not counted"; queued (offline) → "stored on this device and will be sent automatically" (more honest than "added"); otherwise → "Your points were added to the leaderboard".
9. **"You beat the AI!"** when student > aiScore, **"Tie with the AI"** when equal, otherwise a muted "The AI wins this one".
10. **Red banner** shows if any served case is not APPROVED or is a placeholder. `REJECTED` cases are never served. A placeholder can never be APPROVED (validator error).
11. **Single source for the grading prompt:** `GRADING_PROMPT` is a one-line JSON string in `booth03/index.html` between `// BEGIN PROMPT` / `// END PROMPT`; `prepare_ai_readings.py` reads it from there, so the app and the tool can't drift. The Python guard is a port of the JS guard, with its own `--self-test`.
12. **prepare_ai_readings.py merge rules:** merge by id; existing `reviewStatus`, `expertExplanation`, `question` and any extra manual fields are kept; `key` always comes from `keys.json` (warning if an APPROVED case's key changed). AI reading is redone only if the image changed (`imageSha256`), it's missing, or `--refresh-ai`; aiScore is redone when the reading or key (`keyHash`) changed. Without a URL it still rebuilds from placeholders/existing readings. Cases present in cases.json but not in keys.json are kept. If the grading call fails, aiScore falls back to keyword grading (`aiScoreMode:"local"`).
13. **AI reading text** graded for aiScore = `"Findings: a; b. Impression: x."`.
14. **Placeholder images** are `.svg` (`images/case01.svg`, `case02.svg`); `.svg` is always treated as placeholder and never sent to the API.
15. **Review file** generated by a separate `tools/export_review.py` (also called by prepare). Shows offline keywords too so reviewers can check them.
16. **Result screen layout:** the Next button sits in the top score bar so it is visible on 1080p without scrolling. Ctrl/Cmd+Enter also submits.
17. **Zoom overlay** shows the remaining time and a Close button; the timer keeps running while zoomed.
18. *(Superseded by the repo reorganization below: all booths now share one origin when served from the repo root.)* Originally: test from the parent folder so booth_03 and booth_06 pages share one origin and the mock leaderboard.

# Repo reorganization (one event repo)

1. **One repo, one folder per booth, GitHub Pages from the repo root.** `docs/dx.html` → `booth06/index.html`, `docs/dashboard.html` → `dashboard/index.html`, booth 03 copied in from `../booth_03` (the source folder was only read, never changed).
2. **One `shared/shared.js`.** The booth_03 and booth_06 copies were byte-identical (checked with `diff` before the move); every page loads `../shared/shared.js`. Behaviour and `API_URL` unchanged.
3. **`docs/booth03_test.html` removed.** It was a stand-in until the real Booth 03 existed; the real `booth03/` now covers that test.
4. **Booth tools resolve paths from their own folder** (`booth06/tools/*` → `booth06/`, `booth03/tools/*` → `booth03/`), so they work from any working directory. Booth 03's page and its `images/` now sit together in `booth03/`, so the relative image paths in `cases.json` (`images/case01.svg`) did not change.
5. **Shared backend tools stay at `tools/`** (`smoke_test.py`, `seed_fake_data.py`).
6. **Booth 03's README moved to `booth03/README.md`** (paths updated) because it holds booth-specific procedures (replacing placeholders, grader test).
7. **Briefs are kept verbatim as history** (`briefs/BUILD.md`, `briefs/BUILD_03.md`); their old paths are not rewritten. `briefs/INTEGRATION.md` is a live how-to, so its paths were updated to `../shared/shared.js`.
8. **Booth 03's on-screen hint** "Run tools/inject_cases.py…" was left unchanged (UI text). It is still correct relative to `booth03/`.
9. **Landing page** `index.html` forwards `?mock=1` to its links.
10. **`.nojekyll`** added so GitHub Pages serves files as they are.
11. **Whole repo is now public on Pages** (not only `docs/`). No secrets are in the repo; briefs, keys and review files become reachable by URL.
