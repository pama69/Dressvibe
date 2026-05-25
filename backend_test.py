"""
Backend tests for WhatsApp short-link "404 after paste" fix.
Verifies that POST /api/short-links, POST /api/telegram/publish, and
GET /api/r/{short_id} derive their public base URL from the live incoming
request (x-forwarded-host / host + x-forwarded-proto) instead of the static
PUBLIC_BASE_URL env value.
"""
import os
import sys
import asyncio
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/backend/.env"))

# CRITICAL: tests must talk DIRECTLY to localhost:8001 so the Host header
# is "localhost:8001" — otherwise the preview URL ingress rewrites it.
LOCAL_BASE = "http://localhost:8001/api"
AUTH = {"Authorization": "Bearer test_session_screen"}
GEN_ID = "gen_236386c42285"  # user_demo01 — 5 images

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
mclient = AsyncIOMotorClient(mongo_url)
db = mclient[db_name]


PASS = 0
FAIL = 0
FAILURES = []


def report(name, ok, detail=""):
    global PASS, FAIL
    icon = "PASS" if ok else "FAIL"
    line = f"[{icon}] {name}"
    if detail:
        line += f"  --  {detail}"
    print(line)
    if ok:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append((name, detail))


async def cleanup_short_links():
    """Wipe any existing short links for GEN_ID so we always exercise the
    NEW-mint code path on every test run."""
    await db.short_links.delete_many({"user_id": "user_demo01", "gen_id": GEN_ID})


async def test_1a_localhost_direct():
    """Case 1: Direct call (no proxy) → public_url MUST start with
    http://localhost:8001/api/r/..."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.post(
            f"{LOCAL_BASE}/short-links",
            headers={**AUTH, "Content-Type": "application/json"},
            json={"gen_id": GEN_ID, "image_index": 0, "look_name": "Test"},
        )
    if r.status_code != 200:
        report("1a-localhost-direct-status", False, f"status={r.status_code} body={r.text[:200]}")
        return None
    body = r.json()
    pu = body.get("public_url") or ""
    ok = pu.startswith("http://localhost:8001/api/r/")
    detail = f"public_url={pu}"
    report("1a-localhost-direct-public_url-prefix", ok, detail)
    not_preview = "outfit-gen-11.preview.emergentagent.com" not in pu
    report("1a-localhost-direct-not-preview", not_preview, detail)
    return body


async def test_1b_forwarded_host():
    """Case 1b: X-Forwarded-Host=my-custom-domain.test + X-Forwarded-Proto=https
    → public_url MUST start with https://my-custom-domain.test/api/r/..."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.post(
            f"{LOCAL_BASE}/short-links",
            headers={
                **AUTH,
                "Content-Type": "application/json",
                "X-Forwarded-Host": "my-custom-domain.test",
                "X-Forwarded-Proto": "https",
            },
            json={"gen_id": GEN_ID, "image_index": 1, "look_name": "Custom domain"},
        )
    if r.status_code != 200:
        report("1b-forwarded-host-status", False, f"status={r.status_code} body={r.text[:200]}")
        return None
    body = r.json()
    pu = body.get("public_url") or ""
    ok = pu.startswith("https://my-custom-domain.test/api/r/")
    report("1b-forwarded-host-public_url-prefix", ok, f"public_url={pu}")
    return body


