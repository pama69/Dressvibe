"""
Backend test suite for the new add_price_tags toggle on POST /api/studio/edit.

Review request cases:
  1) add_price_tags omitted (default false) with valid gen_id → 200 image_base64
  2) add_price_tags=true with mixed real + auto-placeholder garments → 200
  3) add_price_tags=true with ONLY auto-placeholder garments → 200 (empty suffix)
  4) add_price_tags=true but no gen_id → 200 (no suffix injected)
  5) Regression: plain /studio/edit (no new field) → 200

All requests authenticate as user_demo01 via Bearer test_session_screen.
Pass criteria: every call returns HTTP 200 with non-empty image_base64.
"""
import base64
import io
import sys
import time
from typing import Optional

import requests

BASE = "https://outfit-gen-11.preview.emergentagent.com/api"
TOKEN = "test_session_screen"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
TIMEOUT = 180  # each Gemini studio/edit call may take 20-30s

# 1x1 PNG (transparent) — base64
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _log(msg: str):
    print(msg, flush=True)


def _post(path: str, body: dict, timeout: int = TIMEOUT):
    url = f"{BASE}{path}"
    t0 = time.time()
    r = requests.post(url, headers=HEADERS, json=body, timeout=timeout)
    dt = time.time() - t0
    return r, dt


def _get(path: str, timeout: int = 60):
    url = f"{BASE}{path}"
    r = requests.get(url, headers=HEADERS, timeout=timeout)
    return r


def get_seed_image_for_gen(gen_id: str) -> Optional[str]:
    """Return the first non-empty image_base64 from a generation belonging to user_demo01."""
    r = _get(f"/generations")
    if r.status_code != 200:
        _log(f"  list /generations failed: {r.status_code} {r.text[:200]}")
        return None
    gens = r.json()
    for g in gens:
        if g.get("id") == gen_id:
            imgs = g.get("images") or []
            for img in imgs:
                if img:
                    return img
    return None


def find_existing_gen_with_image() -> Optional[dict]:
    r = _get("/generations")
    if r.status_code != 200:
        return None
    gens = r.json()
    # prefer the most recent with an image
    for g in gens:
        imgs = g.get("images") or []
        if any(imgs):
            return g
    return None


def create_garment(name: str) -> Optional[str]:
    body = {"name": name, "image_base64": TINY_PNG_B64, "category": "altro"}
    r, dt = _post("/garments", body, timeout=30)
    if r.status_code != 200:
        _log(f"  create_garment({name}) failed: {r.status_code} {r.text[:200]}")
        return None
    gid = r.json().get("id")
    _log(f"  created garment {gid} name={name!r} ({dt:.1f}s)")
    return gid


