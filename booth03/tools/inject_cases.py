#!/usr/bin/env python3
"""Copy booth03/data/cases.json into booth03/index.html (between // BEGIN CASES and // END CASES).

Usage: python3 booth03/tools/inject_cases.py [booth03/data/cases.json] [booth03/index.html]
Refuses to run if the cases do not pass validate_cases.py.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_cases import validate, load  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = ROOT / "data" / "cases.json"
HTML_PATH = ROOT / "index.html"  # booth03/index.html
BLOCK = re.compile(r"(// BEGIN CASES\n)(.*?)(// END CASES)", re.S)


def main():
    cases_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CASES_PATH
    html_path = Path(sys.argv[2]) if len(sys.argv) > 2 else HTML_PATH
    try:
        cases = load(cases_path)
    except (OSError, json.JSONDecodeError) as e:
        print(f"REFUSED: cannot read {cases_path}: {e}")
        return 1
    errors, warnings = validate(cases)
    for w in warnings:
        print("WARNING: " + w)
    if errors:
        print(f"REFUSED: {cases_path} failed validation ({len(errors)} problem(s)):")
        for e in errors:
            print("  - " + e)
        return 1

    html = html_path.read_text(encoding="utf-8")
    if len(BLOCK.findall(html)) != 1:
        print(f"REFUSED: expected exactly one '// BEGIN CASES' ... '// END CASES' block in {html_path}.")
        return 1
    # "</" and U+2028/2029 are escaped so case text can never break out of the <script> tag.
    payload = (json.dumps(cases, ensure_ascii=False, indent=2)
               .replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
    new_html = BLOCK.sub(lambda m: m.group(1) + "const CASES = " + payload + ";\n" + m.group(3), html)
    html_path.write_text(new_html, encoding="utf-8")
    shown = [c for c in cases if c["reviewStatus"] != "REJECTED"]
    banner = any(c["reviewStatus"] != "APPROVED" or c.get("placeholder") for c in shown)
    print(f"OK: injected {len(cases)} cases into {html_path} ({len(shown)} shown; red DRAFT banner "
          f"{'ON' if banner else 'off'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
