#!/usr/bin/env python3
"""Validate booth06/data/cases.json for Booth 06.

Usage: python3 booth06/tools/validate_cases.py [booth06/data/cases.json]
Exit code 0 = valid, 1 = errors (printed one per line).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "data" / "cases.json"
REVIEW_STATUSES = {"DRAFT", "APPROVED", "REJECTED"}
REQUIRED = ["id", "title", "patient", "chiefComplaint", "history", "differentials",
            "acceptedDifferentials", "investigations", "finalDiagnosis", "teachingPoint", "reviewStatus"]


def nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""


def validate(cases):
    """Return a list of human-readable error strings (empty = valid)."""
    errors = []
    if not isinstance(cases, list) or not cases:
        return ["Top level must be a non-empty JSON array of cases."]
    seen_ids = set()
    for n, c in enumerate(cases, start=1):
        where = f"Case #{n}"
        if not isinstance(c, dict):
            errors.append(f"{where}: must be an object.")
            continue
        if nonempty_str(c.get("id")):
            where = f"Case #{n} ({c['id']})"
            if c["id"] in seen_ids:
                errors.append(f"{where}: duplicate id.")
            seen_ids.add(c["id"])
        for key in REQUIRED:
            if key not in c:
                errors.append(f"{where}: missing field '{key}'.")
        for key in ["id", "title", "patient", "chiefComplaint", "finalDiagnosis", "teachingPoint"]:
            if key in c and not nonempty_str(c[key]):
                errors.append(f"{where}: '{key}' must be a non-empty string.")

        hist = c.get("history")
        if not (isinstance(hist, list) and 2 <= len(hist) <= 3 and all(nonempty_str(h) for h in hist)):
            errors.append(f"{where}: 'history' must be a list of 2-3 non-empty strings.")

        diffs = c.get("differentials")
        diffs_ok = isinstance(diffs, list) and all(nonempty_str(d) for d in diffs)
        if not diffs_ok or len(diffs) != 6:
            errors.append(f"{where}: 'differentials' must be exactly 6 non-empty strings.")
        elif len(set(diffs)) != 6:
            errors.append(f"{where}: 'differentials' contains duplicates.")
        diffs = diffs if diffs_ok else []

        acc = c.get("acceptedDifferentials")
        if not (isinstance(acc, list) and 2 <= len(acc) <= 3 and all(nonempty_str(a) for a in acc)):
            errors.append(f"{where}: 'acceptedDifferentials' must list 2-3 diagnoses.")
            acc = acc if isinstance(acc, list) else []
        else:
            if len(set(acc)) != len(acc):
                errors.append(f"{where}: 'acceptedDifferentials' contains duplicates.")
            for a in acc:
                if a not in diffs:
                    errors.append(f"{where}: accepted differential '{a}' is not one of the 6 differentials.")

        final = c.get("finalDiagnosis")
        if nonempty_str(final):
            if final not in diffs:
                errors.append(f"{where}: finalDiagnosis '{final}' is not one of the 6 differentials.")
            if final not in acc:
                errors.append(f"{where}: finalDiagnosis '{final}' is not in acceptedDifferentials.")

        invs = c.get("investigations")
        if not isinstance(invs, list) or len(invs) != 6:
            errors.append(f"{where}: 'investigations' must be exactly 6 items.")
            invs = invs if isinstance(invs, list) else []
        names = []
        essential = 0
        for i, inv in enumerate(invs, start=1):
            if not isinstance(inv, dict):
                errors.append(f"{where}: investigation #{i} must be an object.")
                continue
            if not nonempty_str(inv.get("name")):
                errors.append(f"{where}: investigation #{i} needs a non-empty 'name'.")
            else:
                names.append(inv["name"])
            if not nonempty_str(inv.get("result")):
                errors.append(f"{where}: investigation #{i} needs a non-empty 'result'.")
            if not isinstance(inv.get("essential"), bool):
                errors.append(f"{where}: investigation #{i} 'essential' must be true or false.")
            elif inv["essential"]:
                essential += 1
        if len(set(names)) != len(names):
            errors.append(f"{where}: investigation names must be unique.")
        if invs and not 2 <= essential <= 3:
            errors.append(f"{where}: must have 2-3 essential investigations (found {essential}).")

        if "reviewStatus" in c and c["reviewStatus"] not in REVIEW_STATUSES:
            errors.append(f"{where}: reviewStatus must be one of {sorted(REVIEW_STATUSES)}.")
    return errors


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH
    try:
        cases = load(path)
    except FileNotFoundError:
        print(f"ERROR: file not found: {path}")
        return 1
    except json.JSONDecodeError as e:
        print(f"ERROR: {path} is not valid JSON: line {e.lineno}, column {e.colno}: {e.msg}")
        return 1
    errors = validate(cases)
    if errors:
        print(f"INVALID: {len(errors)} problem(s) in {path}")
        for e in errors:
            print("  - " + e)
        return 1
    statuses = {}
    for c in cases:
        statuses[c["reviewStatus"]] = statuses.get(c["reviewStatus"], 0) + 1
    print(f"OK: {len(cases)} cases valid ({', '.join(f'{k}: {v}' for k, v in sorted(statuses.items()))})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
