"""Tests for the NEW addition: 'Aggiungi accessori' on POST /api/studio/edit.

Covers:
  A. Regression — POST /api/studio/edit WITHOUT accessories still works
  B. POST /api/studio/edit WITH accessories
  C. Pydantic validation in StudioEditRequest (422 on missing fields)
  D. Empty accessories list behaves identically to "no field"
  E. gen_id linkage — edited image gets appended and image_index is correct

All tests run against the public preview URL using the canonical demo
bearer `test_session_screen` → user_demo01 (see /app/memory/test_credentials.md).
Gemini is real → 200 OR 502 are both accepted (schema is what matters).
"""
import os
import asyncio
import base64
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://outfit-gen-11.preview.emergentagent.com"
).rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

DEMO_TOKEN = "test_session_screen"
DEMO_USER_ID = "user_demo01"

# Tiny valid 1x1 red PNG (no data: prefix)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI"
    "7wAAAABJRU5ErkJggg=="
)

# Gemini may rate-limit; we accept these along with 200.
OK_STATUS = (200, 502)


# ---------- Fixtures ----------
@pytest.fixture(scope="session", autouse=True)
def seed_demo_session():
    """Idempotently insert user_demo01 + the test_session_screen token."""

    async def _seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.update_one(
            {"user_id": DEMO_USER_ID},
            {
                "$setOnInsert": {
                    "user_id": DEMO_USER_ID,
                    "email": "demo01@dressvibe.test",
                    "name": "Demo01",
                    "picture": None,
                    "created_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )
        await db.user_sessions.update_one(
            {"session_token": DEMO_TOKEN},
            {
                "$set": {
                    "session_token": DEMO_TOKEN,
                    "user_id": DEMO_USER_ID,
                    "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                },
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        client.close()

    asyncio.run(_seed())
    yield


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_headers():
    return {
        "Authorization": f"Bearer {DEMO_TOKEN}",
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def seeded_generation():
    """Create a fake-but-valid generation directly in Mongo, owned by
    user_demo01, with one image in `images` and one thumb in `thumbs`.

    This avoids burning Gemini quota just to obtain a gen_id for the
    image_index linkage test. Yields the gen_id and cleans up afterwards.
    """

    gen_id = f"gen_TEST_STUDIO_{os.urandom(4).hex()}"

    async def _create():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.generations.insert_one(
            {
                "id": gen_id,
                "user_id": DEMO_USER_ID,
                "garment_ids": [],
                "title": "TEST_STUDIO_seed",
                "params": {},
                "images": [TINY_PNG_B64],
                "thumbs": [TINY_PNG_B64],
                "image_count": 1,
                "status": "done",
                "created_at": datetime.now(timezone.utc),
            }
        )
        client.close()

    async def _cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.generations.delete_one({"id": gen_id})
        client.close()

    asyncio.run(_create())
    yield gen_id
    asyncio.run(_cleanup())


# ---------- A. Regression: studio/edit WITHOUT accessories ----------
class TestStudioEditNoAccessories:
    def test_post_without_accessories(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/studio/edit",
            json={
                "image_base64": TINY_PNG_B64,
                "edit_prompt": "Change background to a clean white studio.",
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code in OK_STATUS, (
            f"unexpected {r.status_code}: {r.text[:500]}"
        )
        if r.status_code == 200:
            body = r.json()
            assert "image_base64" in body, body
            assert isinstance(body["image_base64"], str) and body["image_base64"]
            # No gen_id → image_index should be None
            assert body.get("image_index") is None, body


# ---------- B. studio/edit WITH accessories (the new feature) ----------
class TestStudioEditWithAccessories:
    def test_post_with_accessories(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/studio/edit",
            json={
                "image_base64": TINY_PNG_B64,
                "edit_prompt": "Change background to a clean white studio.",
                "accessories": [
                    {"category": "scarpe", "image_base64": TINY_PNG_B64},
                    {"category": "borse", "image_base64": TINY_PNG_B64},
                    {"category": "occhiali", "image_base64": TINY_PNG_B64},
                ],
            },
            headers=auth_headers,
            timeout=240,
        )
        assert r.status_code in OK_STATUS, (
            f"unexpected {r.status_code}: {r.text[:500]}"
        )
        if r.status_code == 200:
            body = r.json()
            assert "image_base64" in body and body["image_base64"]


# ---------- C. Pydantic validation in StudioEditRequest ----------
class TestStudioEditSchemaValidation:
    def test_missing_image_base64_in_accessory_returns_422(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/studio/edit",
            json={
                "image_base64": TINY_PNG_B64,
                "edit_prompt": "Change background.",
                "accessories": [{"category": "scarpe"}],  # missing image_base64
            },
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422, (
            f"expected 422 for accessory missing image_base64, "
            f"got {r.status_code}: {r.text[:500]}"
        )

    def test_missing_category_in_accessory_returns_422(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/studio/edit",
            json={
                "image_base64": TINY_PNG_B64,
                "edit_prompt": "Change background.",
                "accessories": [{"image_base64": TINY_PNG_B64}],  # missing category
            },
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422, (
            f"expected 422 for accessory missing category, "
            f"got {r.status_code}: {r.text[:500]}"
        )


# ---------- D. Empty accessories list ----------
class TestStudioEditEmptyAccessoriesList:
    def test_empty_list_behaves_like_no_field(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/studio/edit",
            json={
                "image_base64": TINY_PNG_B64,
                "edit_prompt": "Change background to a clean white studio.",
                "accessories": [],
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code in OK_STATUS, (
            f"unexpected {r.status_code}: {r.text[:500]}"
        )
        if r.status_code == 200:
            body = r.json()
            assert "image_base64" in body and body["image_base64"]


# ---------- E. gen_id linkage with accessories ----------
class TestStudioEditGenIdLinkage:
    def test_edited_image_is_appended_with_correct_index(
        self, api, auth_headers, seeded_generation
    ):
        gen_id = seeded_generation

        # Snapshot the existing length before the edit
        async def _get_len():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            doc = await db.generations.find_one(
                {"id": gen_id}, {"_id": 0, "images": 1, "thumbs": 1}
            )
            client.close()
            return doc

        before = asyncio.run(_get_len())
        assert before, "seeded generation not found"
        before_images_len = len(before.get("images") or [])
        before_thumbs_len = len(before.get("thumbs") or [])

        r = api.post(
            f"{BASE_URL}/api/studio/edit",
            json={
                "image_base64": TINY_PNG_B64,
                "edit_prompt": "Change background to a clean white studio.",
                "gen_id": gen_id,
                "accessories": [
                    {"category": "scarpe", "image_base64": TINY_PNG_B64},
                ],
            },
            headers=auth_headers,
            timeout=240,
        )
        assert r.status_code in OK_STATUS, (
            f"unexpected {r.status_code}: {r.text[:500]}"
        )
        if r.status_code != 200:
            pytest.skip(f"upstream non-2xx (likely Gemini 502): {r.status_code}")

        body = r.json()
        assert "image_base64" in body and body["image_base64"]
        new_index = body.get("image_index")
        assert isinstance(new_index, int), f"expected int image_index, got: {body}"
        # The new index must equal previous length (it's the just-pushed slot)
        assert new_index == before_images_len, (
            f"new image_index {new_index} != previous images length {before_images_len}"
        )

        # Verify persistence: images & thumbs arrays grew by exactly 1
        after = asyncio.run(_get_len())
        assert after, "generation disappeared after edit"
        assert len(after.get("images") or []) == before_images_len + 1, after
        assert len(after.get("thumbs") or []) == before_thumbs_len + 1, after
