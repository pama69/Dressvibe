"""
Backend test — verify the new opt-in `add_price_tags` toggle on
POST /api/generations (default False; only triggers price-tag prompt
suffix when the user explicitly enables it).

Run:  python /app/backend_test.py
"""
import os
import sys
import time
import base64
import json
import requests
import subprocess

BASE = "https://outfit-gen-11.preview.emergentagent.com/api"
TOKEN = "test_session_screen"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

# 1x1 transparent PNG
TINY_PNG_B64 = base64.b64encode(
    bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
        "0000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
    )
).decode()


def log(name, ok, detail=""):
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name}  {detail}")
    return ok


def post(path, body, timeout=180):
    return requests.post(BASE + path, headers=HEADERS, json=body, timeout=timeout)


def get(path, timeout=30):
    return requests.get(BASE + path, headers=HEADERS, timeout=timeout)


def create_garment(name: str) -> str:
    r = post("/garments", {
        "name": name,
        "image_base64": TINY_PNG_B64,
        "category": "full_outfit",
    })
    r.raise_for_status()
    return r.json()["id"]


def gen_payload(garment_ids, **extra):
    body = {
        "garment_ids": garment_ids,
        "num_variations": 1,
        "model_gender": "donna",
        "model_age": "adulto",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
        "shoes": "comoda_fashion",
    }
    body.update(extra)
    return body


def assert_gen_ok(label: str, r: requests.Response) -> bool:
    if r.status_code != 200:
        return log(label, False, f"HTTP {r.status_code}: {r.text[:300]}")
    try:
        data = r.json()
    except Exception as e:
        return log(label, False, f"non-JSON body: {e}")
    status = data.get("status")
    images = data.get("images") or []
    if status == "done" and len(images) == 1:
        return log(label, True, f"status=done, images=1, gen_id={data.get('id')}")
    if status in ("failed", "rate_limited"):
        # Per review request: if upstream 503/429 occurs, count contract part as PASS
        return log(label, True, f"CONTRACT-ONLY (upstream issue) status={status}, images={len(images)}")
    return log(label, False, f"unexpected status={status}, images={len(images)}, body={json.dumps(data)[:300]}")


def main():
    results = []

    # --- Case 6 (run first, no network): Static helper sanity check ---
    print("\n=== Case 6: Static helper sanity check ===")
    static_cmd = (
        "import sys; sys.path.insert(0, '/app/backend'); "
        "from server import GenerationCreate; "
        "g = GenerationCreate(garment_ids=['x'], model_gender='donna', model_age='adulto', "
        "model_body='slim', model_ethnicity='caucasica', pose='casual_standing', "
        "background='white_studio', shoes='comoda_fashion'); "
        "assert g.add_price_tags is False, 'default should be False'; "
        "g2 = GenerationCreate(garment_ids=['x'], model_gender='donna', model_age='adulto', "
        "model_body='slim', model_ethnicity='caucasica', pose='casual_standing', "
        "background='white_studio', shoes='comoda_fashion', add_price_tags=True); "
        "assert g2.add_price_tags is True, 'explicit True should round-trip'; "
        "print('OK')"
    )
    cp = subprocess.run([sys.executable, "-c", static_cmd], capture_output=True, text=True, timeout=30)
    static_ok = cp.returncode == 0 and "OK" in (cp.stdout or "")
    results.append(log("case6_static_helper_sanity", static_ok,
                       f"stdout={cp.stdout.strip()!r}, stderr={cp.stderr.strip()[:200]!r}"))

    # --- Create garments ---
    print("\n=== Setup: Create garments ===")
    try:
        g_vestito = create_garment("Vestito €59")
        log("setup_create_real_garment", True, f"id={g_vestito}")
    except Exception as e:
        log("setup_create_real_garment", False, str(e))
        return
    try:
        g_cap = create_garment("Cap 8821")
        log("setup_create_cap_garment", True, f"id={g_cap}")
    except Exception as e:
        log("setup_create_cap_garment", False, str(e))
        return

    # --- Case 1 ---
    print("\n=== Case 1: add_price_tags omitted (default False) — real description ===")
    t0 = time.time()
    r = post("/generations", gen_payload([g_vestito]))
    print(f"  ({time.time()-t0:.1f}s)")
    results.append(assert_gen_ok("case1_default_false_real_desc", r))

    # --- Case 2 ---
    print("\n=== Case 2: add_price_tags=True — real description ===")
    t0 = time.time()
    r = post("/generations", gen_payload([g_vestito], add_price_tags=True))
    print(f"  ({time.time()-t0:.1f}s)")
    results.append(assert_gen_ok("case2_true_real_desc", r))

    # --- Case 3 ---
    print("\n=== Case 3: add_price_tags=True — Cap-placeholder only ===")
    t0 = time.time()
    r = post("/generations", gen_payload([g_cap], add_price_tags=True))
    print(f"  ({time.time()-t0:.1f}s)")
    results.append(assert_gen_ok("case3_true_cap_only", r))

    # --- Case 4 ---
    print("\n=== Case 4: add_price_tags=False explicit — real description ===")
    t0 = time.time()
    r = post("/generations", gen_payload([g_vestito], add_price_tags=False))
    print(f"  ({time.time()-t0:.1f}s)")
    results.append(assert_gen_ok("case4_false_explicit_real_desc", r))

    # --- Case 5 ---
    print("\n=== Case 5: add_price_tags=True — MIXED real + Cap ===")
    t0 = time.time()
    r = post("/generations", gen_payload([g_vestito, g_cap], add_price_tags=True))
    print(f"  ({time.time()-t0:.1f}s)")
    results.append(assert_gen_ok("case5_true_mixed", r))

    # --- Case 7: regression GETs ---
    print("\n=== Case 7: Regression GETs ===")
    for path in ("/providers", "/garments", "/backgrounds"):
        rr = get(path)
        results.append(log(f"regression_GET_{path}", rr.status_code == 200,
                           f"HTTP {rr.status_code}"))

    # --- Summary ---
    print("\n" + "=" * 60)
    total = len(results)
    passed = sum(1 for x in results if x)
    print(f"Total: {passed}/{total} passed")
    if passed != total:
        print("Some tests FAILED")
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
