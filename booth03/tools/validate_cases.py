#!/usr/bin/env python3
"""Validate data/cases.json for Booth 03 (Read the Scan).

Usage: python3 booth03/tools/validate_cases.py [booth03/data/cases.json]
Exit code 0 = valid (warnings allowed), 1 = errors. Placeholder cases only produce warnings.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT  # booth03/: the page and images/ live here
DEFAULT_PATH = ROOT / "data" / "cases.json"
REVIEW_STATUSES = {"DRAFT", "APPROVED", "REJECTED"}
CONFIDENCE = {"low", "medium", "high"}
REQUIRED = ["id", "image", "question", "key", "aiReading", "aiScore", "expertExplanation", "reviewStatus"]
TOTAL = 10


def nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def str_list(v, min_len=1):
    return isinstance(v, list) and len(v) >= min_len and all(nonempty_str(x) for x in v)


def validate_key(key, where, errors):
    """Checks an answer key object. Also used by prepare_ai_readings.py for data/keys.json."""
    if not isinstance(key, dict):
        errors.append(f"{where}: 'key' must be an object.")
        return
    kf = key.get("keyFindings")
    total = 0.0
    labels = []
    if not isinstance(kf, list) or not kf:
        errors.append(f"{where}: key.keyFindings must be a non-empty list.")
        kf = []
    for i, f in enumerate(kf, start=1):
        w = f"{where}: keyFindings #{i}"
        if not isinstance(f, dict):
            errors.append(f"{w} must be an object.")
            continue
        if not nonempty_str(f.get("finding")):
            errors.append(f"{w} needs a non-empty 'finding'.")
        else:
            labels.append(f["finding"].strip().lower())
        if not is_num(f.get("points")) or f["points"] <= 0:
            errors.append(f"{w} 'points' must be a number > 0.")
        else:
            total += f["points"]
        if not str_list(f.get("keywords")):
            errors.append(f"{w} 'keywords' must be a non-empty list of strings (used for offline grading).")
    if not nonempty_str(key.get("diagnosis")):
        errors.append(f"{where}: key.diagnosis must be a non-empty string.")
    else:
        labels.append(key["diagnosis"].strip().lower())
    if not is_num(key.get("diagnosisPoints")) or key["diagnosisPoints"] < 0:
        errors.append(f"{where}: key.diagnosisPoints must be a number >= 0.")
    else:
        total += key["diagnosisPoints"]
    if not str_list(key.get("diagnosisKeywords")):
        errors.append(f"{where}: key.diagnosisKeywords must be a non-empty list of strings.")
    if abs(total - TOTAL) > 1e-9:
        errors.append(f"{where}: keyFindings points + diagnosisPoints = {total:g}, must be exactly {TOTAL}.")
    if len(set(labels)) != len(labels):
        errors.append(f"{where}: finding and diagnosis texts must all be different (the grader matches on them).")


def validate(cases, docs_dir=DOCS):
    """Returns (errors, warnings) as lists of readable strings."""
    errors, warnings = [], []
    if not isinstance(cases, list) or not cases:
        return ["Top level must be a non-empty JSON array of cases."], warnings
    seen = set()
    for n, c in enumerate(cases, start=1):
        where = f"Case #{n}"
        if not isinstance(c, dict):
            errors.append(f"{where}: must be an object.")
            continue
        if nonempty_str(c.get("id")):
            where = f"Case #{n} ({c['id']})"
            if c["id"] in seen:
                errors.append(f"{where}: duplicate id.")
            seen.add(c["id"])
        for k in REQUIRED:
            if k not in c:
                errors.append(f"{where}: missing field '{k}'.")
        for k in ["id", "image", "question", "expertExplanation"]:
            if k in c and not nonempty_str(c[k]):
                errors.append(f"{where}: '{k}' must be a non-empty string.")
        if nonempty_str(c.get("image")):
            p = (docs_dir / c["image"]).resolve()
            if docs_dir.resolve() not in p.parents:
                errors.append(f"{where}: image path must stay inside booth03/ (got '{c['image']}').")
            elif not p.is_file():
                errors.append(f"{where}: image file not found: booth03/{c['image']}")
        if "key" in c:
            validate_key(c["key"], where, errors)
        ai = c.get("aiReading")
        if "aiReading" in c:
            if not isinstance(ai, dict):
                errors.append(f"{where}: 'aiReading' must be an object.")
            else:
                if not str_list(ai.get("findings")):
                    errors.append(f"{where}: aiReading.findings must be a non-empty list of strings.")
                for k in ["impression", "limitation"]:
                    if not nonempty_str(ai.get(k)):
                        errors.append(f"{where}: aiReading.{k} must be a non-empty string.")
                if ai.get("confidence") not in CONFIDENCE:
                    errors.append(f"{where}: aiReading.confidence must be low, medium or high.")
        if "aiScore" in c and (not is_num(c["aiScore"]) or not 0 <= c["aiScore"] <= 10):
            errors.append(f"{where}: aiScore must be a number between 0 and 10.")
        if "reviewStatus" in c and c["reviewStatus"] not in REVIEW_STATUSES:
            errors.append(f"{where}: reviewStatus must be one of {sorted(REVIEW_STATUSES)}.")
        if "placeholder" in c and not isinstance(c["placeholder"], bool):
            errors.append(f"{where}: 'placeholder' must be true or false.")
        if c.get("placeholder"):
            warnings.append(f"{where}: PLACEHOLDER case (fake image and key) — replace before the event.")
            if c.get("reviewStatus") == "APPROVED":
                errors.append(f"{where}: a placeholder case can never be APPROVED.")
    if cases and all(isinstance(c, dict) and c.get("reviewStatus") == "REJECTED" for c in cases):
        errors.append("Every case is REJECTED: the booth would have nothing to show.")
    return errors, warnings


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
    errors, warnings = validate(cases)
    for w in warnings:
        print("WARNING: " + w)
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
