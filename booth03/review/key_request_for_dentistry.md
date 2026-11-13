# Request to the Dentistry Team — Answer keys for Booth 03 "AI vs Human: Read the Scan"

At the HealthTech Experience, visitors read a dental radiograph for 90 seconds and type what they see and their diagnosis (English or Arabic). An AI model grades their free text against **your answer key**, and we also show an AI's own reading of the same image. Nothing is shown as final until you approve it.

## What we need for each image

1. **Image file name**, exactly as you send it (e.g. `case03.jpg`). PNG, JPEG or WebP, under 4 MB, with **no patient data** (no name, ID, date or hospital text burned in), and confirmation that we may use it at the booth (and say whether it may be posted publicly online).
2. **2 to 6 key findings**, each with **points**. One short sentence per finding (what a good reader should notice).
3. For each finding: **synonyms / keywords** a student might write, in English and Arabic (used for offline grading when the internet is down).
4. **The diagnosis**, its **points**, and the **accepted equivalents** (other names or wordings that should also get full credit), in English and Arabic.
5. **A two-line expert explanation** shown to the visitor after they answer.

**Rule: the finding points + the diagnosis points must add up to exactly 10 per image.**

Please keep findings distinct from each other (no two findings that mean the same thing), because the grader awards points per finding.

## Example (clearly FAKE — do not use)

| Field | Value |
|---|---|
| Image file | `case99_FAKE.jpg` |
| Finding 1 (3 pts) | "Fake finding: purple triangle in the upper left" — keywords: purple triangle, مثلث بنفسجي |
| Finding 2 (3 pts) | "Fake finding: dotted line across the middle" — keywords: dotted line, خط منقط |
| Diagnosis (4 pts) | "Fake diagnosis: Example syndrome" — accepted equivalents: example disease, متلازمة المثال |
| Total | 3 + 3 + 4 = **10** |
| Explanation | "Line 1: this is a made-up example.\nLine 2: it only shows the format we need." |

## How the review works

1. You send us the images and keys (a reply to this message, a Word file or a spreadsheet is fine).
2. We generate `booth03_review.html`: one printable file with each image, your key with points, the AI's reading and its score.
3. You tick **Approve / Edit / Reject** per case and add comments.
4. Only approved cases lose the red "not yet approved" banner at the booth. Rejected cases are never shown.

Thank you!
