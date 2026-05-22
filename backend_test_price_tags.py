"""Backend tests for the new 'price tags' feature in POST /api/generations.

Per review request:
1) Garment with auto-placeholder name "Cap 4521" → gen still succeeds.
2) Garment with real description "Vestito €59, pantalone €67" → gen succeeds.
3) Mixed (both) → gen succeeds.
4) Existing demo garment → gen still succeeds (regression).
5) is_real_description helper static checks.
6) Regression GETs.
"""
import os
import sys
import time
import base64
import requests

BASE_URL = "https://outfit-gen-11.preview.emergentagent.com/api"
TOKEN = "test_session_screen"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# A tiny valid 1x1 PNG (transparent) so garment images don't break Gemini
ONE_PX_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
)

# ----- common gen params -----
BASE_GEN = {
    "model_gender": "donna",
    "model_age": "giovane",
    "model_body": "slim",
    "model_ethnicity": "mediterranea",
    "pose": "casual_standing",
    "background": "white_studio",
    "shoes": "comoda_fashion",
    "num_variations": 1,
}

results = []


def log(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def create_garment(name: str) -> str:
    r = requests.post(
        f"{BASE_URL}/garments",
        headers=HEADERS,
        json={
            "name": name,
            "image_base64": ONE_PX_PNG_B64,
            "category": "vestito",
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["id"]


def post_generation(garment_ids):
    payload = dict(BASE_GEN)
    payload["garment_ids"] = garment_ids
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/generations",
        headers=HEADERS,
        json=payload,
        timeout=120,
    )
    dt = time.time() - t0
    return r, dt


def test_static_helper():
    name = "5) is_real_description static asserts"
    try:
        sys.path.insert(0, "/app/backend")
        from server import is_real_description  # type: ignore
        assert is_real_description("Cap 4521") is False
        assert is_real_description("Cap  9999") is False
        assert is_real_description("cap 4521") is False
        assert is_real_description("Vestito €59") is True
        assert is_real_description("Cap A4521") is True
        assert is_real_description("") is False
        assert is_real_description(None) is False
        log(name, True, "all 7 asserts OK")
    except Exception as e:
        log(name, False, f"helper failed: {e}")


def test_regression_gets():
    name = "6) Regression GETs (providers/garments/backgrounds)"
    try:
        for ep in ("/providers", "/garments", "/backgrounds"):
            r = requests.get(f"{BASE_URL}{ep}", headers=HEADERS, timeout=20)
            assert r.status_code == 200, f"{ep} -> {r.status_code}"
        log(name, True, "all 3 endpoints 200")
    except Exception as e:
        log(name, False, str(e))


def get_first_demo_garment():
    r = requests.get(f"{BASE_URL}/garments", headers=HEADERS, timeout=20)
    r.raise_for_status()
    items = r.json()
    # Prefer pre-seeded g_test_demo01 if present, else any non-Cap one
    for it in items:
        if it["id"] == "g_test_demo01":
            return it
    # Else first that's not a price-tag garment we made today
    for it in items:
        if it["name"] not in (
            "Cap 4521",
            "Vestito €59, pantalone €67",
        ):
            return it
    return items[0] if items else None


def main():
    # 5) static helper first (cheap)
    test_static_helper()

    # 6) regression
    test_regression_gets()

    # Setup garments for cases 1-3
    try:
        g_cap_id = create_garment("Cap 4521")
        log("setup: create garment 'Cap 4521'", True, f"id={g_cap_id}")
    except Exception as e:
        log("setup: create garment 'Cap 4521'", False, str(e))
        g_cap_id = None

    try:
        g_real_id = create_garment("Vestito €59, pantalone €67")
        log("setup: create garment 'Vestito €59, pantalone €67'", True, f"id={g_real_id}")
    except Exception as e:
        log("setup: create garment 'Vestito €59, pantalone €67'", False, str(e))
        g_real_id = None

    # 1) Auto-placeholder name
    if g_cap_id:
        name = "1) Gen with 'Cap 4521' (auto-placeholder, NO suffix)"
        try:
            r, dt = post_generation([g_cap_id])
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            ok = (
                r.status_code == 200
                and body.get("status") == "done"
                and len(body.get("images") or []) == 1
            )
            log(name, ok, f"http={r.status_code} status={body.get('status')} imgs={len(body.get('images') or [])} dt={dt:.1f}s")
        except Exception as e:
            log(name, False, str(e))

    # 2) Real description name
    if g_real_id:
        name = "2) Gen with 'Vestito €59, pantalone €67' (suffix INJECTED)"
        try:
            r, dt = post_generation([g_real_id])
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            ok = (
                r.status_code == 200
                and body.get("status") == "done"
                and len(body.get("images") or []) == 1
            )
            log(name, ok, f"http={r.status_code} status={body.get('status')} imgs={len(body.get('images') or [])} dt={dt:.1f}s")
        except Exception as e:
            log(name, False, str(e))

    # 3) Mixed (both)
    if g_cap_id and g_real_id:
        name = "3) Gen with MIXED [real, Cap] garments"
        try:
            r, dt = post_generation([g_real_id, g_cap_id])
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            ok = (
                r.status_code == 200
                and body.get("status") == "done"
                and len(body.get("images") or []) >= 1
            )
            log(name, ok, f"http={r.status_code} status={body.get('status')} imgs={len(body.get('images') or [])} dt={dt:.1f}s")
        except Exception as e:
            log(name, False, str(e))

    # 4) Existing demo garment (regression: no price tags)
    name = "4) Gen with pre-existing demo garment (regression)"
    try:
        demo = get_first_demo_garment()
        if not demo:
            log(name, False, "no existing garment found")
        else:
            r, dt = post_generation([demo["id"]])
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            ok = (
                r.status_code == 200
                and body.get("status") == "done"
                and len(body.get("images") or []) == 1
            )
            log(name, ok, f"garment_id={demo['id']} name={demo.get('name')!r} http={r.status_code} status={body.get('status')} imgs={len(body.get('images') or [])} dt={dt:.1f}s")
    except Exception as e:
        log(name, False, str(e))

    # Final summary
    print("\n========== SUMMARY ==========")
    n_ok = sum(1 for _, ok, _ in results if ok)
    n_tot = len(results)
    print(f"{n_ok}/{n_tot} cases passed")
    for name, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name} :: {detail}")
    sys.exit(0 if n_ok == n_tot else 1)


if __name__ == "__main__":
    main()
