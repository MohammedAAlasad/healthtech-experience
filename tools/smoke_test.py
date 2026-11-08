#!/usr/bin/env python3
"""End-to-end smoke test of the deployed Apps Script backend (stdlib only).

Usage: python3 tools/smoke_test.py <WEB_APP_URL>
All fake student IDs start with 999. Afterwards run clearTestData() in the Apps Script editor.
"""
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

TIMEOUT = 30


def call(url, method="GET", params=None, body=None):
    """Returns (parsed_json_or_None, raw_text)."""
    if method == "GET":
        full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params or {})
        req = urllib.request.Request(full)
    else:
        data = json.dumps(body).encode("utf-8")
        # text/plain like the browser does (no CORS preflight). urllib turns the 302 into a GET, as Apps Script expects.
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        raw = res.read().decode("utf-8")
    try:
        return json.loads(raw), raw
    except json.JSONDecodeError:
        return None, raw


def post(url, body):
    return call(url, "POST", body=body)[0]


def get(url, **params):
    return call(url, "GET", params=params)[0]


def fake_id():
    return "999" + "".join(random.choice("0123456789") for _ in range(6))


class Checks:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def check(self, name, ok, detail=""):
        if ok:
            self.passed += 1
            print(f"PASS  {name}")
        else:
            self.failed += 1
            print(f"FAIL  {name}" + (f"  -> {detail}" if detail else ""))
        return ok


def main():
    if len(sys.argv) < 2 or not sys.argv[1].startswith("http"):
        print("Usage: python3 tools/smoke_test.py <WEB_APP_URL>")
        return 2
    url = sys.argv[1].strip()
    t = Checks()
    sid = fake_id()
    sid2 = fake_id()
    while sid2 == sid:
        sid2 = fake_id()
    name = f"Smoke Test {sid[-4:]}"
    print(f"Testing {url}\nFake IDs: {sid}, {sid2}\n")

    try:
        r = get(url, action="ping")
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"FAIL  ping -> cannot reach the URL: {e}")
        return 1
    if not t.check("ping returns ok", bool(r and r.get("ok")), r):
        print("\nThe URL did not return JSON. Check: Deploy > Web app > Who has access: Anyone, and that the URL ends in /exec.")
        return 1

    r = post(url, {"action": "register", "studentId": sid, "name": name})
    t.check("register new participant", bool(r and r.get("ok")), r)

    r = get(url, action="participant", studentId=sid)
    t.check("participant lookup finds the name", bool(r and r.get("found") and r.get("name") == name), r)

    r = get(url, action="participant", studentId="999999999999")
    t.check("unknown participant -> found:false", bool(r and r.get("found") is False), r)

    # First attempt counts, second does not.
    r = post(url, {"action": "score", "studentId": sid, "booth": "booth06", "points": 40,
                   "details": {"attemptId": str(uuid.uuid4()), "smoke": True}})
    t.check("first booth06 score is counted", bool(r and r.get("counted") is True and r.get("points") == 40), r)
    r = post(url, {"action": "score", "studentId": sid, "booth": "booth06", "points": 5,
                   "details": {"attemptId": str(uuid.uuid4()), "smoke": True}})
    t.check("second booth06 score is NOT counted", bool(r and r.get("counted") is False), r)

    # Same attemptId twice -> original result, no duplicate row.
    att = str(uuid.uuid4())
    r1 = post(url, {"action": "score", "studentId": sid, "booth": "booth03", "points": 30, "details": {"attemptId": att}})
    r2 = post(url, {"action": "score", "studentId": sid, "booth": "booth03", "points": 30, "details": {"attemptId": att}})
    t.check("booth03 first attempt counted", bool(r1 and r1.get("counted") is True), r1)
    t.check("same attemptId resent -> same result, flagged duplicate (no new row)",
            bool(r2 and r2.get("counted") is True and r2.get("duplicate") is True), r2)

    # Score with a name for an unregistered student creates the participant (offline check-in case).
    r = post(url, {"action": "score", "studentId": sid2, "booth": "booth03", "points": 10, "name": "Smoke Offline",
                   "details": {"attemptId": str(uuid.uuid4())}})
    p = get(url, action="participant", studentId=sid2)
    t.check("score with name creates a missing participant",
            bool(r and r.get("counted") is True and p and p.get("found") and p.get("name") == "Smoke Offline"), [r, p])

    # Invalid input.
    bad = [
        ("non-digit studentId", {"action": "score", "studentId": "abc123", "booth": "booth06", "points": 1}),
        ("too-short studentId", {"action": "score", "studentId": "99912", "booth": "booth06", "points": 1}),
        ("unknown booth", {"action": "score", "studentId": sid, "booth": "booth09", "points": 1}),
        ("negative points", {"action": "score", "studentId": sid, "booth": "booth06", "points": -1}),
        ("points as text", {"action": "score", "studentId": sid, "booth": "booth06", "points": "10"}),
        ("empty name on register", {"action": "register", "studentId": sid, "name": "  "}),
        ("61-char name on register", {"action": "register", "studentId": sid, "name": "x" * 61}),
        ("unknown action", {"action": "dropTables"}),
    ]
    for label, body in bad:
        r = post(url, body)
        t.check(f"rejects {label}", bool(r and "error" in r), r)

    # Caps.
    r = post(url, {"action": "score", "studentId": sid, "booth": "booth03", "points": 31, "details": {"attemptId": str(uuid.uuid4())}})
    t.check("rejects booth03 points above 30", bool(r and "error" in r), r)
    r = post(url, {"action": "score", "studentId": sid, "booth": "booth06", "points": 41, "details": {"attemptId": str(uuid.uuid4())}})
    t.check("rejects booth06 points above 40", bool(r and "error" in r), r)

    # Formula injection: the name must come back as text, never evaluated.
    inj_id = fake_id()
    post(url, {"action": "register", "studentId": inj_id, "name": "=1+1 Smoke"})
    r = get(url, action="participant", studentId=inj_id)
    t.check("formula-like name stored as text", bool(r and r.get("found") and "1+1" in str(r.get("name"))), r)

    # Leaderboard.
    time.sleep(1)
    lb, raw = call(url, "GET", params={"action": "leaderboard"})
    ok_shape = bool(lb and isinstance(lb.get("top"), list) and "perBooth" in lb and "updatedAt" in lb and "totalParticipants" in lb)
    t.check("leaderboard has the expected shape", ok_shape, raw[:300])
    if ok_shape:
        me = [p for p in lb["top"] if p.get("name") == name and p.get("idLast4") == sid[-4:]]
        if t.check("test player appears in the top 20", len(me) == 1,
                   "not found (the board may already be full of higher/earlier scores)"):
            p = me[0]
            t.check("booth03 + booth06 summed correctly (30 + 40 = 70, practice attempts ignored)",
                    p.get("total") == 70 and p.get("perBooth", {}).get("booth03") == 30 and p.get("perBooth", {}).get("booth06") == 40, p)
        b06 = [e for e in lb["perBooth"].get("booth06", []) if e.get("name") == name]
        t.check("perBooth.booth06 lists the counted 40 (not the practice 5)", bool(b06) and b06[0].get("points") == 40, b06)
    t.check("no full student ID anywhere in the leaderboard response",
            sid not in raw and sid2 not in raw and not re.search(r"\d{6,}", raw), "found a 6+ digit number")

    print(f"\n{t.passed} passed, {t.failed} failed")
    print("Clean up: Apps Script editor > select clearTestData > Run (deletes all IDs starting with 999).")
    return 0 if t.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
