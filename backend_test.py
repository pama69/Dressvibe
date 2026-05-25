"""
Backend test for /api/studio/edit returning new image_index.

Verifies the fix where /api/studio/edit returns:
  {image_base64: <result>, image_index: <int|null>}

The new image_index is computed via find_one_and_update(return_document=AFTER)
which atomically pushes the image+thumb and returns the post-state; index = len(images) - 1.

Auth: Bearer test_session_screen (user_demo01).
"""
import base64
import os
import sys
import time
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")


def _read_frontend_env(key: str) -> str:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""

BASE_URL = _read_frontend_env("EXPO_PUBLIC_BACKEND_URL").rstrip("/") + "/api"
TOKEN = "test_session_screen"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "dressvibe")
mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

results = []
def record(name: str, ok: bool, info: str = ""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {info}")
    results.append((name, ok, info))


PREFERRED_GEN_ID = "gen_d24135486f39"

def find_or_create_gen():
    g = db.generations.find_one(
        {"id": PREFERRED_GEN_ID, "user_id": "user_demo01"},
        {"_id": 0, "id": 1, "images": 1},
    )
    if g and g.get("images"):
        return g["id"], len(g["images"])
    cur = db.generations.find(
        {"user_id": "user_demo01", "images.0": {"$exists": True}},
        {"_id": 0, "id": 1, "images": 1},
    ).sort("created_at", -1).limit(5)
    for g in cur:
        if g.get("images"):
            return g["id"], len(g["images"])
    return None, 0

GEN_ID, N_BEFORE = find_or_create_gen()
print(f"[setup] using gen_id={GEN_ID} with images.length={N_BEFORE}")


def case1():
    if not GEN_ID:
        record("case1_setup", False, "No suitable gen_id found for user_demo01")
        return None, None, None

    r = requests.get(f"{BASE_URL}/generations/{GEN_ID}", headers=HEADERS, timeout=60)
    if r.status_code != 200:
        record("case1_get_before", False, f"status={r.status_code} body={r.text[:200]}")
        return None, None, None
    gen = r.json()
    images = gen.get("images") or []
    N = len(images)
    if N == 0:
        record("case1_setup", False, "gen has 0 images")
        return None, None, None
    record("case1_get_before", True, f"images.length={N}")

    body = {
        "image_base64": images[0],
        "edit_prompt": "Subtle warm tone",
        "gen_id": GEN_ID,
        "add_price_tags": False,
    }
    t0 = time.time()
    try:
        r = requests.post(f"{BASE_URL}/studio/edit", headers=HEADERS, json=body, timeout=120)
    except Exception as e:
        record("case1_studio_edit", False, f"exception: {e}")
        return None, None, None
    elapsed = time.time() - t0
    if r.status_code != 200:
        if r.status_code in (429, 502, 503):
            print(f"[case1] retry once after {r.status_code}: {r.text[:200]}")
            time.sleep(8)
            r = requests.post(f"{BASE_URL}/studio/edit", headers=HEADERS, json=body, timeout=120)
        if r.status_code != 200:
            record("case1_studio_edit", False, f"status={r.status_code} body={r.text[:200]} (elapsed={elapsed:.1f}s)")
            return None, None, None

    js = r.json()
    edited_b64 = js.get("image_base64")
    new_index = js.get("image_index")
    if not edited_b64 or not isinstance(edited_b64, str):
        record("case1_studio_edit_has_image", False, "image_base64 missing/empty")
        return None, None, None
    record("case1_studio_edit_has_image", True, f"len={len(edited_b64)} elapsed={elapsed:.1f}s")

    if new_index != N:
        record("case1_image_index_equals_N", False, f"got {new_index}, expected {N}")
        return None, None, None
    record("case1_image_index_equals_N", True, f"image_index={new_index} == N={N}")

    r2 = requests.get(f"{BASE_URL}/generations/{GEN_ID}", headers=HEADERS, timeout=60)
    if r2.status_code != 200:
        record("case1_get_after", False, f"status={r2.status_code}")
        return None, None, None
    gen2 = r2.json()
    images2 = gen2.get("images") or []
    if len(images2) != N + 1:
        record("case1_get_after_length", False, f"got {len(images2)}, expected {N+1}")
        return None, None, None
    record("case1_get_after_length", True, f"images.length={len(images2)}")

    if images2[N] != edited_b64:
        record("case1_images_N_matches", False, f"images[{N}] differs from returned image_base64 (lens {len(images2[N])} vs {len(edited_b64)})")
        return None, None, None
    record("case1_images_N_matches", True, f"images[{N}] == returned image_base64 ({len(edited_b64)} chars)")

    return GEN_ID, new_index, edited_b64


def case2():
    # 1x1 transparent PNG
    tiny_png = base64.b64encode(bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
        "890000000A49444154789C6300010000000500010D0A2DB40000000049454E44"
        "AE426082"
    )).decode("ascii")
    body = {
        "image_base64": tiny_png,
        "edit_prompt": "Make it brighter",
        "add_price_tags": False,
    }
    t0 = time.time()
    try:
        r = requests.post(f"{BASE_URL}/studio/edit", headers=HEADERS, json=body, timeout=120)
    except Exception as e:
        record("case2_studio_edit", False, f"exception: {e}")
        return
    elapsed = time.time() - t0
    if r.status_code != 200:
        if r.status_code in (429, 502, 503):
            print(f"[case2] retry once after {r.status_code}: {r.text[:200]}")
            time.sleep(8)
            r = requests.post(f"{BASE_URL}/studio/edit", headers=HEADERS, json=body, timeout=120)
        if r.status_code != 200:
            record("case2_studio_edit", False, f"status={r.status_code} body={r.text[:200]} (elapsed={elapsed:.1f}s)")
            return
    js = r.json()
    if not js.get("image_base64"):
        record("case2_has_image_base64", False, "image_base64 missing/empty")
        return
    record("case2_has_image_base64", True, f"len={len(js['image_base64'])} elapsed={elapsed:.1f}s")

    val = js.get("image_index")
    if val is not None:
        record("case2_image_index_is_null", False, f"image_index={val!r} (expected null)")
        return
    record("case2_image_index_is_null", True, f"image_index field present={'image_index' in js}, value=null")


