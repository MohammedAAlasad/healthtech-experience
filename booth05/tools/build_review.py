#!/usr/bin/env python3
"""Build the Dentistry review pack for Booth 05 (stdlib only).

Usage: python3 booth05/tools/build_review.py [--no-pdf]
Writes booth05/review/booth05_review.html (one self-contained file) and, if Google Chrome / Chromium / Edge is
installed, booth05/review/booth05_review.pdf (headless print). Both files are git-ignored.
"""
import html
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "data" / "cases.json"
OUT_DIR = ROOT / "review"
OUT_HTML = OUT_DIR / "booth05_review.html"
OUT_PDF = OUT_DIR / "booth05_review.pdf"

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "msedge",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
TIER = {"correct": "Correct", "partial": "Partial", "common_wrong": "Common mistake", "meds_only": "Medicines only"}
OUTCOME = {"healed": "Healed", "improved": "Partly improved", "complication": "Complication", "worse": "Got worse", "unclear": "Unclear"}
FACT_LABELS = {"chiefComplaint": "Chief complaint", "onset": "Onset", "duration": "Duration", "painCharacter": "Pain character",
               "severity": "Severity (0-10)", "aggravatingFactors": "Aggravating", "relievingFactors": "Relieving",
               "medicalHistory": "Medical history", "medications": "Medications", "allergies": "Allergies", "habits": "Habits",
               "dentalHistory": "Dental history", "systemicSigns": "Systemic signs"}

CSS = """
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:11pt;color:#111;margin:24px}
h1{font-size:20pt;margin:0 0 4px} h2{font-size:15pt;margin:28px 0 6px;border-bottom:3px solid #0a7e8c;padding-bottom:4px}
h3{font-size:12pt;margin:16px 0 6px;color:#0a7e8c}
.meta{color:#555;margin:0 0 12px}
.draft{background:#c4001d;color:#fff;font-weight:800;padding:8px 12px;border-radius:6px;display:inline-block}
table{border-collapse:collapse;width:100%;margin:4px 0 8px;table-layout:fixed}
th,td{border:1px solid #bbb;padding:5px 7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}
th{background:#eef5f6;font-size:9.5pt}
td.ar{direction:rtl;text-align:right;font-size:11.5pt}
td.chk{width:112px;white-space:nowrap;font-size:9.5pt}
.box{display:inline-block;width:12px;height:12px;border:1.5px solid #333;margin-right:5px;vertical-align:-2px}
.notes li{margin:3px 0}
.case{page-break-before:always}
.small{font-size:9.5pt;color:#444}
@media print{body{margin:0}}
"""


def label(k):
    if k in FACT_LABELS:
        return FACT_LABELS[k]
    words = "".join(" " + ch.lower() if ch.isupper() else ch for ch in k).strip()
    return words[:1].upper() + words[1:]


def esc(s):
    return html.escape("" if s is None else str(s))


def chk():
    return '<td class="chk"><span class="box"></span>Approve<br><span class="box"></span>Needs change</td>'


