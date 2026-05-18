"""
Backend test suite for DressVibe Custom Backgrounds endpoints and
generations integration with custom_background_id.

Scope (per review request):
  1) GET  /api/backgrounds        -> pre-seeded items present
  2) POST /api/backgrounds        -> create new bg
  3) GET  /api/backgrounds        -> new bg included
  4) DELETE /api/backgrounds/{id} -> 200, then 404 on second delete
  5) POST /api/generations        -> with custom_background_id valid + nonexistent
  6) Validation: POST /api/backgrounds without image_base64 -> 422
"""

import os
import sys
import base64
import json
import time
import requests
from typing import Optional

BASE_URL = "https://outfit-gen-11.preview.emergentagent.com/api"
SESSION_TOKEN = "test_session_screen"
USER_ID = "user_demo01"
GARMENT_ID = "g_test_demo01"

HEADERS = {
    "Authorization": f"Bearer {SESSION_TOKEN}",
    "Content-Type": "application/json",
}

# 1x1 transparent PNG, base64 (no data: prefix)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBg"
    "AAAABQABh6FO1AAAAABJRU5ErkJggg=="
)

results = []  # list of dicts {case, pass, info}


def record(case: str, ok: bool, info: str = ""):
    results.append({"case": case, "pass": ok, "info": info})
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {case} :: {info}")


def request(method: str, path: str, **kwargs) -> requests.Response:
    url = f"{BASE_URL}{path}"
    h = dict(HEADERS)
    h.update(kwargs.pop("headers", {}) or {})
    return requests.request(method, url, headers=h, timeout=120, **kwargs)


def case_1_initial_list():
    r = request("GET", "/backgrounds")
    if r.status_code != 200:
        record("1_GET_backgrounds_initial", False, f"status={r.status_code} body={r.text[:300]}")
        return None
    data = r.json()
    if not isinstance(data, list):
        record("1_GET_backgrounds_initial", False, f"non-list response: {data}")
        return None
    by_id = {item.get("id"): item for item in data}
    have_a = "bg_demo01_a" in by_id
    have_b = "bg_demo01_b" in by_id
    name_a_ok = have_a and by_id["bg_demo01_a"].get("name") == "Vetrina natalizia"
    name_b_ok = have_b and by_id["bg_demo01_b"].get("name") == "Borgo medievale"
    img_a_ok = have_a and isinstance(by_id["bg_demo01_a"].get("image_base64"), str) and len(by_id["bg_demo01_a"]["image_base64"]) > 50
    img_b_ok = have_b and isinstance(by_id["bg_demo01_b"].get("image_base64"), str) and len(by_id["bg_demo01_b"]["image_base64"]) > 50
    ok = have_a and have_b and name_a_ok and name_b_ok and img_a_ok and img_b_ok
    # Sort check: created_at desc
    created_ats = [item.get("created_at") for item in data]
    sort_ok = created_ats == sorted(created_ats, reverse=True)
    record(
        "1_GET_backgrounds_initial",
        ok and sort_ok,
        f"count={len(data)} have_a={have_a} have_b={have_b} names_ok={name_a_ok and name_b_ok} "
        f"image_b64_ok={img_a_ok and img_b_ok} sort_desc={sort_ok}",
    )
    return data


def case_2_create():
    body = {"name": "Test BG", "image_base64": TINY_PNG_B64, "description": "test fixture bg"}
    r = request("POST", "/backgrounds", data=json.dumps(body))
    if r.status_code != 200:
        record("2_POST_backgrounds_create", False, f"status={r.status_code} body={r.text[:300]}")
        return None
    doc = r.json()
    bg_id = doc.get("id", "")
    ok = (
        isinstance(bg_id, str)
        and bg_id.startswith("bg_")
        and doc.get("name") == "Test BG"
        and doc.get("user_id") == USER_ID
        and doc.get("image_base64") == TINY_PNG_B64
    )
    record(
        "2_POST_backgrounds_create",
        ok,
        f"id={bg_id} name={doc.get('name')} user_id={doc.get('user_id')}",
    )
    return bg_id


def case_3_list_includes(new_id: str):
    r = request("GET", "/backgrounds")
    if r.status_code != 200:
        record("3_GET_backgrounds_includes_new", False, f"status={r.status_code} body={r.text[:300]}")
        return
    data = r.json()
    found = any(item.get("id") == new_id for item in data)
    record(
        "3_GET_backgrounds_includes_new",
        found,
        f"count={len(data)} new_id={new_id} found={found}",
    )