def ensure_telegram_channel():
    # Read current setting
    r = requests.get(f"{BASE_URL}/user-settings", headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return None
    prev = (r.json() or {}).get("telegram_channel") or ""
    if not prev:
        # set to a test channel — value isn't actually used for short_link minting,
        # but the strict-channel guard requires non-empty.
        rp = requests.put(
            f"{BASE_URL}/user-settings",
            headers=HEADERS,
            json={"telegram_channel": "@frammenti_pe"},
            timeout=30,
        )
        print(f"[setup] set telegram_channel @frammenti_pe -> {rp.status_code}")
    else:
        print(f"[setup] telegram_channel already set to {prev!r}")
    return prev


def case3():
    if not GEN_ID:
        record("case3", False, "no gen_id")
        return None, None, None

    ensure_telegram_channel()

    r0 = requests.get(f"{BASE_URL}/generations/{GEN_ID}", headers=HEADERS, timeout=60)
    if r0.status_code != 200:
        record("case3_get_before", False, f"status={r0.status_code}")
        return None, None, None
    images0 = r0.json().get("images") or []
    N = len(images0)
    if N == 0:
        record("case3_setup", False, "no images in gen")
        return None, None, None
    record("case3_get_before", True, f"images.length={N}")

    body = {
        "image_base64": images0[0],
        "edit_prompt": "Slightly enhance contrast",
        "gen_id": GEN_ID,
        "add_price_tags": False,
    }
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/studio/edit", headers=HEADERS, json=body, timeout=120)
    elapsed = time.time() - t0
    if r.status_code != 200:
        if r.status_code in (429, 502, 503):
            print(f"[case3] retry once after {r.status_code}")
            time.sleep(8)
            r = requests.post(f"{BASE_URL}/studio/edit", headers=HEADERS, json=body, timeout=120)
        if r.status_code != 200:
            record("case3_studio_edit", False, f"status={r.status_code} body={r.text[:200]}")
            return None, None, None
    js = r.json()
    edited_b64 = js["image_base64"]
    new_index = js["image_index"]
    if new_index != N:
        record("case3_image_index", False, f"got {new_index}, expected {N}")
        return None, None, None
    record("case3_studio_edit", True, f"new_index={new_index} elapsed={elapsed:.1f}s")

    pub_body = {
        "image_base64": edited_b64,
        "media_type": "photo",
        "caption": "Test fix studio_edit image_index",
        "gen_id": GEN_ID,
        "image_index": new_index,
    }
    rp = requests.post(f"{BASE_URL}/telegram/publish", headers=HEADERS, json=pub_body, timeout=120)
    record("case3_publish_response", rp.status_code == 200, f"status={rp.status_code} body={rp.text[:200]}")

    sl = db.short_links.find_one({"gen_id": GEN_ID, "image_index": new_index})
    if not sl:
        record("case3_short_link_exists", False, f"no short_link row for gen_id={GEN_ID} idx={new_index}")
        return None, None, None
    short_id = sl.get("short_id")
    if not short_id:
        record("case3_short_link_exists", False, f"short_link row exists but missing short_id: {sl}")
        return None, None, None
    record("case3_short_link_exists", True, f"short_id={short_id}")

    return short_id, new_index, edited_b64


def case4(short_id, new_index, edited_b64):
    if not short_id:
        record("case4", False, "no short_id from case3")
        return
    r = requests.get(f"{BASE_URL}/r/{short_id}/image", timeout=60)
    if r.status_code != 200:
        record("case4_get_image", False, f"status={r.status_code} body={r.text[:200]}")
        return
    record("case4_get_image", True, f"status=200 ctype={r.headers.get('content-type')} len={len(r.content)}")

    try:
        expected_raw = base64.b64decode(edited_b64)
    except Exception as e:
        record("case4_decode_edited", False, f"could not b64decode edited image: {e}")
        return
    if len(r.content) != len(expected_raw):
        record("case4_length_match", False, f"got {len(r.content)} bytes, expected {len(expected_raw)} bytes")
        return
    record("case4_length_match", True, f"raw size={len(r.content)} bytes")

    if r.content[:100] != expected_raw[:100]:
        record("case4_prefix_match", False, "first 100 bytes differ")
        return
    record("case4_prefix_match", True, "first 100 bytes match")

    if r.content != expected_raw:
        record("case4_full_match", False, "full byte buffers differ")
        return
    record("case4_full_match", True, "full byte-for-byte match — landing serves the EDITED image")


def case5():
    r1 = requests.get(f"{BASE_URL}/generations", headers=HEADERS, timeout=30)
    record("case5_generations", r1.status_code == 200, f"status={r1.status_code} count={len(r1.json()) if r1.status_code==200 else 'n/a'}")
    r2 = requests.get(f"{BASE_URL}/garments", headers=HEADERS, timeout=30)
    record("case5_garments", r2.status_code == 200, f"status={r2.status_code} count={len(r2.json()) if r2.status_code==200 else 'n/a'}")


print(f"\n=== Testing studio/edit image_index fix at {BASE_URL} ===\n")
case1_out = case1()
print()
case2()
print()
case3_out = case3()
print()
if case3_out and case3_out[0]:
    case4(*case3_out)
else:
    print("[case4] skipped (case3 failed)")
print()
case5()

print("\n=== SUMMARY ===")
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"{passed}/{total} PASS")
for name, ok, info in results:
    flag = "[PASS]" if ok else "[FAIL]"
    print(f"  {flag} {name}")
sys.exit(0 if passed == total else 1)
