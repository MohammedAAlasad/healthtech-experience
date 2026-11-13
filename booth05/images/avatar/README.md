# Booth 05 — patient portraits

The booth shows a **photo portrait** of the patient when all four images of a case exist, and the built-in illustration otherwise. A missing file is not an error: that case silently uses the illustration. `?avatar=svg` forces the illustration.

**Use AI-generated faces only.** Never use a photo of a real person (students, staff, patients, stock photos of identifiable people) without their written permission. The page always shows the caption "AI-generated patient".

## Files (12 in total)

| Case | Patient | Files |
|---|---|---|
| case01 | Fahad, 34, man | `case01/neutral.jpg` `case01/pain.jpg` `case01/worried.jpg` `case01/relieved.jpg` |
| case02 | Reem, 23, woman | `case02/neutral.jpg` `case02/pain.jpg` `case02/worried.jpg` `case02/relieved.jpg` |
| case03 | Abdullah, 52, man | `case03/neutral.jpg` `case03/pain.jpg` `case03/worried.jpg` `case03/relieved.jpg` |

- JPEG, portrait **4:5** (e.g. 1024 × 1280), **at least 1000 px tall**, under ~400 KB each (export at quality 80–85).
- Same person, same framing, same light and background in all four images of a case: only the expression changes. The page crossfades between them.
- Head and shoulders, face in the upper half, nothing cut off at the top. The whole image is shown (never cropped).
- When the patient talks, it shows: the opener → `pain`; a severity question → `worried`; the tutor screen → `neutral`; after 7 days → `relieved` (healed), `neutral` (partly improved), `pain` (worse/complication), `worried` (unclear).

## Image prompt (paste into an image generator)

Generate the **neutral** image first, then use the generator's "same person / reference image / character consistency" option for the other three.

```
Photorealistic portrait of a [AGE]-year-old Saudi [man/woman], [CLOTHING], neutral clinic background
(soft light-grey wall), soft window light from the left, head and shoulders, centred, looking at the camera,
4:5 portrait framing, natural skin texture, expression: [EXPRESSION].
Keep the same person, same lighting, same framing in every image. No text, no logos, no watermark,
no blood, no visible wounds.
```

| Case | [AGE] / person | [CLOTHING] | [EXPRESSION] for pain |
|---|---|---|---|
| case01 | 34 / Saudi man, short black hair, neatly trimmed short beard | plain white thobe, no headwear | holding the right lower cheek with one hand, wincing in toothache pain |
| case02 | 23 / Saudi woman | dark navy hijab covering the hair, black abaya | slightly swollen left lower jaw, one hand near the jaw, uncomfortable expression |
| case03 | 52 / Saudi man, short grey beard | white thobe, white ghutra with black agal | hand on the upper left cheek, mild discomfort |

The other three expressions (same for every case):

- `neutral`: calm, neutral expression, mouth closed.
- `worried`: worried expression, eyebrows slightly raised and drawn together.
- `relieved`: relieved, gentle smile, relaxed face.

Example (case01, worried): *Photorealistic portrait of a 34-year-old Saudi man, short black hair, neatly trimmed short beard, plain white thobe, no headwear, neutral clinic background (soft light-grey wall), soft window light from the left, head and shoulders, centred, looking at the camera, 4:5 portrait framing, natural skin texture, expression: worried expression, eyebrows slightly raised and drawn together. Keep the same person, same lighting, same framing in every image. No text, no logos, no watermark, no blood, no visible wounds.*

## Check

1. Put the files in place, then open `…/booth05/?mock=1&case=case01` (and case02, case03).
2. The left panel shows the portrait with "AI-generated patient". If you still see the illustration, one of the four files is missing or misnamed (names are lower case, `.jpg`).
3. Show the 12 images to the Dentistry team together with the case review pack.