def create_generation(garment_ids, num_variations: int = 1) -> Optional[dict]:
    body = {
        "garment_ids": garment_ids,
        "num_variations": num_variations,
        "model_gender": "donna",
        "model_age": "giovane",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
        "shoes": "comoda_fashion",
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/generations", headers=HEADERS, json=body, timeout=TIMEOUT)
    dt = time.time() - t0
    if r.status_code != 200:
        _log(f"  create_generation failed: {r.status_code} {r.text[:300]}")
        return None
    g = r.json()
    _log(
        f"  created gen {g.get('id')} status={g.get('status')} "
        f"images={len(g.get('images') or [])} ({dt:.1f}s)"
    )
    return g


def assert_edit_ok(label: str, body: dict) -> bool:
    _log(f"\n[CASE] {label}")
    _log(f"  POST /studio/edit body keys={list(body.keys())} "
         f"add_price_tags={body.get('add_price_tags')!r} gen_id={body.get('gen_id')!r}")
    try:
        r, dt = _post("/studio/edit", body)
    except requests.exceptions.RequestException as e:
        _log(f"  ✗ Network error: {e}")
        return False
    _log(f"  HTTP {r.status_code} in {dt:.1f}s")
    if r.status_code != 200:
        _log(f"  ✗ Response body: {r.text[:500]}")
        return False
    try:
        j = r.json()
    except Exception as e:
        _log(f"  ✗ Invalid JSON: {e} body={r.text[:200]}")
        return False
    img = j.get("image_base64")
    if not isinstance(img, str) or len(img) < 100:
        _log(f"  ✗ image_base64 missing or too short: type={type(img).__name__} len={len(img) if isinstance(img,str) else 'N/A'}")
        return False
    _log(f"  ✓ image_base64 returned (len={len(img)})")
    return True


def main():
    results = []

    # ---- Setup: create garments + generations ----
    _log("=" * 70)
    _log("SETUP")
    _log("=" * 70)

    real_garment_id = create_garment("Vestito €59")
    cap_garment_id = create_garment("Cap 4521")
    if not real_garment_id or not cap_garment_id:
        _log("Setup failed: cannot create garments")
        sys.exit(1)

    # gen_mixed: both garments — for case 2
    _log("\nCreating gen_mixed (Vestito €59 + Cap 4521)…")
    gen_mixed = create_generation([real_garment_id, cap_garment_id], num_variations=1)
    if not gen_mixed:
        _log("Setup failed: cannot create gen_mixed")
        sys.exit(1)

    # gen_cap_only: just the placeholder — for case 3
    _log("\nCreating gen_cap_only (only Cap 4521)…")
    gen_cap_only = create_generation([cap_garment_id], num_variations=1)
    if not gen_cap_only:
        _log("Setup failed: cannot create gen_cap_only")
        sys.exit(1)

    # Pick images for each
    img_mixed = (gen_mixed.get("images") or [None])[0]
    img_cap_only = (gen_cap_only.get("images") or [None])[0]

    if not img_mixed:
        _log("  gen_mixed has no image; trying to fetch from list…")
        img_mixed = get_seed_image_for_gen(gen_mixed["id"])
    if not img_cap_only:
        _log("  gen_cap_only has no image; trying to fetch from list…")
        img_cap_only = get_seed_image_for_gen(gen_cap_only["id"])

    if not img_mixed or not img_cap_only:
        _log("  ! gen images missing — using tiny PNG fallback so edit endpoint can still run")
        # Fallback to tiny png so we can still exercise the endpoint and verify the code path.
        img_mixed = img_mixed or TINY_PNG_B64
        img_cap_only = img_cap_only or TINY_PNG_B64

    # Also locate / build a generation for case 1 (any user gen) — prefer gen_mixed.
    # Case 1 uses an existing gen + omits add_price_tags entirely.
    gen_for_case1_id = gen_mixed["id"]
    img_for_case1 = img_mixed

    # ---- Case 1: add_price_tags omitted ----
    body1 = {
        "image_base64": img_for_case1,
        "edit_prompt": "Change the background to a beach at golden hour",
        "gen_id": gen_for_case1_id,
        # no add_price_tags
    }
    results.append(("1: add_price_tags omitted", assert_edit_ok("1) add_price_tags omitted (default false)", body1)))

    # ---- Case 2: add_price_tags=true with mixed real + cap garments ----
    body2 = {
        "image_base64": img_mixed,
        "edit_prompt": "Add subtle warm light",
        "gen_id": gen_mixed["id"],
        "add_price_tags": True,
    }
    results.append(("2: add_price_tags=true + real description garment", assert_edit_ok(
        "2) add_price_tags=true with real-description garment (Vestito €59 + Cap 4521)", body2
    )))

    # ---- Case 3: add_price_tags=true with ONLY auto-placeholder ----
    body3 = {
        "image_base64": img_cap_only,
        "edit_prompt": "Make colors slightly more vivid",
        "gen_id": gen_cap_only["id"],
        "add_price_tags": True,
    }
    results.append(("3: add_price_tags=true + only Cap NNNN", assert_edit_ok(
        "3) add_price_tags=true with ONLY auto-placeholder garments (empty suffix)", body3
    )))

    # ---- Case 4: add_price_tags=true but no gen_id ----
    body4 = {
        "image_base64": img_mixed,
        "edit_prompt": "Remove background",
        "add_price_tags": True,
        # no gen_id
    }
    results.append(("4: add_price_tags=true + no gen_id", assert_edit_ok(
        "4) add_price_tags=true but no gen_id (no suffix injected)", body4
    )))

    # ---- Case 5: Regression — plain edit (no new field, no gen_id) ----
    body5 = {
        "image_base64": img_mixed,
        "edit_prompt": "Slightly enhance contrast and sharpness",
    }
    results.append(("5: regression plain edit", assert_edit_ok(
        "5) Regression — plain /studio/edit (no new field, no gen_id)", body5
    )))

    # ---- Summary ----
    _log("\n" + "=" * 70)
    _log("RESULTS")
    _log("=" * 70)
    passed = sum(1 for _, ok in results if ok)
    for name, ok in results:
        _log(f"  {'PASS' if ok else 'FAIL'}  {name}")
    _log(f"\n{passed}/{len(results)} PASS")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