def case_4_delete(new_id: str):
    r = request("DELETE", f"/backgrounds/{new_id}")
    ok1 = r.status_code == 200 and r.json().get("ok") is True
    record("4a_DELETE_backgrounds_first", ok1, f"status={r.status_code} body={r.text[:200]}")

    # confirm GET no longer returns it
    r2 = request("GET", "/backgrounds")
    listed = [item.get("id") for item in r2.json()] if r2.status_code == 200 else []
    gone = new_id not in listed
    record("4b_GET_confirms_gone", gone, f"listed={listed}")

    # second delete should be 404
    r3 = request("DELETE", f"/backgrounds/{new_id}")
    ok3 = r3.status_code == 404
    record("4c_DELETE_again_404", ok3, f"status={r3.status_code} body={r3.text[:200]}")


def case_5a_generation_with_valid_bg():
    body = {
        "garment_ids": [GARMENT_ID],
        "model_gender": "donna",
        "model_age": "giovane",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
        "shoes": "comoda_fashion",
        "num_variations": 1,
        "custom_background_id": "bg_demo01_a",
    }
    t0 = time.time()
    r = request("POST", "/generations", data=json.dumps(body))
    elapsed = time.time() - t0
    if r.status_code != 200:
        record(
            "5a_POST_generations_valid_custom_bg",
            False,
            f"status={r.status_code} elapsed={elapsed:.1f}s body={r.text[:400]}",
        )
        return
    doc = r.json()
    images = doc.get("images") or []
    img0_ok = len(images) > 0 and isinstance(images[0], str) and len(images[0]) > 100
    params = doc.get("params") or {}
    pres = params.get("custom_background_id") == "bg_demo01_a"
    status = doc.get("status")
    ok = img0_ok and pres and status == "done"
    record(
        "5a_POST_generations_valid_custom_bg",
        ok,
        f"elapsed={elapsed:.1f}s status={status} images={len(images)} "
        f"img0_len={(len(images[0]) if images else 0)} params.custom_background_id={params.get('custom_background_id')}",
    )


def case_5b_generation_with_nonexistent_bg():
    body = {
        "garment_ids": [GARMENT_ID],
        "model_gender": "donna",
        "model_age": "giovane",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
        "shoes": "comoda_fashion",
        "num_variations": 1,
        "custom_background_id": "nonexistent",
    }
    t0 = time.time()
    r = request("POST", "/generations", data=json.dumps(body))
    elapsed = time.time() - t0
    if r.status_code != 200:
        record(
            "5b_POST_generations_nonexistent_custom_bg",
            False,
            f"status={r.status_code} elapsed={elapsed:.1f}s body={r.text[:400]}",
        )
        return
    doc = r.json()
    images = doc.get("images") or []
    img0_ok = len(images) > 0 and isinstance(images[0], str) and len(images[0]) > 100
    params = doc.get("params") or {}
    pres = params.get("custom_background_id") == "nonexistent"
    status = doc.get("status")
    ok = img0_ok and pres and status == "done"
    record(
        "5b_POST_generations_nonexistent_custom_bg",
        ok,
        f"elapsed={elapsed:.1f}s status={status} images={len(images)} "
        f"img0_len={(len(images[0]) if images else 0)} params.custom_background_id={params.get('custom_background_id')}",
    )


def case_6_validation_missing_image():
    body = {"name": "Bad BG"}  # no image_base64
    r = request("POST", "/backgrounds", data=json.dumps(body))
    ok = r.status_code == 422
    record("6_POST_backgrounds_missing_image_422", ok, f"status={r.status_code} body={r.text[:300]}")


def main():
    print(f"Target: {BASE_URL}")
    print(f"Auth: Bearer {SESSION_TOKEN} (user_id={USER_ID})\n")

    case_1_initial_list()
    new_id = case_2_create()
    if new_id:
        case_3_list_includes(new_id)
        case_4_delete(new_id)
    else:
        record("3_GET_backgrounds_includes_new", False, "skipped: create failed")
        record("4a_DELETE_backgrounds_first", False, "skipped: create failed")

    case_5a_generation_with_valid_bg()
    case_5b_generation_with_nonexistent_bg()
    case_6_validation_missing_image()

    print("\n=== Summary ===")
    passed = sum(1 for r in results if r["pass"])
    failed = sum(1 for r in results if not r["pass"])
    for r in results:
        st = "PASS" if r["pass"] else "FAIL"
        print(f"  [{st}] {r['case']}")
    print(f"\nTotal: {passed} passed, {failed} failed (of {len(results)})")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
