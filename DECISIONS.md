# Decisions log

Small decisions made during the build that the brief left open.

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
28. Added `tools/export_review.py` (not in the brief's layout) to regenerate `review/cases_for_review.md` from `data/cases.json` after edits.
29. README uses `python3` because macOS has no `python` command by default.
30. The brief said "Don't explain terms"; the user's chat message asked for explanations as I go, and that newer instruction was followed in the chat only. The docs stay terse.