async def test_2_idempotent_host_change():
    """Case 2: same (gen_id, image_index) called twice with different hosts.
    Second call's public_url must use hostB and DB row's public_base_at_creation
    must == 'https://hostB.test'."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        r1 = await http.post(
            f"{LOCAL_BASE}/short-links",
            headers={
                **AUTH,
                "Content-Type": "application/json",
                "X-Forwarded-Host": "hostA.test",
                "X-Forwarded-Proto": "https",
            },
            json={"gen_id": GEN_ID, "image_index": 2, "look_name": "Look A"},
        )
    if r1.status_code != 200:
        report("2-hostA-status", False, f"status={r1.status_code} body={r1.text[:200]}")
        return
    b1 = r1.json()
    short_id = b1.get("short_id")
    ok_a = (b1.get("public_url") or "").startswith("https://hostA.test/api/r/")
    report("2-hostA-public_url", ok_a, f"public_url={b1.get('public_url')}")

    doc_a = await db.short_links.find_one({"short_id": short_id}, {"_id": 0})
    pbac_a = (doc_a or {}).get("public_base_at_creation")
    report(
        "2-hostA-public_base_at_creation",
        pbac_a == "https://hostA.test",
        f"db.public_base_at_creation={pbac_a!r}",
    )
    tiny_a = (doc_a or {}).get("tiny_url")

    async with httpx.AsyncClient(timeout=15.0) as http:
        r2 = await http.post(
            f"{LOCAL_BASE}/short-links",
            headers={
                **AUTH,
                "Content-Type": "application/json",
                "X-Forwarded-Host": "hostB.test",
                "X-Forwarded-Proto": "https",
            },
            json={"gen_id": GEN_ID, "image_index": 2, "look_name": "Look B"},
        )
    if r2.status_code != 200:
        report("2-hostB-status", False, f"status={r2.status_code} body={r2.text[:200]}")
        return
    b2 = r2.json()
    ok_b = (b2.get("public_url") or "").startswith("https://hostB.test/api/r/")
    report("2-hostB-public_url", ok_b, f"public_url={b2.get('public_url')}")

    same_sid = b2.get("short_id") == short_id
    report("2-hostB-idempotent-short_id", same_sid, f"sid1={short_id} sid2={b2.get('short_id')}")

    doc_b = await db.short_links.find_one({"short_id": short_id}, {"_id": 0})
    pbac_b = (doc_b or {}).get("public_base_at_creation")
    report(
        "2-hostB-public_base_at_creation",
        pbac_b == "https://hostB.test",
        f"db.public_base_at_creation={pbac_b!r}",
    )

    # tiny_url should be present in response (re-minted) — per spec: "tiny_url
    # field in the response and in the DB row MUST have been REGENERATED (or
    # remain present and non-empty)".
    tu_resp = b2.get("tiny_url")
    tu_db = (doc_b or {}).get("tiny_url")
    report(
        "2-hostB-tiny_url-response-present",
        "tiny_url" in b2,
        f"response.tiny_url={tu_resp!r}",
    )
    report(
        "2-hostB-tiny_url-db-present",
        "tiny_url" in (doc_b or {}),
        f"db.tiny_url={tu_db!r} (prev hostA tiny_url={tiny_a!r})",
    )


async def test_3_db_public_base_at_creation_new_create():
    """Case 3: A brand-new (gen, image_index) combo → DB doc must include
    public_base_at_creation as non-empty string."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.post(
            f"{LOCAL_BASE}/short-links",
            headers={
                **AUTH,
                "Content-Type": "application/json",
                "X-Forwarded-Host": "fresh-host.test",
                "X-Forwarded-Proto": "https",
            },
            json={"gen_id": GEN_ID, "image_index": 3, "look_name": "Fresh"},
        )
    if r.status_code != 200:
        report("3-fresh-mint-status", False, f"status={r.status_code} body={r.text[:200]}")
        return
    body = r.json()
    sid = body.get("short_id")
    doc = await db.short_links.find_one({"short_id": sid}, {"_id": 0})
    pbac = (doc or {}).get("public_base_at_creation")
    ok = isinstance(pbac, str) and len(pbac) > 0
    report("3-new-create-public_base_at_creation-nonempty", ok, f"public_base_at_creation={pbac!r}")
    report(
        "3-new-create-public_base_at_creation-matches",
        pbac == "https://fresh-host.test",
        f"public_base_at_creation={pbac!r}",
    )


