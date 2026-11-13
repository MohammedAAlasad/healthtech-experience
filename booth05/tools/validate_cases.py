#!/usr/bin/env python3
"""Validate booth05/data/cases.json (stdlib only).

Usage: python3 booth05/tools/validate_cases.py [path/to/cases.json]
Exit code 0 = valid, 1 = problems (each printed on its own line).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ROOT / "data" / "cases.json"

REVIEW = {"PENDING_REVIEW", "APPROVED", "REJECTED"}
TIERS = ["correct", "partial", "common_wrong", "meds_only"]
OUTCOME_TIERS = {"healed", "improved", "complication", "worse"}
AVATARS = {"m_young", "f_young", "m_older"}
STATES = {"neutral", "pain", "worried", "relieved"}
FACT_KEYS = ["onset", "duration", "painCharacter", "severity", "aggravatingFactors", "relievingFactors", "medicalHistory",
             "medications", "allergies", "habits", "dentalHistory", "systemicSigns"]
ARABIC = re.compile(r"[؀-ۿ]")

# Dosages: "500 mg", "500mg", "ملغ", "ملجم", "مليغرام", "mcg", "ml" doses, "x times a day" with numbers.
DOSAGE = re.compile(r"\d\s*(mg|mcg|µg|g|ml|iu)\b|\bmg\b|ملغ|ملجم|مليغرام|ميليغرام|ملغم|\d+\s*(times|مرات)\s*(a|per|في|باليوم|يوميا)", re.I)
# Medicine brand names (English + Arabic spellings) that must not appear anywhere.
BRANDS = ["panadol", "adol", "tylenol", "brufen", "advil", "nurofen", "voltaren", "cataflam", "profinal", "augmentin", "amoxil",
          "flagyl", "zithromax", "solpadeine", "fevadol", "corsodyl", "listerine", "sensodyne", "orajel",
          "بنادول", "بندول", "أدول", "ادول", "بروفين", "بروفيين", "فولتارين", "كتافلام", "بروفينال", "أوجمنتين", "اوجمنتين",
          "أموكسيل", "فلاجيل", "زيثروماكس", "فيفادول", "سولبادين"]


def is_ar(s):
    return isinstance(s, str) and bool(ARABIC.search(s))


def nonempty(s):
    return isinstance(s, str) and s.strip() != ""


def all_strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from all_strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from all_strings(x)


def brand_hit(s):
    low = s.lower()
    for b in BRANDS:
        if re.match(r"[a-z]", b):
            if re.search(r"(?<![a-z])" + re.escape(b) + r"(?![a-z])", low):
                return b
        elif b in s:
            return b
    return None


def validate(data):
    errs = []
    if not isinstance(data, dict) or not isinstance(data.get("cases"), list):
        return ["top level must be an object with a 'cases' array"]
    cases = data["cases"]
    if not cases:
        errs.append("no cases")
    ids = set()
    for ci, c in enumerate(cases):
        p = f"cases[{ci}]"
        if not isinstance(c, dict):
            errs.append(p + " must be an object")
            continue
        cid = c.get("id")
        if not isinstance(cid, str) or not re.fullmatch(r"case\d{2}", cid):
            errs.append(p + ".id must look like case01")
        elif cid in ids:
            errs.append(p + ".id duplicate " + cid)
        else:
            ids.add(cid)
            p = cid
        if c.get("reviewStatus") not in REVIEW:
            errs.append(p + ".reviewStatus must be one of " + ", ".join(sorted(REVIEW)))
        if not nonempty(c.get("title")):
            errs.append(p + ".title missing")

        pr = c.get("profile") or {}
        for k in ["name", "nameAr", "personality", "opener"]:
            if not nonempty(pr.get(k)):
                errs.append(f"{p}.profile.{k} missing")
        if not is_ar(pr.get("nameAr")):
            errs.append(p + ".profile.nameAr must be Arabic")
        if not is_ar(pr.get("opener")):
            errs.append(p + ".profile.opener must be Arabic")
        if not isinstance(pr.get("age"), int) or not 1 <= pr.get("age") <= 110:
            errs.append(p + ".profile.age must be an integer")
        if pr.get("sex") not in ("male", "female"):
            errs.append(p + ".profile.sex must be male or female")
        if pr.get("avatar") not in AVATARS:
            errs.append(p + ".profile.avatar must be one of " + ", ".join(sorted(AVATARS)))
        if pr.get("baseState", "neutral") not in STATES:
            errs.append(p + ".profile.baseState must be one of " + ", ".join(sorted(STATES)))

        facts = c.get("facts") or {}
        for k in FACT_KEYS:
            if k == "severity":
                if not isinstance(facts.get(k), int) or not 0 <= facts.get(k) <= 10:
                    errs.append(p + ".facts.severity must be an integer 0-10")
            elif not nonempty(facts.get(k)):
                errs.append(f"{p}.facts.{k} missing")

        qs = c.get("keyQuestions")
        if not isinstance(qs, list) or len(qs) != 8:
            errs.append(p + ".keyQuestions must have exactly 8 items")
            qs = qs if isinstance(qs, list) else []
        for i, q in enumerate(qs):
            qp = f"{p}.keyQuestions[{i}]"
            if not isinstance(q, dict):
                errs.append(qp + " must be an object")
                continue
            if q.get("id") != f"Q{i + 1}":
                errs.append(f"{qp}.id must be Q{i + 1}")
            if not nonempty(q.get("label")):
                errs.append(qp + ".label missing")
            kw = q.get("keywords")
            if not isinstance(kw, list) or not all(nonempty(k) for k in kw):
                errs.append(qp + ".keywords must be a list of strings")
            else:
                if not any(is_ar(k) for k in kw):
                    errs.append(qp + ".keywords need at least one Arabic keyword")
                if not any(re.search(r"[A-Za-z]", k) for k in kw):
                    errs.append(qp + ".keywords need at least one English keyword")
            if not is_ar(q.get("answer")):
                errs.append(qp + ".answer must be Arabic")

        dx = c.get("diagnosis") or {}
        if dx.get("id") != "DX":
            errs.append(p + ".diagnosis.id must be DX")
        if not nonempty(dx.get("label")):
            errs.append(p + ".diagnosis.label missing")
        acc = dx.get("accept")
        if not isinstance(acc, list) or not acc or not all(nonempty(a) for a in acc):
            errs.append(p + ".diagnosis.accept must be a non-empty list of strings")
        else:
            if not any(is_ar(a) for a in acc):
                errs.append(p + ".diagnosis.accept needs Arabic synonyms")
            if not any(re.search(r"[A-Za-z]", a) for a in acc):
                errs.append(p + ".diagnosis.accept needs English synonyms")
        if "hintTerms" in dx and (not isinstance(dx["hintTerms"], list) or not all(nonempty(a) for a in dx["hintTerms"])):
            errs.append(p + ".diagnosis.hintTerms must be a list of strings")

        opts = c.get("treatmentOptions")
        if not isinstance(opts, list) or len(opts) != 4:
            errs.append(p + ".treatmentOptions must have exactly 4 items")
            opts = opts if isinstance(opts, list) else []
        tiers = []
        for i, o in enumerate(opts):
            op = f"{p}.treatmentOptions[{i}]"
            if not isinstance(o, dict):
                errs.append(op + " must be an object")
                continue
            if o.get("id") != f"T{i + 1}":
                errs.append(f"{op}.id must be T{i + 1}")
            if o.get("tier") not in TIERS:
                errs.append(op + ".tier must be one of " + ", ".join(TIERS))
            tiers.append(o.get("tier"))
            if o.get("outcomeTier") not in OUTCOME_TIERS:
                errs.append(op + ".outcomeTier must be one of " + ", ".join(sorted(OUTCOME_TIERS)))
            for k in ["label", "why"]:
                if not nonempty(o.get(k)):
                    errs.append(f"{op}.{k} missing")
            kw = o.get("keywords")
            if not isinstance(kw, list) or not kw or not all(nonempty(k) for k in kw):
                errs.append(op + ".keywords must be a non-empty list of strings")
            elif not any(is_ar(k) for k in kw):
                errs.append(op + ".keywords need at least one Arabic keyword")
            if not is_ar(o.get("outcome")):
                errs.append(op + ".outcome must be Arabic")
            else:
                n = len([s for s in re.split(r"[.!؟?]+", o["outcome"]) if s.strip()])
                if not 2 <= n <= 3:
                    errs.append(f"{op}.outcome must be 2-3 sentences (found {n})")
        if sorted(t for t in tiers if t) != sorted(TIERS):
            errs.append(p + ".treatmentOptions must contain exactly one of each tier: " + ", ".join(TIERS))

        um = c.get("unmatchedOutcome") or {}
        if um.get("outcomeTier") != "unclear" or not is_ar(um.get("outcome")) or not nonempty(um.get("why")):
            errs.append(p + ".unmatchedOutcome needs outcomeTier 'unclear', an Arabic outcome and a why")
        fl = c.get("fallbackLines")
        if not isinstance(fl, list) or not fl or not all(is_ar(x) for x in fl):
            errs.append(p + ".fallbackLines must be a non-empty list of Arabic lines")
        rn = c.get("reviewNotes")
        if not isinstance(rn, list) or not rn or not all(nonempty(x) for x in rn):
            errs.append(p + ".reviewNotes must be a non-empty list")

        for s in all_strings(c):
            if DOSAGE.search(s):
                errs.append(f"{p}: dosage-like text not allowed: {s[:80]!r}")
            b = brand_hit(s)
            if b:
                errs.append(f"{p}: medicine brand name not allowed ({b}): {s[:80]!r}")
    return errs


def main(argv):
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: cannot read {path}: {e}")
        return 1
    errs = validate(data)
    for e in errs:
        print("ERROR: " + e)
    if errs:
        print(f"{len(errs)} problem(s) in {path}")
        return 1
    n = len(data["cases"])
    pending = sum(1 for c in data["cases"] if c.get("reviewStatus") != "APPROVED")
    print(f"OK: {n} case(s) valid ({pending} not yet APPROVED)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
