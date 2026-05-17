"""Backend tests for DressVibe — focus on /api/telegram/publish (photo+video)."""
import os
import base64
import json
import sys
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

BASE = "https://outfit-gen-11.preview.emergentagent.com/api"
TOKEN = "test_session_screen"
HEAD = {"Authorization": f"Bearer {TOKEN}"}

# 1x1 transparent PNG
PNG_1x1_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
VIDEO_URL = (
    "https://vidgen.x.ai/xai-vidgen-bucket/xai-video-1d9deb7a-b4bc-472c-8a11-443a862b903f.mp4"
)

results = []

def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}")
    results.append((name, ok, detail))

async def main():
    mongo = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = mongo[os.environ['DB_NAME']]

    # Make sure pre-seeded artifacts exist
    sess = await db.user_sessions.find_one({"session_token": TOKEN})
    if not sess:
        # auto-seed
        await db.users.update_one(
            {"user_id": "user_demo01"},
            {"$setOnInsert": {"user_id": "user_demo01", "email": "demo01@dressvibe.test",
                               "name": "Demo Owner", "picture": None,
                               "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        await db.user_sessions.insert_one({
            "session_token": TOKEN, "user_id": "user_demo01",
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })

    async with httpx.AsyncClient(timeout=180.0) as http:

        # ---------- VALIDATION TESTS ----------
        # 1) media_type=video without video_url → 400
        r = await http.post(f"{BASE}/telegram/publish", headers=HEAD,
                            json={"media_type": "video"})
        record("validation_video_missing_url",
               r.status_code == 400,
               f"status={r.status_code} body={r.text[:200]}")

        # 2) media_type=photo without image_base64 → 400
        r = await http.post(f"{BASE}/telegram/publish", headers=HEAD,
                            json={"media_type": "photo"})
        record("validation_photo_missing_image",
               r.status_code == 400,
               f"status={r.status_code} body={r.text[:200]}")
        # also test default (no media_type)
        r = await http.post(f"{BASE}/telegram/publish", headers=HEAD, json={})
        record("validation_default_no_image",
               r.status_code == 400,
               f"status={r.status_code} body={r.text[:200]}")

        # ---------- HAPPY PATH: PHOTO ----------
        caption_photo = f"DressVibe test publish (photo) {uuid.uuid4().hex[:6]}"
        r = await http.post(f"{BASE}/telegram/publish", headers=HEAD, json={
            "media_type": "photo",
            "image_base64": PNG_1x1_B64,
            "caption": caption_photo,
            "gen_id": "gen_web_test1",
            "image_index": 0,
        })
        if r.status_code == 200:
            body = r.json()
            ok = (body.get("ok") is True
                  and body.get("channel_message_id")
                  and body.get("token")
                  and body.get("media_type") == "photo")
            record("happy_photo_response", ok, f"body={body}")
            # DB row check
            row = await db.tg_publications.find_one({"token": body["token"]}, {"_id": 0})
            row_ok = bool(row and row.get("media_type") == "photo"
                          and row.get("channel_message_id") == body["channel_message_id"]
                          and row.get("user_id") == "user_demo01")
            record("happy_photo_db_row", row_ok, f"row={row}")
        else:
            record("happy_photo_response", False,
                   f"status={r.status_code} body={r.text[:400]}")

        # ---------- HAPPY PATH: VIDEO ----------
        caption_video = f"DressVibe test publish (video) {uuid.uuid4().hex[:6]}"
        r = await http.post(f"{BASE}/telegram/publish", headers=HEAD, json={
            "media_type": "video",
            "video_url": VIDEO_URL,
            "caption": caption_video,
            "gen_id": "gen_web_test1",
            "image_index": 0,
        })
        if r.status_code == 200:
            body = r.json()
            ok = (body.get("ok") is True
                  and body.get("channel_message_id")
                  and body.get("token")
                  and body.get("media_type") == "video")
            record("happy_video_response", ok, f"body={body}")
            row = await db.tg_publications.find_one({"token": body["token"]}, {"_id": 0})
            row_ok = bool(row and row.get("media_type") == "video"
                          and row.get("channel_message_id") == body["channel_message_id"])
            record("happy_video_db_row", row_ok, f"row={row}")
        else:
            record("happy_video_response", False,
                   f"status={r.status_code} body={r.text[:400]}")

        # ---------- REGRESSION ----------
        # GET /providers
        r = await http.get(f"{BASE}/providers", headers=HEAD)
        ok = r.status_code == 200 and isinstance(r.json(), (list, dict))
        record("regression_providers", ok, f"status={r.status_code} body={r.text[:200]}")

        # GET /generations/{id}/videos
        r = await http.get(f"{BASE}/generations/gen_web_test1/videos", headers=HEAD)
        videos = []
        if r.status_code == 200:
            videos = r.json()
            record("regression_generation_videos",
                   isinstance(videos, list),
                   f"count={len(videos) if isinstance(videos, list) else 'n/a'}")
        else:
            record("regression_generation_videos", False,
                   f"status={r.status_code} body={r.text[:200]}")

        # DELETE /videos/{video_id} - non-existent
        r = await http.delete(f"{BASE}/videos/does-not-exist-xyz", headers=HEAD)
        record("regression_delete_missing_404",
               r.status_code == 404,
               f"status={r.status_code} body={r.text[:200]}")

        # DELETE /videos/{video_id} - existing (use a throwaway inserted record)
        throwaway_id = f"vid_test_{uuid.uuid4().hex[:8]}"
        await db.videos.insert_one({
            "id": throwaway_id,
            "user_id": "user_demo01",
            "gen_id": "gen_web_test1",
            "image_index": 0,
            "provider": "test",
            "status": "completed",
            "created_at": datetime.now(timezone.utc),
        })
        r = await http.delete(f"{BASE}/videos/{throwaway_id}", headers=HEAD)
        record("regression_delete_existing_200",
               r.status_code == 200 and r.json().get("ok") is True,
               f"status={r.status_code} body={r.text[:200]}")

    # Summary
    print("\n===== SUMMARY =====")
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
