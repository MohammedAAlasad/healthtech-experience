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


# Common Gulf/Saudi dialect markers. The Arabic patient text is simple Modern Standard Arabic (فصحى مبسطة);
# dialect is allowed only in keywords (visitors may ask in dialect).
DIALECT_MARKERS = ["وش", "ايش", "شنو", "كذا", "الحين", "أبغى", "أبي", "يبي", "شلون", "ليش", "مب", "ما أدري", "وايد", "هب",
                   "عشان", "شوي", "زين", "إيه", "اللي", "مو", "يبغى", "تبغى", "بس", "خلني", "ابغى", "دحين"]


def _norm_ar(text):
    out = []
    for ch in str(text or ""):
        o = ord(ch)
        if 0x064B <= o <= 0x065F or o in (0x0670, 0x0640):
            continue
        ch = "ا" if ch in "أإآٱ" else {"ى": "ي", "ة": "ه"}.get(ch, ch)
        out.append(ch)
    return " ".join(re.findall(r"[\u0621-\u064A]+", "".join(out)))


def dialect_hits(text):
    """Dialect markers found in an Arabic text (whole words; a leading و/ف is ignored), e.g. ['وش', 'ما ادري']."""
    words = _norm_ar(text).split()
    padded = " " + " ".join(words) + " "
    hits = []
    for m in DIALECT_MARKERS:
        nm = _norm_ar(m)
        if " " in nm:
            if " " + nm + " " in padded:
                hits.append(nm)
        elif any(w == nm or (len(w) > len(nm) and w[0] in "وف" and w[1:] == nm) for w in words):
            hits.append(nm)
    return list(dict.fromkeys(hits))


def is_ar(s):
    return isinstance(s, str) and bool(ARABIC.search(s))


def is_en(s):
    """English text: has Latin letters and no Arabic letters."""
    return isinstance(s, str) and bool(re.search(r"[A-Za-z]", s)) and not ARABIC.search(s)


def sentences(s):
    return len([x for x in re.split(r"[.!؟?]+", s) if x.strip()])


def kw_list(v, lang):
    """Non-empty list of strings, all Arabic (lang 'ar') or all English ('en')."""
    return isinstance(v, list) and bool(v) and all((is_ar(k) if lang == "ar" else is_en(k)) for k in v)


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
        if not is_en(pr.get("openerEn")):
            errs.append(p + ".profile.openerEn must be English")
        if not isinstance(pr.get("age"), int) or not 1 <= pr.get("age") <= 110:
            errs.append(p + ".profile.age must be an integer")
        if pr.get("sex") not in ("male", "female"):
            errs.append(p + ".profile.sex must be male or female")
        av = pr.get("avatar")
        if isinstance(av, dict):
            if av.get("type") != "photo":
                errs.append(p + ".profile.avatar.type must be 'photo'")
            if not isinstance(av.get("dir"), str) or not re.fullmatch(r"images/avatar/[A-Za-z0-9_-]+", av.get("dir") or ""):
                errs.append(p + ".profile.avatar.dir must look like images/avatar/case01")
            st = av.get("states")
            if not isinstance(st, list) or not st or not set(st) <= STATES or "neutral" not in st:
                errs.append(p + ".profile.avatar.states must be a subset of " + ", ".join(sorted(STATES)) + " and include neutral")
            if av.get("svg") not in AVATARS:
                errs.append(p + ".profile.avatar.svg (fallback) must be one of " + ", ".join(sorted(AVATARS)))
        elif av not in AVATARS:
            errs.append(p + ".profile.avatar must be one of " + ", ".join(sorted(AVATARS)) + " or a photo avatar object")
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
            if not kw_list(q.get("keywords"), "ar"):
                errs.append(qp + ".keywords must be a non-empty list of Arabic keywords (English ones go in keywordsEn)")
            if not kw_list(q.get("keywordsEn"), "en"):
                errs.append(qp + ".keywordsEn must be a non-empty list of English keywords")
            if not is_ar(q.get("answer")):
                errs.append(qp + ".answer must be Arabic")
            if not is_en(q.get("answerEn")):
                errs.append(qp + ".answerEn must be English")

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
            if not kw_list(o.get("keywords"), "ar"):
                errs.append(op + ".keywords must be a non-empty list of Arabic keywords (English ones go in keywordsEn)")
            if not kw_list(o.get("keywordsEn"), "en"):
                errs.append(op + ".keywordsEn must be a non-empty list of English keywords")
            for k, check, name in (("outcome", is_ar, "Arabic"), ("outcomeEn", is_en, "English")):
                if not check(o.get(k)):
                    errs.append(f"{op}.{k} must be {name}")
                elif not 2 <= sentences(o[k]) <= 3:
                    errs.append(f"{op}.{k} must be 2-3 sentences (found {sentences(o[k])})")
        if sorted(t for t in tiers if t) != sorted(TIERS):
            errs.append(p + ".treatmentOptions must contain exactly one of each tier: " + ", ".join(TIERS))

        um = c.get("unmatchedOutcome") or {}
        if um.get("outcomeTier") != "unclear" or not is_ar(um.get("outcome")) or not nonempty(um.get("why")):
            errs.append(p + ".unmatchedOutcome needs outcomeTier 'unclear', an Arabic outcome and a why")
        if not is_en(c.get("unmatchedOutcomeEn")):
            errs.append(p + ".unmatchedOutcomeEn must be English")
        fl = c.get("fallbackLines")
        if not isinstance(fl, list) or not fl or not all(is_ar(x) for x in fl):
            errs.append(p + ".fallbackLines must be a non-empty list of Arabic lines")
        fle = c.get("fallbackLinesEn")
        if not isinstance(fle, list) or not fle or not all(is_en(x) for x in fle):
            errs.append(p + ".fallbackLinesEn must be a non-empty list of English lines")
        rn = c.get("reviewNotes")
        if not isinstance(rn, list) or not rn or not all(nonempty(x) for x in rn):
            errs.append(p + ".reviewNotes must be a non-empty list")

        patient_ar = [("profile.opener", pr.get("opener")), ("unmatchedOutcome.outcome", (c.get("unmatchedOutcome") or {}).get("outcome"))]
        patient_ar += [(f"keyQuestions[{i}].answer", q.get("answer")) for i, q in enumerate(c.get("keyQuestions") or []) if isinstance(q, dict)]
        patient_ar += [(f"treatmentOptions[{i}].outcome", o.get("outcome")) for i, o in enumerate(c.get("treatmentOptions") or []) if isinstance(o, dict)]
        patient_ar += [(f"fallbackLines[{i}]", t) for i, t in enumerate(c.get("fallbackLines") or [])]
        for field, text in patient_ar:
            hits = dialect_hits(text)
            if hits:
                errs.append(f"{p}.{field}: dialect word(s) {', '.join(hits)} — use simple Modern Standard Arabic: {str(text)[:60]!r}")

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
