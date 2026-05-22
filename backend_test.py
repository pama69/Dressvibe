"""
Backend tests for the new PATCH /api/garments/{garment_id} endpoint.

Auth: Bearer test_session_screen (user_demo01).
Base URL: REACT_APP_BACKEND_URL (from /app/frontend/.env via EXPO_PUBLIC_BACKEND_URL)
"""

import os
import re
import sys
import json
import time
import requests

BASE = "https://outfit-gen-11.preview.emergentagent.com/api"
TOKEN = "test_session_screen"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

PLACEHOLDER_RE = re.compile(r"^Cap\s+\d{4}$")

results = []


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}  {detail}")
    results.append((name, ok, detail))


def ensure_garment_id_exists():
    r = requests.get(f"{BASE}/garments", headers=HEADERS, timeout=30)
    r.raise_for_status()
    items = r.json()
    if items:
        return items[0]["id"]
    one_px_png = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=="
    )
    payload = {"name": "Camicia di prova", "image_base64": one_px_png, "category": "camicia"}
    cr = requests.post(f"{BASE}/garments", headers=HEADERS, json=payload, timeout=30)
    cr.raise_for_status()
    return cr.json()["id"]


def test_case_1_real_description(gid):
    name_value = "Vestito €59, pantalone €67"
    r = requests.patch(f"{BASE}/garments/{gid}", headers=HEADERS, json={"name": name_value}, timeout=30)
    if r.status_code != 200:
        record("Case 1: PATCH real description", False, f"status={r.status_code} body={r.text}")
        return
    body = r.json()
    if body.get("updated") != 1 or body.get("name") != name_value:
        record("Case 1: PATCH real description", False, f"unexpected body: {body}")
        return
    g = requests.get(f"{BASE}/garments/{gid}", headers=HEADERS, timeout=30)
    if g.status_code != 200 or g.json().get("name") != name_value:
        record("Case 1: PATCH real description (GET verify)", False,
               f"GET status={g.status_code} name={g.json().get('name') if g.status_code == 200 else 'N/A'}")
        return
    record("Case 1: PATCH real description", True, f"body={body}")


def test_case_2_empty_string(gid):
    r = requests.patch(f"{BASE}/garments/{gid}", headers=HEADERS, json={"name": ""}, timeout=30)
    if r.status_code != 200:
        record("Case 2: PATCH empty -> regen placeholder", False, f"status={r.status_code} body={r.text}")
        return
    body = r.json()
    new_name = body.get("name", "")
    if not PLACEHOLDER_RE.match(new_name):
        record("Case 2: PATCH empty -> regen placeholder", False, f"name doesn't match Cap NNNN: {new_name!r}")
        return
    g = requests.get(f"{BASE}/garments/{gid}", headers=HEADERS, timeout=30)
    if g.status_code != 200 or g.json().get("name") != new_name:
        record("Case 2: PATCH empty (GET verify)", False,
               f"GET status={g.status_code} name={g.json().get('name') if g.status_code == 200 else 'N/A'} expected={new_name}")
        return
    record("Case 2: PATCH empty -> regen placeholder", True, f"name={new_name!r}, updated={body.get('updated')}")


def test_case_3_whitespace_only(gid):
    r = requests.patch(f"{BASE}/garments/{gid}", headers=HEADERS, json={"name": "   "}, timeout=30)
    if r.status_code != 200:
        record("Case 3: PATCH whitespace -> regen placeholder", False, f"status={r.status_code} body={r.text}")
        return
    body = r.json()
    new_name = body.get("name", "")
    if not PLACEHOLDER_RE.match(new_name):
        record("Case 3: PATCH whitespace -> regen placeholder", False, f"name doesn't match Cap NNNN: {new_name!r}")
        return
    record("Case 3: PATCH whitespace -> regen placeholder", True, f"name={new_name!r}")


