#!/usr/bin/env python3
"""Load test: create fake participants + scores for booth03 and booth06 in parallel (stdlib only).

Usage: python3 tools/seed_fake_data.py <WEB_APP_URL> [--n 20] [--workers 10]
All fake IDs start with 999 -> remove them afterwards with clearTestData() in the Apps Script editor.
"""
import argparse
import json
import random
import sys
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

FIRST = ["Sara", "Omar", "Lama", "Faisal", "Noura", "Yousef", "Reem", "Khalid", "Hessa", "Abdullah",
         "Maha", "Turki", "Dana", "Saud", "Joud", "Nawaf", "Rawan", "Fahad", "Shahad", "Majed"]
LAST = ["A.", "B.", "D.", "F.", "G.", "H.", "K.", "M.", "Q.", "S.", "Z."]


def post(url, body, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def fake_participant(i):
    sid = "999" + str(random.randint(0, 999999)).zfill(6)
    return sid, f"Fake {random.choice(FIRST)} {random.choice(LAST)} #{i}"


def task(url, booth, sid, name):
    t0 = time.time()
    if booth == "booth03":
        points = random.choice([0, 10, 20, 30])
    else:
        points = random.randint(0, 40)
    r = post(url, {"action": "register", "studentId": sid, "name": name})
    if "error" in r:
        return booth, sid, None, r["error"], time.time() - t0
    r = post(url, {"action": "score", "studentId": sid, "booth": booth, "points": points, "name": name,
                   "details": {"attemptId": str(uuid.uuid4()), "seed": True}})
    return booth, sid, points, r.get("error"), time.time() - t0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("url")
    ap.add_argument("--n", type=int, default=20, help="number of fake participants (default 20)")
    ap.add_argument("--workers", type=int, default=10, help="parallel requests (default 10)")
    a = ap.parse_args()

    people = {}
    while len(people) < a.n:
        sid, name = fake_participant(len(people) + 1)
        people.setdefault(sid, name)
    # Every participant plays both booths -> 2*n concurrent "booth" sessions, like two booths at once.
    jobs = [(b, sid, name) for sid, name in people.items() for b in ("booth03", "booth06")]
    random.shuffle(jobs)

    expected = {}
    errors = 0
    durations = []
    start = time.time()
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(task, a.url, *j) for j in jobs]
        for f in as_completed(futs):
            try:
                booth, sid, pts, err, dur = f.result()
            except Exception as e:  # network errors, timeouts
                errors += 1
                print(f"ERROR  {e}")
                continue
            durations.append(dur)
            if err:
                errors += 1
                print(f"ERROR  {booth} {sid}: {err}")
            else:
                expected[sid] = expected.get(sid, 0) + pts
                print(f"ok     {booth} {sid[-4:]} +{pts}  ({dur:.1f}s)")
    total = time.time() - start
    print(f"\n{len(jobs)} booth sessions, {errors} error(s), {total:.1f}s total, "
          f"avg {sum(durations) / max(1, len(durations)):.1f}s, max {max(durations or [0]):.1f}s per session")

    # Compare with the leaderboard.
    with urllib.request.urlopen(a.url + ("&" if "?" in a.url else "?") + "action=leaderboard", timeout=60) as res:
        lb = json.loads(res.read().decode("utf-8"))
    by_key = {(p["idLast4"], p["name"]): p["total"] for p in lb.get("top", [])}
    shown = mism = 0
    for sid, tot in expected.items():
        k = (sid[-4:], people[sid])
        if k in by_key:
            shown += 1
            if by_key[k] != tot:
                mism += 1
                print(f"MISMATCH {people[sid]}: expected {tot}, leaderboard {by_key[k]}")
    print(f"Leaderboard: {shown} of the fake players are in the top 20; {mism} total mismatch(es).")
    print("Clean up afterwards: Apps Script editor > clearTestData > Run.")
    return 0 if errors == 0 and mism == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
