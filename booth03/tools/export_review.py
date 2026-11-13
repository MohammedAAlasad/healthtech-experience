#!/usr/bin/env python3
"""Write review/booth03_review.html: ONE self-contained, printable file for the dentistry team.

Usage: python3 booth03/tools/export_review.py [booth03/data/cases.json]
(prepare_ai_readings.py calls export() automatically.) Images are embedded as base64.
"""
import base64
import html
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT  # booth03/: images/ lives here
OUT = ROOT / "review" / "booth03_review.html"
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".svg": "image/svg+xml", ".heic": "image/heic", ".heif": "image/heif"}

CSS = """
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:24px;font-size:14px;line-height:1.45}
header{border:3px solid #c4001d;padding:12px 16px;margin-bottom:20px}
header h1{margin:0 0 4px;font-size:22px}
.stamp{display:inline-block;background:#c4001d;color:#fff;font-weight:800;padding:2px 10px;margin-right:6px}
.case{page-break-inside:avoid;break-inside:avoid;border:1px solid #999;padding:14px;margin-bottom:22px}
.case h2{margin:0 0 8px;font-size:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
img{max-width:100%;max-height:420px;background:#000;display:block;margin:0 auto}
table{border-collapse:collapse;width:100%;margin:6px 0}
td,th{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}
td.n{text-align:right;white-space:nowrap;width:4em}
.ph{background:#fff1c2;border:2px dashed #b88600;padding:6px 10px;font-weight:700;margin-bottom:8px}
.kw{color:#555;font-size:12px}
.decision{margin-top:12px;border-top:2px solid #111;padding-top:8px;font-size:15px}
.box{display:inline-block;width:14px;height:14px;border:2px solid #111;vertical-align:middle;margin:0 4px 0 14px}
.line{border-bottom:1px solid #111;height:26px}
.status{font-weight:800}
@media print{body{margin:10mm}.case{border-color:#666}}
"""


def esc(s):
    return html.escape(str(s), quote=True)


def img_tag(case):
    p = DOCS / case["image"]
    if not p.is_file():
        return f"<p><b>Image missing:</b> booth03/{esc(case['image'])}</p>"
    mime = MIME.get(p.suffix.lower(), "application/octet-stream")
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f'<img alt="{esc(case["id"])}" src="data:{mime};base64,{b64}">'


def case_html(c):
    k, ai = c["key"], c["aiReading"]
    rows = "".join(
        f"<tr><td>{esc(f['finding'])}<div class=kw>keywords (offline grading): {esc(', '.join(f.get('keywords', [])))}</div></td>"
        f"<td class=n>{f['points']:g}</td></tr>" for f in k["keyFindings"])
    rows += (f"<tr><td><b>Diagnosis:</b> {esc(k['diagnosis'])}<div class=kw>accepted equivalents / keywords: "
             f"{esc(', '.join(k.get('diagnosisKeywords', [])))}</div></td><td class=n>{k['diagnosisPoints']:g}</td></tr>")
    total = sum(f["points"] for f in k["keyFindings"]) + k["diagnosisPoints"]
    rows += f"<tr><th>Total</th><th class=n>{total:g}</th></tr>"
    ai_f = "".join(f"<li>{esc(f)}</li>" for f in ai["findings"])
    ph = ('<div class=ph>PLACEHOLDER — fake image and fake key for software testing only. Do not review clinically.</div>'
          if c.get("placeholder") else "")
    return f"""
<section class=case>
  <h2>{esc(c['id'])} — <span class=status>status: {esc(c['reviewStatus'])}</span></h2>
  {ph}
  <div class=grid>
    <div>{img_tag(c)}<p class=kw>File: booth03/{esc(c['image'])}</p><p><b>Question shown:</b> {esc(c['question'])}</p></div>
    <div>
      <h3>Answer key (points)</h3><table>{rows}</table>
      <h3>Expert explanation</h3><p style="white-space:pre-line">{esc(c['expertExplanation'])}</p>
    </div>
  </div>
  <h3>AI reading (AI-generated, unverified) — AI score vs key: {c['aiScore']:g} / 10</h3>
  <ul>{ai_f}</ul>
  <p><b>Impression:</b> {esc(ai['impression'])} &nbsp; <b>Confidence:</b> {esc(ai['confidence'])}</p>
  <p><b>Limitation:</b> {esc(ai['limitation'])}</p>
  <div class=decision>Decision: <span class=box></span>Approve <span class=box></span>Edit <span class=box></span>Reject
    &nbsp;&nbsp; Reviewer: ____________________ &nbsp; Date: __________
    <div>Comment:</div><div class=line></div><div class=line></div>
  </div>
</section>"""


def export(cases, out=OUT):
    out.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(case_html(c) for c in cases)
    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Booth 03 — case review (DRAFT)</title><style>{CSS}</style></head>
<body>
<header>
  <h1>Booth 03 “AI vs Human: Read the Scan” — case review</h1>
  <div><span class=stamp>DRAFT</span><span class=stamp>AI-ASSISTED</span><span class=stamp>REQUIRES SPECIALIST REVIEW</span></div>
  <p>Generated {date.today().isoformat()} · {len(cases)} case(s). The AI readings were produced by a general AI model and are
  <b>not</b> clinical opinions. Nothing in this file is approved until a dentistry specialist marks it below.
  For each case: check the image is suitable and anonymised, check the key findings, points (total must be 10),
  diagnosis and accepted equivalents, and the two-line explanation. Then tick Approve / Edit / Reject and comment.</p>
</header>
{body}
</body></html>
"""
    out.write_text(doc, encoding="utf-8")
    return out


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "cases.json"
    cases = json.loads(path.read_text(encoding="utf-8"))
    print(f"Wrote {export(cases)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