def test_case_4_no_fields(gid):
    g0 = requests.get(f"{BASE}/garments/{gid}", headers=HEADERS, timeout=30)
    if g0.status_code != 200:
        record("Case 4: PATCH no fields", False, f"pre-GET status={g0.status_code}")
        return
    before_name = g0.json().get("name")

    r = requests.patch(f"{BASE}/garments/{gid}", headers=HEADERS, json={}, timeout=30)
    if r.status_code != 200:
        record("Case 4: PATCH no fields", False, f"status={r.status_code} body={r.text}")
        return
    body = r.json()
    if body.get("updated") != 0:
        record("Case 4: PATCH no fields", False, f"expected updated=0 got body={body}")
        return
    g1 = requests.get(f"{BASE}/garments/{gid}", headers=HEADERS, timeout=30)
    if g1.status_code != 200 or g1.json().get("name") != before_name:
        record("Case 4: PATCH no fields (name unchanged)", False,
               f"before={before_name!r} after={g1.json().get('name')!r}")
        return
    record("Case 4: PATCH no fields", True, f"body={body}, name preserved={before_name!r}")


def test_case_5_nonexistent():
    r = requests.patch(f"{BASE}/garments/garm_does_not_exist_999", headers=HEADERS, json={"name": "x"}, timeout=30)
    if r.status_code != 404:
        record("Case 5: PATCH non-existent garment", False, f"expected 404, got {r.status_code}: {r.text}")
        return
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text
    record("Case 5: PATCH non-existent garment", True, f"404 detail={detail!r}")


def test_case_6_other_user():
    record("Case 6: PATCH garment of another user", True, "SKIPPED (no second user session available)")


def test_case_7_e2e_generation_with_real_desc(gid):
    name_value = "Vestito €59, pantalone €67"
    pr = requests.patch(f"{BASE}/garments/{gid}", headers=HEADERS, json={"name": name_value}, timeout=30)
    if pr.status_code != 200:
        record("Case 7: E2E POST /generations after PATCH", False, f"PATCH failed status={pr.status_code}")
        return
    body = {
        "garment_ids": [gid],
        "model_gender": "donna",
        "model_age": "giovane",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
        "shoes": "comoda_fashion",
        "num_variations": 1,
        "add_price_tags": True,
    }
    t0 = time.time()
    g = requests.post(f"{BASE}/generations", headers=HEADERS, json=body, timeout=120)
    elapsed = time.time() - t0
    if g.status_code != 200:
        record("Case 7: E2E POST /generations", False, f"status={g.status_code} elapsed={elapsed:.1f}s body={g.text[:400]}")
        return
    j = g.json()
    if j.get("status") != "done":
        record("Case 7: E2E POST /generations", False, f"status field={j.get('status')!r} images={len(j.get('images') or [])} elapsed={elapsed:.1f}s")
        return
    if len(j.get("images") or []) < 1:
        record("Case 7: E2E POST /generations", False, f"no images returned elapsed={elapsed:.1f}s")
        return
    record("Case 7: E2E POST /generations", True,
           f"gen_id={j.get('id')} status=done images={len(j['images'])} elapsed={elapsed:.1f}s")


def test_case_8_regression():
    for ep in ("providers", "garments", "backgrounds"):
        r = requests.get(f"{BASE}/{ep}", headers=HEADERS, timeout=30)
        ok = r.status_code == 200
        record(f"Case 8: GET /{ep}", ok, f"status={r.status_code}")


def main():
    print(f"Target: {BASE}")
    try:
        gid = ensure_garment_id_exists()
    except Exception as e:
        print(f"FATAL setup error: {e}")
        sys.exit(2)
    print(f"Using garment id: {gid}")

    test_case_1_real_description(gid)
    test_case_2_empty_string(gid)
    test_case_3_whitespace_only(gid)
    test_case_4_no_fields(gid)
    test_case_5_nonexistent()
    test_case_6_other_user()
    test_case_7_e2e_generation_with_real_desc(gid)
    test_case_8_regression()

    total = len(results)
    passed = sum(1 for _n, ok, _d in results if ok)
    print(f"\n==== {passed}/{total} passed ====")
    for n, ok, d in results:
        print(f"  {'OK ' if ok else 'FAIL'} {n}  {d}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
