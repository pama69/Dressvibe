"""
Backend tests for the refactored Telegram publish flow (URL-button instead of
the legacy callback_query/PRENOTA path).

Scenarios:
1) Smoke import + healthy backend
2) POST /api/telegram/publish (photo) with gen_id+image_index → 200, db.short_links row
3) Idempotency: re-publish same (gen_id, image_index) → same short_id, no growth
4) POST /api/telegram/publish without gen_id/image_index → 200, no inline button
5) Webhook regression: fake "book:" callback_query → 200 {"ok": true}, no crash
6) Regression: GET /api/providers, /api/garments, /api/generations → 200
"""
import os
import sys
import json
import asyncio
from typing import Any, Dict, Optional

import httpx

BASE_URL = "https://outfit-gen-11.preview.emergentagent.com"
API = f"{BASE_URL}/api"
BEARER = "test_session_screen"
AUTH_HEADERS = {"Authorization": f"Bearer {BEARER}"}

# Telegram webhook secret from /app/backend/.env
TELEGRAM_WEBHOOK_SECRET = "dressvibe_tg_hook_2026"

results = []


def record(name: str, ok: bool, detail: str = ""):
    results.append({"name": name, "ok": ok, "detail": detail})
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {name}  {detail}")


def http_get(client: httpx.Client, path: str, **kwargs):
    return client.get(f"{API}{path}", headers=AUTH_HEADERS, timeout=120.0, **kwargs)


def http_post(client: httpx.Client, path: str, **kwargs):
    return client.post(f"{API}{path}", headers=AUTH_HEADERS, timeout=180.0, **kwargs)


def case1_smoke(client: httpx.Client) -> bool:
    import ast
    try:
        ast.parse(open("/app/backend/server.py").read())
    except Exception as e:
        record("1a smoke ast.parse server.py", False, str(e))
        return False
    record("1a smoke ast.parse server.py", True, "syntax OK")

    try:
        r = client.get(f"{API}/providers", headers=AUTH_HEADERS, timeout=30.0)
    except Exception as e:
        record("1b backend reachable /api/providers", False, str(e))
        return False
    ok = r.status_code in (200, 401)
    record("1b backend reachable /api/providers", ok, f"status={r.status_code}")
    return ok


async def _db_short_links_count(user_id: str, gen_id: str, image_index: int) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "dressvibe")
    cli = AsyncIOMotorClient(mongo_url)
    try:
        db = cli[db_name]
        return await db.short_links.count_documents({
            "user_id": user_id, "gen_id": gen_id, "image_index": image_index,
        })
    finally:
        cli.close()


async def _db_short_link_doc(user_id: str, gen_id: str, image_index: int) -> Optional[Dict[str, Any]]:
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "dressvibe")
    cli = AsyncIOMotorClient(mongo_url)
    try:
        db = cli[db_name]
        return await db.short_links.find_one(
            {"user_id": user_id, "gen_id": gen_id, "image_index": image_index},
            {"_id": 0},
        )
    finally:
        cli.close()


def _get_or_create_gen(client: httpx.Client) -> Optional[Dict[str, Any]]:
    rg = http_get(client, "/garments")
    if rg.status_code != 200:
        record("setup GET /garments", False, f"status={rg.status_code}")
        return None
    garments = rg.json()
    if not garments:
        record("setup garments empty", False, "no garments found")
        return None
    garment_id = garments[0]["id"]
    record("setup found garment", True, f"garment_id={garment_id}")

    payload = {
        "garment_ids": [garment_id],
        "model_gender": "donna",
        "model_age": "giovane",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
        "shoes": "comoda_fashion",
        "num_variations": 1,
        "title": "Test post via new URL button",
    }
    r = http_post(client, "/generations", json=payload)
    if r.status_code != 200:
        record("setup POST /generations", False,
               f"status={r.status_code} body={r.text[:300]}")
        return None
    data = r.json()
    if data.get("status") != "done" or not data.get("images"):
        # try fetching gen by id
        gid = data.get("id")
        if gid:
            r2 = http_get(client, f"/generations/{gid}")
            if r2.status_code == 200:
                data = r2.json()
    if data.get("status") != "done" or not data.get("images"):
        # fallback: pick a recent "done" gen with images
        r3 = http_get(client, "/generations")
        if r3.status_code == 200:
            for g in r3.json():
                if g.get("status") == "done" and g.get("images"):
                    # need to fetch full doc with images
                    rfull = http_get(client, f"/generations/{g['id']}")
                    if rfull.status_code == 200 and rfull.json().get("images"):
                        full = rfull.json()
                        record("setup fallback gen", True,
                               f"gen_id={full['id']} images={len(full['images'])}")
                        return full
        record("setup gen unusable", False,
               f"status={data.get('status')} images_len={len(data.get('images') or [])}")
        return None
    record("setup POST /generations", True,
           f"gen_id={data['id']} images={len(data['images'])}")
    return data


