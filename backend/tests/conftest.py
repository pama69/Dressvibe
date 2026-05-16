"""Shared fixtures for DressVibe backend tests.

Seeds a fake user + session directly in MongoDB so we can hit protected
endpoints with `Authorization: Bearer <token>` without going through the
Emergent OAuth dance.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Load backend env for MONGO_URL / DB_NAME
load_dotenv("/app/backend/.env")

BASE_URL = "https://outfit-gen-11.preview.emergentagent.com"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_USER_ID = f"user_TEST_{uuid.uuid4().hex[:8]}"
TEST_EMAIL = f"TEST_{uuid.uuid4().hex[:6]}@dressvibe.test"
TEST_TOKEN = f"TEST_token_{uuid.uuid4().hex}"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def auth_headers(_seeded_session):
    return {
        "Authorization": f"Bearer {TEST_TOKEN}",
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def _seeded_session():
    """Insert TEST_ user + session into Mongo. Cleanup at end."""

    async def _seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.insert_one({
            "user_id": TEST_USER_ID,
            "email": TEST_EMAIL,
            "name": "TEST User",
            "picture": None,
            "created_at": datetime.now(timezone.utc),
        })
        await db.user_sessions.insert_one({
            "session_token": TEST_TOKEN,
            "user_id": TEST_USER_ID,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
        client.close()

    async def _cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.user_sessions.delete_many({"user_id": TEST_USER_ID})
        await db.users.delete_many({"user_id": TEST_USER_ID})
        await db.garments.delete_many({"user_id": TEST_USER_ID})
        await db.generations.delete_many({"user_id": TEST_USER_ID})
        await db.virtual_clients.delete_many({"user_id": TEST_USER_ID})
        client.close()

    asyncio.get_event_loop().run_until_complete(_seed()) if False else asyncio.run(_seed())
    yield {"user_id": TEST_USER_ID, "email": TEST_EMAIL, "token": TEST_TOKEN}
    asyncio.run(_cleanup())


# A tiny 1x1 red PNG, base64-encoded (no data URI prefix)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI"
    "7wAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="session")
def tiny_png_b64():
    return TINY_PNG_B64
