# BUILD 05 v2 — Speed, natural voice, human-looking patient

Booth 05 is built (commit 3206606) and deployed. Live feedback: replies are slow, the voice sounds robotic, and the cartoon SVG patient looks unrealistic. Improve these three things without breaking tests, other booths, or the scripted fallback. Work autonomously, commit locally, do NOT push.

Read `booth05/` first (index.html, data/cases.json, tools/, README.md, DEPLOY.md) and `apps-script/Code.gs` (patientTurn, patientGrade, model fallback chain).

---

## 1. Speed (most important)

Goal: from the end of the visitor's sentence to the patient's first spoken word in **under 3 seconds** on a normal connection.

1. **Instrument first.** Add timing marks (visible only with `?debug=1`, and logged to console) for: speech recognition final result, request sent, backend response received, TTS start. Show a small debug overlay with the four durations and the model used. Use it to prove each change below.
2. **Gemini call settings in `patientTurn`** (Code.gs):
   - `maxOutputTokens` about 120 (replies are max 35 words).
   - Lowest thinking setting the model accepts (try `thinkingConfig` with `thinkingBudget: 0` or the equivalent level for the configured model). If the API returns 400 for the field, retry once without it and remember (CacheService) to skip it for that model.
   - `temperature` about 0.7.
   - Send only the last 8 turns plus the system prompt (not the whole transcript).
   - Keep the system prompt as short as possible without losing the rules (measure token count and trim).
3. **Warm-up:** on the start screen, send a tiny `ping` action to the backend (and a 1-token Gemini call is NOT needed) so Apps Script is warm before the first visitor turn. Repeat the ping every 4 minutes while the page is open.
4. **Do not wait for anything extra** after the reply arrives: start TTS immediately. Speak long replies sentence by sentence (split on `.`, `،`, `؟`, `!`) so audio starts after the first sentence.
5. **Instant acknowledgement:** while waiting for the reply, show the patient "thinking" (a small typing/dots indicator and a subtle avatar change). Optionally play a short natural filler ("امم…") only if the wait exceeds 1.2 s, and only from a small set of pre-written fillers; never from the model.
6. **Speculative speed:** if the visitor's utterance is matched confidently by the scripted matcher (score above a threshold you choose and document), answer with the scripted answer instantly and skip Gemini for that turn. Make this a setting `FAST_SCRIPTED_FIRST` (default true) and mark those turns in the saved transcript.
7. **Model slots:** keep `GEMINI_CHAT_MODEL` separate. Add a one-line note in DEPLOY.md to prefer a Flash-Lite class model for chat and list how to read the timing overlay to choose.
8. Add a test (extend test_backend.js with the fake Apps Script) proving the 400-retry-without-thinking path and the 8-turn trimming.

---

## 2. Natural voice

The current voice is a robotic system voice. Improve without paid services:

1. **Smart default voice:** auto-select the best available voice using this order: Arabic (`ar-SA` first, then any `ar*`) voices whose name contains `Natural`, `Neural`, `Online`, `Premium`, `Enhanced`; then known good names (Hamed, Zariyah, Majed, Tarik, Laila, Maged); then any `ar*`; then default. Re-evaluate on `voiceschanged`. Show the chosen voice name and a quality badge ("Natural" / "Standard") in Settings and on the Voice test screen, plus a hint "Open this page in Microsoft Edge for free natural Arabic voices" when only Standard voices are found.
2. **Speech tuning:** rate about 1.0 for natural voices (0.92 for standard), pitch 1.0, short sentences, and add tiny pauses (split by sentence).
3. **Voice picker** keeps working and remembers the choice per device (try/catch localStorage).
4. **Optional premium voice, off by default** (`USE_GEMINI_TTS=false` already exists): finish this path properly behind the flag: backend `ttsSpeak` action returning base64 audio, client plays it with an `Audio` element, sentence-chunked, with automatic fallback to browser voices on any error. Document the extra quota cost in README. Do not enable by default.
5. **Recognition:** keep Chrome/Edge `SpeechRecognition`. Add a visible "Heard:" line with the interim transcript, and a "Tap to re-say" on the last utterance.
6. README: a short "Best voice setup" section (Edge natural voices; macOS Spoken Content → Manage Voices → Arabic Enhanced/Premium; use a headset to avoid echo).

---

## 3. Human-looking patient (without paid avatar services)

Real-time lip-synced video avatars need paid services and are out of scope. Instead build a **photo-based patient** that feels human and falls back to the existing SVG:

1. New avatar type in `cases.json`: `avatar: { "type": "photo", "dir": "images/avatar/case01", "states": ["neutral","pain","worried","relieved"] }`. Images are expected at `booth05/images/avatar/<caseId>/<state>.jpg` (4:5, at least 1000 px tall). If any file is missing, silently fall back to the SVG avatar for that case.
2. **Life without lip-sync** (avoid the uncanny valley): when speaking, show a soft animated audio-level ring or waveform under the portrait driven by `speechSynthesis` boundary events / a simple timed envelope; add subtle idle motion (slow breathing scale 1.00→1.015, random blink via brief brightness dip is NOT needed, keep it gentle); crossfade between state images (250 ms) when the state changes (pain on the opener, worried when asked about severity, relieved at the end if outcome is good).
3. A small "AI-generated patient" caption on the avatar (required: the faces are synthetic, not real people).
4. Create `booth05/images/avatar/README.md` with: the required file list per case, and **a ready-to-use image prompt** the user can paste into an image generator to create each portrait consistently (same person, 4 expressions), for example: "Photorealistic portrait of a [age]-year-old Saudi [man/woman], [clothing], neutral clinic background, soft window light, looking at camera, expression: [neutral | holding cheek in pain | worried | relieved smile]. Keep the same person, same lighting, same framing. No text, no logos." Also state: use AI-generated faces only; never photos of real people without written permission.
5. Do not generate or fetch any real person's photo yourself. Create small neutral placeholder files only if needed for tests, clearly named `placeholder_*` and git-ignored.
6. Add a mock-mode toggle `?avatar=svg` to force the SVG avatar.
7. Layout: portrait fills the left panel at 1920×1080 and 1280×800 without cropping the face; keep the pain/notes caption.

---

## 4. Tests and report

- Run all existing suites (validate_cases, test_guard JS and Python, prompt parity, scripted patient, test_backend, e2e_mock, booth03/06 regression) and extend e2e_mock for: photo avatar with and without files, `FAST_SCRIPTED_FIRST`, debug overlay timings, voice auto-selection with a fake voice list (Natural/Standard/none), sentence-chunked TTS order.
- Update README.md and DEPLOY.md (new Code.gs actions/settings: ping, thinking handling, ttsSpeak if added; remind to paste Code.gs and make a New version).
- Final report (short): files changed, what the supervisor must do (paste Code.gs + New version; generate the 12 portraits; test voice in Edge and Chrome with the headset), measured timings from the debug overlay in mock/fake backend, known limits, commit hash. Commit locally only.