def case2_publish_with_gen(client: httpx.Client, gen: Dict[str, Any]) -> Optional[str]:
    gen_id = gen["id"]
    image_index = 0
    img_b64 = gen["images"][0]

    payload = {
        "image_base64": img_b64,
        "media_type": "photo",
        "caption": "Test post via new URL button",
        "gen_id": gen_id,
        "image_index": image_index,
    }
    r = http_post(client, "/telegram/publish", json=payload)
    if r.status_code != 200:
        record("2 POST /telegram/publish (photo+gen_id) 200", False,
               f"status={r.status_code} body={r.text[:400]}")
        return None
    body = r.json()
    has_msg_id = bool(body.get("message_id") or body.get("channel_message_id"))
    has_token = bool(body.get("token"))
    ok = has_msg_id and has_token
    record("2 POST /telegram/publish (photo+gen_id) 200", ok,
           f"channel_message_id={body.get('channel_message_id')} token={body.get('token')}")
    if not ok:
        return None

    user_id = "user_demo01"
    doc = asyncio.run(_db_short_link_doc(user_id, gen_id, image_index))
    if not doc:
        record("2b db.short_links row exists", False, "no document found")
        return None
    if not doc.get("short_id"):
        record("2b db.short_links row has non-empty short_id", False, f"doc={doc}")
        return None
    record("2b db.short_links row has non-empty short_id", True,
           f"short_id={doc['short_id']} look_name={doc.get('look_name')}")
    return doc["short_id"]


def case3_idempotency(client: httpx.Client, gen: Dict[str, Any], first_short_id: str):
    gen_id = gen["id"]
    image_index = 0
    img_b64 = gen["images"][0]
    user_id = "user_demo01"

    cnt_before = asyncio.run(_db_short_links_count(user_id, gen_id, image_index))
    payload = {
        "image_base64": img_b64,
        "media_type": "photo",
        "caption": "Test post via new URL button (idempotency)",
        "gen_id": gen_id,
        "image_index": image_index,
    }
    r = http_post(client, "/telegram/publish", json=payload)
    if r.status_code != 200:
        record("3 POST /telegram/publish idempotent 200", False,
               f"status={r.status_code} body={r.text[:400]}")
        return
    record("3 POST /telegram/publish idempotent 200", True, "status=200")

    cnt_after = asyncio.run(_db_short_links_count(user_id, gen_id, image_index))
    same_count = (cnt_after == cnt_before == 1)
    record("3b db.short_links count unchanged (==1)", same_count,
           f"before={cnt_before} after={cnt_after}")

    doc = asyncio.run(_db_short_link_doc(user_id, gen_id, image_index))
    same_sid = bool(doc and doc.get("short_id") == first_short_id)
    record("3c short_id reused", same_sid,
           f"first={first_short_id} now={doc.get('short_id') if doc else None}")


def case4_publish_no_gen(client: httpx.Client, gen: Dict[str, Any]):
    img_b64 = gen["images"][0]
    payload = {
        "image_base64": img_b64,
        "media_type": "photo",
        "caption": "Test post WITHOUT gen_id (no inline button expected)",
    }
    r = http_post(client, "/telegram/publish", json=payload)
    if r.status_code != 200:
        record("4 POST /telegram/publish without gen_id 200", False,
               f"status={r.status_code} body={r.text[:400]}")
        return
    body = r.json()
    ok = bool(body.get("channel_message_id"))
    record("4 POST /telegram/publish without gen_id 200", ok,
           f"status={r.status_code} channel_message_id={body.get('channel_message_id')}")


def case5_webhook_callback(client: httpx.Client):
    url = f"{API}/telegram/webhook/{TELEGRAM_WEBHOOK_SECRET}"
    body = {
        "update_id": 123456789,
        "callback_query": {
            "id": "fake_cb_id_test_session",
            "from": {"id": 999999, "first_name": "Test"},
            "data": "book:legacy_token_abc",
        },
    }
    try:
        r = client.post(url, json=body, timeout=30.0)
    except Exception as e:
        record("5 webhook legacy callback_query ack", False, str(e))
        return
    parsed = None
    try:
        parsed = r.json()
    except Exception:
        pass
    ok = (r.status_code == 200) and (parsed == {"ok": True})
    record("5 webhook legacy callback_query ack", ok,
           f"status={r.status_code} body={r.text[:200]}")


def case6_regression(client: httpx.Client):
    for path in ("/providers", "/garments", "/generations"):
        r = http_get(client, path)
        record(f"6 regression GET {path}", r.status_code == 200, f"status={r.status_code}")


def main():
    with httpx.Client() as client:
        if not case1_smoke(client):
            print("\nSmoke failed; aborting.")
            _summary()
            sys.exit(2)

        gen = _get_or_create_gen(client)
        if not gen:
            print("\nCould not create or find a usable generation. Running webhook+regression only.")
            case5_webhook_callback(client)
            case6_regression(client)
            _summary()
            sys.exit(3)

        short_id = case2_publish_with_gen(client, gen)
        if short_id:
            case3_idempotency(client, gen, short_id)
        else:
            record("3 idempotency skipped", False, "case 2 failed; cannot run")

        case4_publish_no_gen(client, gen)
        case5_webhook_callback(client)
        case6_regression(client)
        _summary()


def _summary():
    print("\n" + "=" * 60)
    passed = sum(1 for r in results if r["ok"])
    total = len(results)
    print(f"RESULTS: {passed}/{total} PASS")
    for r in results:
        icon = "PASS" if r["ok"] else "FAIL"
        print(f"  [{icon}] {r['name']}  {r['detail']}")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
