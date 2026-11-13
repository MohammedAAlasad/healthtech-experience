# Booth 03 integration (Read the Scan)

Your booth saves points to the same Google Sheet as Booth 06 through one shared backend. The TV leaderboard adds them up automatically. You need about 5 lines of code.

## 1. Include shared.js

Put your page in its own folder at the repo root, e.g. `boothNN/index.html` (same GitHub Pages site), then add the following before your own script:

```html
<script src="../shared/shared.js"></script>
<script src="game.js"></script>  <!-- your code, inside boothNN/ -->
```

`shared.js` already contains the shared **API_URL** (the Apps Script Web App URL ending in `/exec`, which the Booth 06 owner gives you). Don't copy it into your own code. Never copy `shared.js` into a booth folder: there is exactly one copy, `shared/shared.js`.

## 2. Check-in, then save the score

```html
<div id="app"></div>
<script src="../shared/shared.js"></script>
<script>
  startCheckIn(document.getElementById("app"), ({ studentId, name }) => {
    // ...play your game here, then when it ends:
    const points = 20; // 0-30
    saveScore(studentId, "booth03", points, { attemptId: crypto.randomUUID(), rounds: [/* your details */] })
      .then(r => alert(r.queued ? "Offline, will send automatically" : r.counted ? "Added to the leaderboard" : "Practice attempt — not counted"))
      .catch(err => alert("Could not save: " + err.message));
  });
</script>
```

- `startCheckIn(container, onReady, {title?, welcomePrefix?})` draws the operator form (University ID + Name + Start), registers the player and calls `onReady({studentId, name})`. It still works offline.
- `saveScore(...)` resolves with `{counted:true|false, points}` when online. When offline it resolves with `{queued:true}` and retries every 15 s, even after a page reload. It rejects only if the input is invalid.
- `crypto.randomUUID()` needs https or localhost. On plain http use `htMakeId()` from shared.js instead. If you omit `attemptId`, saveScore creates one.

## 3. Rules

| Booth id | Name | Max points |
|---|---|---|
| `booth03` | Read the Scan | **30** |
| `booth06` | Clinical Diagnosis Challenge | **40** |

- **First attempt counts.** A student's first saved score at a booth goes to the leaderboard; later ones are stored as practice (`counted:false`).
- Points must be a number from 0 to the booth max; otherwise the server returns an error.
- Student IDs: 6–12 digits. Names: max 60 characters. The leaderboard shows only the last 4 digits of IDs.
- Resending the same `attemptId` never creates a duplicate (safe retries).

## 4. AI grading with Gemini (optional)

```js
const result = await grade(
  "You are grading a dental student's radiograph reading. Answer as JSON: {\"score\":0-10,\"feedback\":\"...\"}. Student answer: ...",
  imageBase64,   // optional: raw base64 or a data: URL
  "image/jpeg"   // required if you send an image
);
// result is the parsed JSON object from Gemini, e.g. {score: 8, feedback: "..."}
```

The backend calls Gemini with the key stored in Apps Script Script Properties; there is no key in the browser. It forces a JSON answer (`responseMimeType: application/json`), so describe the JSON shape you want in the prompt. Expect 2–10 s per call. `grade()` waits up to **45 s** before giving up (all other calls time out after 15 s), so show a "Grading…" message while it runs. On a timeout it rejects with a friendly error; it is **not** queued or retried, so offer a "Try again" button. Images: png/jpeg/webp/heic, about 5 MB max. In mock mode `grade()` returns a fixed fake answer.

Booth 05 also uses `patientTurn({caseId, lang, prompt, leakTerms})` → `{reply}` (15 s timeout, chat model `CONFIG.GEMINI_CHAT_MODEL`, leak check + 35-word cap on the server) and `patientGrade({caseId, prompt})` → parsed JSON (45 s, `CONFIG.GEMINI_MODEL`). Both retry once on 429/5xx, then try `CONFIG.GEMINI_FALLBACK_MODELS`; if everything fails they reject and the page uses its scripted patient / keyword grading. Both reject in mock mode.

## 5. Test without the real backend

Run `python3 -m http.server 8000` in the repo root and open your page with `?mock=1`, e.g. `http://localhost:8000/booth03/?mock=1`. Everything is then stored in the browser, and `http://localhost:8000/dashboard/?mock=1` in the same browser shows your scores. A yellow MOCK MODE badge reminds you. `htMockOffline(true)` in the console simulates a Wi-Fi drop.
