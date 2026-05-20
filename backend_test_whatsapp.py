"""Backend tests for WhatsApp / Richiesta Info feature in /app/backend/server.py.

Targets the LOCAL backend at http://localhost:8001 per review request.
Session: Bearer test_session_screen (user_demo01).
"""
import json
import sys
import time

import requests

BASE = "http://localhost:8001/api"
AUTH = {"Authorization": "Bearer test_session_screen"}

passed = []
failed = []


def case(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    line = f"[{tag}] {name}"
    if detail:
        line += f" — {detail}"
    print(line)
    (passed if ok else failed).append(name)
    return ok


def main():
    # ===========================================================
    # 1. Settings round-trip for whatsapp_channel_url
    # ===========================================================
    print("\n=== 1. User settings: whatsapp_channel_url ===")
    r = requests.get(f"{BASE}/user-settings", headers=AUTH, timeout=10)
    case(
        "1a GET /user-settings (200, key present)",
        r.status_code == 200 and "whatsapp_channel_url" in r.json(),
        f"status={r.status_code} body_keys={list(r.json().keys()) if r.status_code == 200 else r.text[:120]}",
    )

    # Set full URL
    r = requests.put(
        f"{BASE}/user-settings",
        headers=AUTH,
        json={"whatsapp_channel_url": "https://whatsapp.com/channel/0029VaTest123"},
        timeout=10,
    )
    body = r.json() if r.status_code == 200 else {}
    case(
        "1b PUT /user-settings full URL → normalized stored",
        r.status_code == 200
        and body.get("whatsapp_channel_url") == "https://whatsapp.com/channel/0029VaTest123",
        f"status={r.status_code} val={body.get('whatsapp_channel_url')}",
    )

    # Set just the channel code
    r = requests.put(
        f"{BASE}/user-settings",
        headers=AUTH,
        json={"whatsapp_channel_url": "0029VaXYZ"},
        timeout=10,
    )
    body = r.json() if r.status_code == 200 else {}
    case(
        "1c PUT /user-settings bare code → normalized to canonical URL",
        r.status_code == 200
        and body.get("whatsapp_channel_url") == "https://whatsapp.com/channel/0029VaXYZ",
        f"status={r.status_code} val={body.get('whatsapp_channel_url')}",
    )

    # Clear with ""
    r = requests.put(
        f"{BASE}/user-settings",
        headers=AUTH,
        json={"whatsapp_channel_url": ""},
        timeout=10,
    )
    body = r.json() if r.status_code == 200 else {}
    case(
        "1d PUT /user-settings empty string → cleared",
        r.status_code == 200 and body.get("whatsapp_channel_url") == "",
        f"status={r.status_code} val={body.get('whatsapp_channel_url')!r}",
    )

    # Re-set and confirm via GET
    requests.put(
        f"{BASE}/user-settings",
        headers=AUTH,
        json={"whatsapp_channel_url": "https://whatsapp.com/channel/0029VaPersist01"},
        timeout=10,
    )
    r = requests.get(f"{BASE}/user-settings", headers=AUTH, timeout=10)
    body = r.json() if r.status_code == 200 else {}
    case(
        "1e GET /user-settings persisted last write",
        r.status_code == 200
        and body.get("whatsapp_channel_url") == "https://whatsapp.com/channel/0029VaPersist01",
        f"val={body.get('whatsapp_channel_url')}",
    )

    # ===========================================================
    # 2. Short link creation (idempotent)
    # ===========================================================
    print("\n=== 2. Short link creation ===")
    # Pick a real gen with at least 1 image
    r = requests.get(f"{BASE}/generations", headers=AUTH, timeout=10)
    if r.status_code != 200:
        print("FATAL: cannot list generations")
        sys.exit(1)
    gens = r.json()
    target_gen = next((g for g in gens if (g.get("image_count") or 0) >= 1), None)
    if not target_gen:
        print("FATAL: no generation with images for user_demo01")
        sys.exit(1)
    gen_id = target_gen["id"]
    print(f"  using gen_id={gen_id} (image_count={target_gen.get('image_count')})")

    look_name = "Giubbotto Blu Navy"
    r = requests.post(
        f"{BASE}/short-links",
        headers=AUTH,
        json={"gen_id": gen_id, "image_index": 0, "look_name": look_name},
        timeout=15,
    )
    body = r.json() if r.status_code == 200 else {}
    short_id = body.get("short_id", "")
    case(
        "2a POST /short-links → 200 with 6-char short_id, look_name, public_url",
        r.status_code == 200
        and isinstance(short_id, str)
        and len(short_id) == 6
        and body.get("look_name") == look_name
        and isinstance(body.get("public_url"), str)
        and f"/api/r/{short_id}" in body.get("public_url", ""),
        f"status={r.status_code} short_id={short_id} public_url={body.get('public_url')}",
    )

    # Idempotency: same gen_id + image_index → same short_id
    r2 = requests.post(
        f"{BASE}/short-links",
        headers=AUTH,
        json={"gen_id": gen_id, "image_index": 0, "look_name": "Different Name Ignored"},
        timeout=10,
    )
    body2 = r2.json() if r2.status_code == 200 else {}
    case(
        "2b POST /short-links same (gen_id, image_index) → idempotent (same short_id)",
        r2.status_code == 200 and body2.get("short_id") == short_id,
        f"first={short_id} second={body2.get('short_id')}",
    )

    # 404 for non-existent gen
    r = requests.post(
        f"{BASE}/short-links",
        headers=AUTH,
        json={"gen_id": "does-not-exist", "image_index": 0, "look_name": "x"},
        timeout=10,
    )
    case(
        "2c POST /short-links unknown gen_id → 404",
        r.status_code == 404,
        f"status={r.status_code} body={r.text[:120]}",
    )

    # 400 for out-of-range image_index
    r = requests.post(
        f"{BASE}/short-links",
        headers=AUTH,
        json={"gen_id": gen_id, "image_index": 999, "look_name": "x"},
        timeout=10,
    )
    case(
        "2d POST /short-links image_index=999 → 400",
        r.status_code == 400,
        f"status={r.status_code} body={r.text[:120]}",
    )

    # ===========================================================
    # 3. Public landing page (no auth)
    # ===========================================================
    print("\n=== 3. Public landing page (no auth) ===")
    r = requests.get(f"{BASE}/r/{short_id}", timeout=10)
    ct = r.headers.get("content-type", "")
    body_txt = r.text
    case(
        "3a GET /r/{short_id} → 200 HTML, contains look_name + img src to /api/r/{id}/image",
        r.status_code == 200
        and "text/html" in ct
        and look_name in body_txt
        and f"/api/r/{short_id}/image" in body_txt
        and "<img" in body_txt,
        f"status={r.status_code} ct={ct} look_name_in={'Giubbotto' in body_txt} img_in={'<img' in body_txt}",
    )

    r = requests.get(f"{BASE}/r/doesnotexist", timeout=10)
    case(
        "3b GET /r/doesnotexist → 404 with HTML body",
        r.status_code == 404 and ("Link non valido" in r.text or "<html" in r.text.lower()),
        f"status={r.status_code} len_body={len(r.text)}",
    )

    r = requests.get(f"{BASE}/r/{short_id}/image", timeout=15)
    ct = r.headers.get("content-type", "")
    case(
        "3c GET /r/{short_id}/image (no auth) → 200 image/png, >100 bytes",
        r.status_code == 200 and "image/png" in ct and len(r.content) > 100,
        f"status={r.status_code} ct={ct} bytes={len(r.content)}",
    )

    r = requests.get(f"{BASE}/r/badid/image", timeout=10)
    case(
        "3d GET /r/badid/image → 404",
        r.status_code == 404,
        f"status={r.status_code}",
    )

    # ===========================================================
    # 4. Submit info request (public, no auth)
    # ===========================================================
    print("\n=== 4. Public info-request submission ===")
    r = requests.post(
        f"{BASE}/r/{short_id}/info-request",
        json={
            "customer_name": "Maria Rossi",
            "phone": "+39 333 1234567",
            "message": "Vorrei sapere prezzo e taglie",
        },
        timeout=10,
    )
    body = r.json() if r.status_code == 200 else {}
    case(
        "4a POST /r/{id}/info-request valid → 200 {ok:true}",
        r.status_code == 200 and body.get("ok") is True,
        f"status={r.status_code} body={r.text[:160]}",
    )

    r = requests.post(f"{BASE}/r/{short_id}/info-request", json={}, timeout=10)
    case(
        "4b POST /r/{id}/info-request all-empty → 400",
        r.status_code == 400,
        f"status={r.status_code} body={r.text[:160]}",
    )

    r = requests.post(f"{BASE}/r/badid/info-request", json={"customer_name": "x"}, timeout=10)
    case(
        "4c POST /r/badid/info-request → 404",
        r.status_code == 404,
        f"status={r.status_code}",
    )

    # ===========================================================
    # 5. Owner-side info requests
    # ===========================================================
    print("\n=== 5. Owner info-requests management ===")
    r = requests.get(f"{BASE}/info-requests", headers=AUTH, timeout=10)
    items = r.json() if r.status_code == 200 else []
    # Find our just-created one
    mine = [
        it
        for it in items
        if it.get("short_id") == short_id
        and it.get("customer_name") == "Maria Rossi"
    ]
    target_req = mine[0] if mine else None
    case(
        "5a GET /info-requests lists Maria Rossi request with source=whatsapp, status=new",
        r.status_code == 200
        and target_req is not None
        and target_req.get("source") == "whatsapp"
        and target_req.get("status") == "new",
        f"status={r.status_code} count={len(items)} found_target={target_req is not None}",
    )

    r = requests.get(f"{BASE}/info-requests/unread-count", headers=AUTH, timeout=10)
    body = r.json() if r.status_code == 200 else {}
    initial_unread = body.get("count", -1)
    case(
        "5b GET /info-requests/unread-count → 200, count >= 1",
        r.status_code == 200 and initial_unread >= 1,
        f"status={r.status_code} count={initial_unread}",
    )

    if target_req:
        req_id = target_req["id"]
        r = requests.post(f"{BASE}/info-requests/{req_id}/read", headers=AUTH, timeout=10)
        body = r.json() if r.status_code == 200 else {}
        case(
            "5c POST /info-requests/{id}/read → 200",
            r.status_code == 200 and body.get("ok") is True,
            f"status={r.status_code}",
        )

        r = requests.get(f"{BASE}/info-requests/unread-count", headers=AUTH, timeout=10)
        new_count = r.json().get("count", -1) if r.status_code == 200 else -1
        case(
            "5d unread-count decreased by 1 after read",
            r.status_code == 200 and new_count == initial_unread - 1,
            f"before={initial_unread} after={new_count}",
        )

        r = requests.post(f"{BASE}/info-requests/mark-all-read", headers=AUTH, timeout=10)
        body = r.json() if r.status_code == 200 else {}
        case(
            "5e POST /info-requests/mark-all-read → 200 with updated >= 0",
            r.status_code == 200
            and body.get("ok") is True
            and isinstance(body.get("updated"), int)
            and body.get("updated") >= 0,
            f"status={r.status_code} updated={body.get('updated')}",
        )

        r = requests.delete(f"{BASE}/info-requests/{req_id}", headers=AUTH, timeout=10)
        case(
            "5f DELETE /info-requests/{id} → 200",
            r.status_code == 200,
            f"status={r.status_code}",
        )

        r = requests.delete(f"{BASE}/info-requests/{req_id}", headers=AUTH, timeout=10)
        case(
            "5g DELETE same id again → 404",
            r.status_code == 404,
            f"status={r.status_code}",
        )
    else:
        case("5c-g skipped: no target_req found", False, "")

    # ===========================================================
    # 6. Security / isolation sanity
    # ===========================================================
    print("\n=== 6. Security / isolation ===")
    r = requests.get(f"{BASE}/info-requests", timeout=10)
    case(
        "6a GET /info-requests no Authorization → 401",
        r.status_code == 401,
        f"status={r.status_code} body={r.text[:120]}",
    )

    r = requests.get(f"{BASE}/r/{short_id}", timeout=10)
    case(
        "6b GET /r/{short_id} no Authorization → 200 (public)",
        r.status_code == 200 and "text/html" in r.headers.get("content-type", ""),
        f"status={r.status_code}",
    )

    r = requests.get(f"{BASE}/r/{short_id}/image", timeout=10)
    case(
        "6c GET /r/{short_id}/image no Authorization → 200 (public)",
        r.status_code == 200 and "image" in r.headers.get("content-type", ""),
        f"status={r.status_code}",
    )

    # ===========================================================
    # 7. Regression
    # ===========================================================
    print("\n=== 7. Regression ===")
    r = requests.get(f"{BASE}/health", timeout=10)
    case(
        "7a GET /health → 200",
        r.status_code == 200,
        f"status={r.status_code} body={r.text[:80]}",
    )

    r = requests.get(f"{BASE}/generations", headers=AUTH, timeout=10)
    case(
        "7b GET /generations (auth) → 200 list",
        r.status_code == 200 and isinstance(r.json(), list),
        f"status={r.status_code}",
    )

    # ===========================================================
    print("\n========== SUMMARY ==========")
    print(f"PASSED: {len(passed)}")
    print(f"FAILED: {len(failed)}")
    if failed:
        print("FAILURES:")
        for n in failed:
            print(f"  - {n}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