async def test_4_telegram_publish_live_host():
    """Case 4: POST /api/telegram/publish with X-Forwarded-Host=test-host.test.
    At minimum: 200 OK + short_link row minted with public_base_at_creation
    == 'https://test-host.test'.
    We use image_index=4 so a NEW short_link is minted (no idempotent reuse)."""
    gen = await db.generations.find_one({"id": GEN_ID}, {"_id": 0, "images": 1})
    if not gen or not gen.get("images"):
        report("4-tg-setup-images", False, "no images on gen")
        return
    images = gen["images"]
    if len(images) < 5:
        report("4-tg-setup-images-count", False, f"need 5 images, got {len(images)}")
        return
    img_idx = 4
    img_b64 = images[img_idx]

    async with httpx.AsyncClient(timeout=60.0) as http:
        r = await http.post(
            f"{LOCAL_BASE}/telegram/publish",
            headers={
                **AUTH,
                "Content-Type": "application/json",
                "X-Forwarded-Host": "test-host.test",
                "X-Forwarded-Proto": "https",
            },
            json={
                "image_base64": img_b64,
                "media_type": "photo",
                "caption": "Backend test live-host verification — please ignore",
                "gen_id": GEN_ID,
                "image_index": img_idx,
            },
        )
    if r.status_code != 200:
        report("4-tg-publish-status", False, f"status={r.status_code} body={r.text[:300]}")
        return
    body = r.json()
    report("4-tg-publish-200-ok", body.get("ok") is True, f"resp={body}")

    sl = await db.short_links.find_one(
        {"user_id": "user_demo01", "gen_id": GEN_ID, "image_index": img_idx},
        {"_id": 0},
    )
    report("4-tg-short_link-row-exists", sl is not None, f"sl={sl}")
    if sl is None:
        return
    pbac = sl.get("public_base_at_creation")
    report(
        "4-tg-short_link-public_base_at_creation",
        pbac == "https://test-host.test",
        f"public_base_at_creation={pbac!r}  (expected 'https://test-host.test')",
    )

    tg_pub = await db.tg_publications.find_one(
        {"gen_id": GEN_ID, "image_index": img_idx, "user_id": "user_demo01"},
        sort=[("created_at", -1)],
    )
    report(
        "4-tg-tg_publications-row-exists",
        tg_pub is not None and tg_pub.get("channel_message_id"),
        f"tg_pub.channel_message_id={tg_pub.get('channel_message_id') if tg_pub else None}",
    )


async def test_5_landing_page_live_host():
    """Case 5: GET /api/r/{short_id} with X-Forwarded-Host=hostC.test →
    HTML <img src> contains https://hostC.test/api/r/{short_id}/image"""
    sl = await db.short_links.find_one(
        {"user_id": "user_demo01", "gen_id": GEN_ID, "image_index": 0},
        {"_id": 0},
    )
    if not sl:
        report("5-landing-setup", False, "no short_link for image_index=0")
        return
    sid = sl["short_id"]
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(
            f"{LOCAL_BASE}/r/{sid}",
            headers={
                "X-Forwarded-Host": "hostC.test",
                "X-Forwarded-Proto": "https",
            },
        )
    if r.status_code != 200:
        report("5-landing-status", False, f"status={r.status_code} body={r.text[:200]}")
        return
    html = r.text
    ct_ok = "text/html" in (r.headers.get("content-type") or "")
    report("5-landing-content-type", ct_ok, f"content-type={r.headers.get('content-type')}")
    expected = f"https://hostC.test/api/r/{sid}/image"
    has_img_src = expected in html
    report(
        "5-landing-img-src-live-host",
        has_img_src,
        f"expected substring {expected!r} in HTML body (len={len(html)})",
    )


async def test_6_regression():
    """Regression: image PNG + providers + garments."""
    sl = await db.short_links.find_one(
        {"user_id": "user_demo01", "gen_id": GEN_ID, "image_index": 0},
        {"_id": 0},
    )
    if sl:
        sid = sl["short_id"]
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.get(f"{LOCAL_BASE}/r/{sid}/image")
        ok = r.status_code == 200 and (r.headers.get("content-type") or "").startswith("image/")
        report(
            "6-image-200-png",
            ok,
            f"status={r.status_code} content-type={r.headers.get('content-type')} bytes={len(r.content)}",
        )

    async with httpx.AsyncClient(timeout=15.0) as http:
        rp = await http.get(f"{LOCAL_BASE}/providers", headers=AUTH)
    report("6-providers-200", rp.status_code == 200, f"status={rp.status_code}")

    async with httpx.AsyncClient(timeout=15.0) as http:
        rg = await http.get(f"{LOCAL_BASE}/garments", headers=AUTH)
    report("6-garments-200", rg.status_code == 200, f"status={rg.status_code}")


async def main():
    print("=" * 70)
    print("WhatsApp short-link 404 fix — backend verification")
    print(f"Target: {LOCAL_BASE}")
    print("=" * 70)

    await cleanup_short_links()

    await test_1a_localhost_direct()
    await test_1b_forwarded_host()
    await test_2_idempotent_host_change()
    await test_3_db_public_base_at_creation_new_create()
    await test_4_telegram_publish_live_host()
    await test_5_landing_page_live_host()
    await test_6_regression()

    print("=" * 70)
    print(f"RESULT: {PASS} passed, {FAIL} failed")
    if FAILURES:
        print("FAILURES:")
        for name, det in FAILURES:
            print(f"  - {name}: {det}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