def case_html(c):
    p = c["profile"]
    out = [f'<section class="case"><h2>{esc(c["id"])} — {esc(c["title"])}</h2>',
           f'<p class="meta">Status: <b>{esc(c["reviewStatus"])}</b></p>',
           "<h3>Patient profile</h3><table><tr><th style=width:22%>Field</th><th>Value</th>" + "<th style=width:112px>Review</th></tr>",
           f"<tr><td>Name / age / sex</td><td>{esc(p['name'])} ({esc(p['nameAr'])}), {esc(p['age'])}, {esc(p['sex'])}</td>{chk()}</tr>",
           f"<tr><td>Personality</td><td>{esc(p['personality'])}</td>{chk()}</tr>",
           f"<tr><td>Opening line</td><td class=ar>{esc(p['opener'])}</td>{chk()}</tr></table>",
           "<h3>Case facts (what the patient knows; shared only when asked)</h3><table><tr><th style=width:22%>Fact</th><th>Value</th><th style=width:112px>Review</th></tr>"]
    for k, v in c["facts"].items():
        out.append(f"<tr><td>{esc(label(k))}</td><td>{esc(v)}</td>{chk()}</tr>")
    out.append("</table><h3>8 key history questions (5 points) and the patient's scripted answer</h3>"
               "<table><tr><th style=width:6%>Id</th><th style=width:30%>Question the student should ask</th><th>Expected answer (Saudi Arabic)</th><th style=width:112px>Review</th></tr>")
    for q in c["keyQuestions"]:
        out.append(f"<tr><td>{esc(q['id'])}</td><td>{esc(q['label'])}</td><td class=ar>{esc(q['answer'])}</td>{chk()}</tr>")
    d = c["diagnosis"]
    out.append("</table><h3>Diagnosis (3 points)</h3><table><tr><th style=width:22%>Accepted diagnosis</th><th>Accepted synonyms</th><th style=width:112px>Review</th></tr>"
               f"<tr><td><b>{esc(d['label'])}</b></td><td>{esc(' · '.join(d['accept']))}</td>{chk()}</tr></table>")
    out.append("<h3>Treatment options (2 points: correct = 2, partial = 1, others = 0) and the 7-day outcome</h3>"
               "<table><tr><th style=width:5%>Id</th><th style=width:25%>Plan</th><th style=width:11%>Tier / outcome</th><th>Patient after 7 days (Saudi Arabic)</th><th style=width:20%>Why (shown to the student)</th><th style=width:112px>Review</th></tr>")
    for o in c["treatmentOptions"]:
        out.append(f"<tr><td>{esc(o['id'])}</td><td>{esc(o['label'])}</td><td>{esc(TIER[o['tier']])}<br><span class=small>{esc(OUTCOME[o['outcomeTier']])}</span></td>"
                   f"<td class=ar>{esc(o['outcome'])}</td><td>{esc(o['why'])}</td>{chk()}</tr>")
    um = c["unmatchedOutcome"]
    out.append(f"<tr><td>—</td><td>Plan not recognised (supervisor reviews)</td><td>{esc(OUTCOME['unclear'])}</td><td class=ar>{esc(um['outcome'])}</td><td>{esc(um['why'])}</td>{chk()}</tr></table>")
    out.append("<h3>Points to double-check (reviewNotes)</h3><table><tr><th>Note</th><th style=width:112px>Review</th></tr>")
    for n in c["reviewNotes"]:
        out.append(f"<tr><td>{esc(n)}</td>{chk()}</tr>")
    out.append("</table><p class=small>Comments:</p><div style='border:1px solid #bbb;height:90px'></div></section>")
    return "\n".join(out)


def build_html(data):
    cases = data["cases"]
    body = [f"<h1>Booth 05 — Virtual Patient: case review</h1><p class=meta>Generated {date.today().isoformat()} from booth05/data/cases.json · {len(cases)} cases</p>",
            '<p><span class="draft">DRAFT — not yet approved by Dentistry</span></p>',
            "<p>Please tick <b>Approve</b> or <b>Needs change</b> on every row and add comments. The patient is played by an AI that only sees the "
            "profile and facts; it never sees the diagnosis or the treatment options. The 7-day outcomes are pre-written (never generated). "
            "Score: 5 history + 3 diagnosis + 2 treatment = 10. No dosages or brand names are used anywhere.</p>"]
    body += [case_html(c) for c in cases]
    return f"<!DOCTYPE html><html lang=en><head><meta charset=utf-8><title>Booth 05 review</title><style>{CSS}</style></head><body>{''.join(body)}</body></html>"


def find_chrome():
    for c in CHROME_CANDIDATES:
        p = shutil.which(c) or (c if Path(c).is_file() else None)
        if p:
            return p
    return None


def main(argv):
    data = json.loads(CASES.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(exist_ok=True)
    OUT_HTML.write_text(build_html(data), encoding="utf-8")
    print(f"Wrote {OUT_HTML.relative_to(ROOT.parent)}")
    if "--no-pdf" in argv:
        return 0
    chrome = find_chrome()
    if not chrome:
        print("No Chrome/Edge found: open the HTML file and print it to PDF.")
        return 0
    profile = OUT_DIR / ".chrome-profile"
    try:
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={profile}",
                        "--no-pdf-header-footer", f"--print-to-pdf={OUT_PDF}", OUT_HTML.resolve().as_uri()],
                       check=True, capture_output=True, timeout=120)
    except (subprocess.SubprocessError, OSError) as e:
        print(f"PDF not created ({e}). Open the HTML file and print it to PDF.")
        return 0
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    print(f"Wrote {OUT_PDF.relative_to(ROOT.parent)} ({OUT_PDF.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
