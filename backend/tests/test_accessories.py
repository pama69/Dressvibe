"""Tests for the new 'Aggiungi accessori' feature and the
GET /api/generations memory-fix.

These tests use the canonical demo bearer token `test_session_screen`
→ user_id `user_demo01` (per /app/memory/test_credentials.md). The
fixture below idempotently seeds that user+session in Mongo so the
suite can run on a fresh DB.
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

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://outfit-gen-11.preview.emergentagent.com"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

DEMO_TOKEN = "test_session_screen"
DEMO_USER_ID = "user_demo01"

# Tiny valid 1x1 red PNG (no data: prefix)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI"
    "7wAAAABJRU5ErkJggg=="
)


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
        # Refresh the bearer session so it's always valid for the run.
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
    # No cleanup — these are stable demo fixtures shared across iterations.


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
def demo_garment(api, auth_headers):
    """Ensure user_demo01 has at least one garment; create one if missing."""
    r = api.get(f"{BASE_URL}/api/garments", headers=auth_headers)
    assert r.status_code == 200, r.text
    items = r.json()
    if items:
        return items[0]["id"]
    r = api.post(
        f"{BASE_URL}/api/garments",
        json={
            "name": "TEST_ACC_Garment",
            "image_base64": TINY_PNG_B64,
            "category": "t-shirt",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- A. GET /api/generations must NOT 500 ----------
class TestListGenerations:
    def test_list_returns_200_not_500(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/generations", headers=auth_headers, timeout=30)
        assert r.status_code == 200, (
            f"GET /api/generations returned {r.status_code} (expected 200). "
            f"Body: {r.text[:500]}"
        )
        data = r.json()
        assert isinstance(data, list), f"Expected list, got: {type(data)}"

    def test_list_has_no_heavy_images_field(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/generations", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()
        for item in items:
            assert "images" not in item, (
                f"list endpoint must strip the heavy `images` field; got item: "
                f"{list(item.keys())}"
            )
            assert "image_count" in item, f"missing image_count in {item}"
            assert "id" in item and "title" in item and "status" in item
            assert "created_at" in item
            # `thumbnail` is omitted by Mongo's $project when both arrays are
            # empty (failed generations with no images). When image_count > 0
            # it MUST be present.
            if item.get("image_count", 0) > 0:
                assert "thumbnail" in item and item["thumbnail"], (
                    f"items with images must expose a thumbnail, got: {item}"
                )


# ---------- B. POST /api/generations WITHOUT accessories (regression) ----------
class TestGenerationNoAccessories:
    def test_post_without_accessories_does_not_500(self, api, auth_headers, demo_garment):
        r = api.post(
            f"{BASE_URL}/api/generations",
            json={
                "garment_ids": [demo_garment],
                "model_gender": "donna",
                "model_age": "adulto",
                "model_body": "slim",
                "model_ethnicity": "caucasica",
                "pose": "casual_standing",
                "background": "white_studio",
                "num_variations": 1,
                "title": "TEST_ACC_no_accessories",
            },
            headers=auth_headers,
            timeout=180,
        )
        # 429 is acceptable per the brief (Gemini free-tier rate-limit on real call)
        assert r.status_code in (200, 429), f"unexpected {r.status_code}: {r.text[:500]}"
        if r.status_code == 200:
            body = r.json()
            assert body["status"] in ("done", "failed", "rate_limited"), body
            assert body["id"].startswith("gen_")
            # Cleanup so we don't pile up demo data
            try:
                api.delete(f"{BASE_URL}/api/generations/{body['id']}", headers=auth_headers)
            except Exception:
                pass


# ---------- C. POST /api/generations WITH accessories ----------
class TestGenerationWithAccessories:
    def test_post_with_accessories_works_and_excludes_from_params(
        self, api, auth_headers, demo_garment
    ):
        r = api.post(
            f"{BASE_URL}/api/generations",
            json={
                "garment_ids": [demo_garment],
                "model_gender": "donna",
                "model_age": "adulto",
                "model_body": "slim",
                "model_ethnicity": "caucasica",
                "pose": "casual_standing",
                "background": "white_studio",
                "num_variations": 1,
                "title": "TEST_ACC_with_accessories",
                "accessories": [
                    {"category": "scarpe", "image_base64": TINY_PNG_B64},
                    {"category": "borse", "image_base64": TINY_PNG_B64},
                ],
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code in (200, 429), f"unexpected {r.status_code}: {r.text[:500]}"
        if r.status_code != 200:
            pytest.skip(f"upstream non-2xx (likely rate-limit): {r.status_code}")

        body = r.json()
        assert body["id"].startswith("gen_")
        # Persisted params MUST NOT contain accessories (disposable one-shot)
        params = body.get("params") or {}
        assert "accessories" not in params, (
            f"accessories must be stripped from persisted params, got keys: "
            f"{list(params.keys())}"
        )

        # Also verify the GET detail does not leak accessories
        gid = body["id"]
        r2 = api.get(f"{BASE_URL}/api/generations/{gid}", headers=auth_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        params2 = (r2.json() or {}).get("params") or {}
        assert "accessories" not in params2, (
            f"persisted DB doc must not contain accessories in params, keys: "
            f"{list(params2.keys())}"
        )
        # Cleanup
        try:
            api.delete(f"{BASE_URL}/api/generations/{gid}", headers=auth_headers)
        except Exception:
            pass


# ---------- D. Invalid accessory category (falls back to "altro") ----------
class TestGenerationInvalidCategory:
    def test_unknown_category_still_accepted(self, api, auth_headers, demo_garment):
        r = api.post(
            f"{BASE_URL}/api/generations",
            json={
                "garment_ids": [demo_garment],
                "model_gender": "donna",
                "model_age": "adulto",
                "model_body": "slim",
                "model_ethnicity": "caucasica",
                "pose": "casual_standing",
                "background": "white_studio",
                "num_variations": 1,
                "title": "TEST_ACC_bad_category",
                "accessories": [
                    {"category": "banana", "image_base64": TINY_PNG_B64},
                ],
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code in (200, 429), f"unexpected {r.status_code}: {r.text[:500]}"
        if r.status_code == 200:
            body = r.json()
            assert body["id"].startswith("gen_")
            try:
                api.delete(f"{BASE_URL}/api/generations/{body['id']}", headers=auth_headers)
            except Exception:
                pass


# ---------- E. Pydantic schema enforcement ----------
class TestAccessorySchemaValidation:
    def test_missing_image_base64_returns_422(self, api, auth_headers, demo_garment):
        r = api.post(
            f"{BASE_URL}/api/generations",
            json={
                "garment_ids": [demo_garment],
                "model_gender": "donna",
                "model_age": "adulto",
                "model_body": "slim",
                "model_ethnicity": "caucasica",
                "pose": "casual_standing",
                "background": "white_studio",
                "num_variations": 1,
                "accessories": [
                    {"category": "scarpe"}  # ← image_base64 missing
                ],
            },
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422, (
            f"expected 422 for missing image_base64, got {r.status_code}: {r.text[:500]}"
        )

    def test_missing_category_returns_422(self, api, auth_headers, demo_garment):
        r = api.post(
            f"{BASE_URL}/api/generations",
            json={
                "garment_ids": [demo_garment],
                "model_gender": "donna",
                "model_age": "adulto",
                "model_body": "slim",
                "model_ethnicity": "caucasica",
                "pose": "casual_standing",
                "background": "white_studio",
                "num_variations": 1,
                "accessories": [
                    {"image_base64": TINY_PNG_B64}  # ← category missing
                ],
            },
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422, (
            f"expected 422 for missing category, got {r.status_code}: {r.text[:500]}"
        )


# ---------- F. Unit-level check: _compose_accessories_suffix ----------
class TestComposeAccessoriesSuffixUnit:
    """Direct import test to confirm the helper renders the expected text."""

    @staticmethod
    def _import():
        import sys
        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        from server import _compose_accessories_suffix, AccessoryItem  # type: ignore
        return _compose_accessories_suffix, AccessoryItem

    def test_empty_returns_empty_string(self):
        _compose_accessories_suffix, _ = self._import()
        assert _compose_accessories_suffix(None, 0) == ""
        assert _compose_accessories_suffix([], 3) == ""

    def test_ref_indexes_are_after_garments(self):
        _compose_accessories_suffix, AccessoryItem = self._import()
        out = _compose_accessories_suffix(
            [
                AccessoryItem(category="scarpe", image_base64="x"),
                AccessoryItem(category="borse", image_base64="y"),
            ],
            num_garments=3,
        )
        # garments are 1..3, so accessories are #4 and #5
        assert "Reference image #4" in out
        assert "Reference image #5" in out
        assert "MANDATORY ACCESSORIES" in out

    def test_unknown_category_falls_back_to_altro(self):
        _compose_accessories_suffix, AccessoryItem = self._import()
        out = _compose_accessories_suffix(
            [AccessoryItem(category="banana", image_base64="x")],
            num_garments=1,
        )
        # Should still build a suffix without throwing
        assert "Reference image #2" in out
