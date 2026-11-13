#!/usr/bin/env python3
"""Regenerate booth06/review/cases_for_review.md from booth06/data/cases.json (printable doc for the dentistry team).

Usage: python3 booth06/tools/export_review.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_cases import load  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main():
    cases = load(ROOT / "data" / "cases.json")
    out = [
        "# DRAFT — Booth 06 Clinical Diagnosis Challenge: cases for specialist review",
        "",
        "**Status: DRAFT. AI-generated content. Requires review by the dentistry team before use.**",
        "Nothing in this document has been reviewed or approved yet.",
        "",
        "HealthTech Experience · Programming Club, College of Dentistry, IAU",
        "",
        "How to review: for each case, check every line, then mark **Approve / Edit / Reject** and write any",
        "corrections in the comment space. Accepted differentials earn points; essential investigations earn",
        "points and non-essential ones cost points, so please check those flags carefully.",
        "",
    ]
    for n, c in enumerate(cases, start=1):
        out += [
            "---",
            "",
            f"## Case {n}: {c['title']}",
            "",
            f"*Case ID: `{c['id']}` · Current status: **{c['reviewStatus']}***",
            "",
            f"**Patient:** {c['patient']}",
            "",
            f"**Chief complaint (patient's words):** \"{c['chiefComplaint']}\"",
            "",
            "**History:**",
            "",
        ]
        out += [f"- {h}" for h in c["history"]]
        out += ["", "**Differential diagnoses** (✔ = accepted, earns points):", "",
                "| # | Differential | Accepted |", "|---|---|---|"]
        for i, d in enumerate(c["differentials"], start=1):
            out.append(f"| {i} | {d} | {'✔ yes' if d in c['acceptedDifferentials'] else 'no'} |")
        out += ["", "**Investigations:**", "", "| Investigation | Result shown to the player | Essential |", "|---|---|---|"]
        for inv in c["investigations"]:
            result = inv["result"].replace("|", "\\|")
            out.append(f"| {inv['name']} | {result} | {'✔ yes' if inv['essential'] else 'no'} |")
        out += [
            "",
            f"**Final diagnosis:** {c['finalDiagnosis']}",
            "",
            f"**Teaching point:** {c['teachingPoint']}",
            "",
            "**Reviewer decision:**  ☐ Approve   ☐ Edit   ☐ Reject",
            "",
            "Comment: ______________________________________________________________",
            "",
            "_______________________________________________________________________",
            "",
            "Reviewer name / date: ____________________________",
            "",
        ]
    path = ROOT / "review" / "cases_for_review.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text("\n".join(out), encoding="utf-8")
    print(f"OK: wrote {path} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
