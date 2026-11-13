#!/usr/bin/env python3
"""Copy booth05/data/cases.json into booth05/index.html (between // BEGIN CASES and // END CASES).

Usage: python3 booth05/tools/inject_cases.py
Refuses to run if validate_cases.py reports problems.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_cases import validate  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "data" / "cases.json"
HTML = ROOT / "index.html"


def main():
    data = json.loads(CASES.read_text(encoding="utf-8"))
    errs = validate(data)
    if errs:
        for e in errs:
            print("ERROR: " + e)
        print("Not injected: fix booth05/data/cases.json first.")
        return 1
    html = HTML.read_text(encoding="utf-8")
    block = "// BEGIN CASES\nconst CASES = " + json.dumps(data["cases"], ensure_ascii=False, indent=2) + ";\n// END CASES"
    new, n = re.subn(r"// BEGIN CASES\n.*?// END CASES", lambda m: block, html, count=1, flags=re.S)
    if n != 1:
        print("ERROR: markers // BEGIN CASES / // END CASES not found in booth05/index.html")
        return 1
    HTML.write_text(new, encoding="utf-8")
    print(f"Injected {len(data['cases'])} case(s) into {HTML.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
