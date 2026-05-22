"""DressVibe — Email/Password Auth + Telegram strict tests.

Runs against the live backend (localhost:8001) per the review request.
Reads OTPs directly from MongoDB `users` collection (fields
`verification_code`, `reset_code`).
"""

import asyncio
import os
import sys
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path("/app/backend")
load_dotenv(ROOT / ".env")

API_BASE = "http://localhost:8001/api"
BEARER = "Bearer test_session_screen"  # user_demo01
HEADERS_AUTH = {"Authorization": BEARER}

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

results = []


def record(name: str, ok: bool, info: str = ""):
    flag = "PASS" if ok else "FAIL"
    line = f"[{flag}] {name}" + (f" -- {info}" if info else "")
    print(line)
    results.append((name, ok, info))


async def find_user(db, email: str):
    return await db.users.find_one({"email": email.lower().strip()}, {"_id": 0})


async def main():
    mclient = AsyncIOMotorClient(MONGO_URL)
    db = mclient[DB_NAME]

    async with httpx.AsyncClient(base_url=API_BASE, timeout=30.0) as cx:
        # =========== EMAIL/PASSWORD AUTH ===========

        # CASE 1: Register new email — happy path
        email1 = f"test+{uuid.uuid4().hex[:8]}@example.it"
        pwd1 = "MyStr0ngPass!"
        r = await cx.post(
            "/auth/email/register",
            json={"email": email1, "password": pwd1, "name": "Anna Rossi"},
        )
        ok = r.status_code == 200 and r.json().get("ok") is True
        record("Case 1: register happy path", ok, f"status={r.status_code}")
        u = await find_user(db, email1)
        otp1 = u.get("verification_code") if u else None
        record(
            "Case 1b: user row created with verification_code, is_verified=False",
            bool(u) and bool(otp1) and u.get("is_verified") is False,
            f"is_verified={u.get('is_verified') if u else None} otp_len={len(otp1) if otp1 else 0}",
        )

        # CASE 2: Register with weak password → 400
        r = await cx.post(
            "/auth/email/register",
            json={"email": f"test+{uuid.uuid4().hex[:8]}@example.it", "password": "short"},
        )
        record(
            "Case 2: register weak password rejected (400)",
            r.status_code == 400 and "almeno 8 caratteri" in r.text,
            f"status={r.status_code} body={r.text[:200]}",
        )

        # CASE 3: Register with invalid email → 422
        r = await cx.post(
            "/auth/email/register",
            json={"email": "not-an-email", "password": "Whatever1234"},
        )
        record(
            "Case 3: register invalid email rejected",
            r.status_code in (400, 422),
            f"status={r.status_code}",
        )

        # CASE 4: Verify with WRONG code → 400
        r = await cx.post("/auth/email/verify", json={"email": email1, "code": "000000"})
        record(
            "Case 4: verify wrong code → 400",
            r.status_code == 400 and "non valido" in r.text.lower(),
            f"status={r.status_code} body={r.text[:200]}",
        )

        # CASE 5: Verify with CORRECT code → 200 + session_token
        r = await cx.post("/auth/email/verify", json={"email": email1, "code": otp1})
        body = r.json() if r.status_code == 200 else {}
        session_token_email1 = body.get("session_token")
        record(
            "Case 5: verify correct code returns session_token",
            r.status_code == 200
            and bool(session_token_email1)
            and body.get("user", {}).get("email") == email1.lower(),
            f"status={r.status_code} token_present={bool(session_token_email1)}",
        )
        u2 = await find_user(db, email1)
        record(
            "Case 5b: DB row is_verified=True + verification_code unset",
            bool(u2) and u2.get("is_verified") is True and "verification_code" not in u2,
            f"is_verified={u2.get('is_verified') if u2 else None} "
            f"has_vc={'verification_code' in (u2 or {})}",
        )

        # CASE 6: Register DUPLICATE verified email → 409
        r = await cx.post(
            "/auth/email/register",
            json={"email": email1, "password": "AnotherPass1!"},
        )
        record(
            "Case 6: re-register verified email → 409",
            r.status_code == 409,
            f"status={r.status_code} body={r.text[:200]}",
        )

        # CASE 7: Login with correct password → 200
        r = await cx.post("/auth/email/login", json={"email": email1, "password": pwd1})
        body = r.json() if r.status_code == 200 else {}
        login_token = body.get("session_token")
        record(
            "Case 7: login happy path returns session_token",
            r.status_code == 200 and bool(login_token),
            f"status={r.status_code}",
        )
        if login_token:
            rme = await cx.get(
                "/auth/me", headers={"Authorization": f"Bearer {login_token}"}
            )
            record(
                "Case 7b: returned session_token works on /auth/me",
                rme.status_code == 200 and rme.json().get("email") == email1.lower(),
                f"status={rme.status_code}",
            )

        # CASE 8: Login with WRONG password → 401
        r = await cx.post(
            "/auth/email/login", json={"email": email1, "password": "WrongPass1234"}
        )
        record(
            "Case 8: login wrong password → 401",
            r.status_code == 401,
            f"status={r.status_code}",
        )

        # CASE 9: Login UNVERIFIED user → 403
        email_unv = f"test+{uuid.uuid4().hex[:8]}@example.it"
        pwd_unv = "UnverifiedPass1!"
        r = await cx.post(
            "/auth/email/register", json={"email": email_unv, "password": pwd_unv}
        )
        record("Case 9a: register unverified user", r.status_code == 200, f"status={r.status_code}")
        r = await cx.post(
            "/auth/email/login", json={"email": email_unv, "password": pwd_unv}
        )
        record(
            "Case 9b: login unverified → 403",
            r.status_code == 403 and "non ancora verificato" in r.text.lower(),
            f"status={r.status_code} body={r.text[:200]}",
        )

        # CASE 10: Forgot password
        r = await cx.post("/auth/email/forgot", json={"email": email1})
        record(
            "Case 10: forgot password returns 200",
            r.status_code == 200 and r.json().get("ok") is True,
            f"status={r.status_code}",
        )
        u3 = await find_user(db, email1)
        reset_otp = u3.get("reset_code") if u3 else None
        record(
            "Case 10b: reset_code stored in DB (6-digit)",
            bool(reset_otp) and len(reset_otp) == 6 and reset_otp.isdigit(),
            f"present={bool(reset_otp)}",
        )
        r = await cx.post(
            "/auth/email/forgot",
            json={"email": f"nobody+{uuid.uuid4().hex[:6]}@example.it"},
        )
        record(
            "Case 10c: forgot unknown email still 200 (no enumeration)",
            r.status_code == 200 and r.json().get("ok") is True,
            f"status={r.status_code}",
        )

        # CASE 11: Reset password
        r = await cx.post(
            "/auth/email/reset",
            json={"email": email1, "code": "999999", "password": "BrandNewPass1!"},
        )
        record(
            "Case 11a: reset wrong code → 400",
            r.status_code == 400,
            f"status={r.status_code}",
        )
        new_pwd = "BrandNewPass1!"
        r = await cx.post(
            "/auth/email/reset",
            json={"email": email1, "code": reset_otp, "password": new_pwd},
        )
        record(
            "Case 11b: reset correct code → 200",
            r.status_code == 200 and r.json().get("ok") is True,
            f"status={r.status_code}",
        )
        r = await cx.post("/auth/email/login", json={"email": email1, "password": pwd1})
        record(
            "Case 11c: old password no longer works (401)",
            r.status_code == 401,
            f"status={r.status_code}",
        )
        r = await cx.post(
            "/auth/email/login", json={"email": email1, "password": new_pwd}
        )
        record(
            "Case 11d: new password works",
            r.status_code == 200 and bool(r.json().get("session_token")),
            f"status={r.status_code}",
        )

        # CASE 12: Resend code (with cooldown)
        email_re = f"test+{uuid.uuid4().hex[:8]}@example.it"
        await cx.post(
            "/auth/email/register",
            json={"email": email_re, "password": "ResendTest1!"},
        )
        r = await cx.post(
            "/auth/email/resend-code", json={"email": email_re, "purpose": "verify"}
        )
        record(
            "Case 12a: resend immediately after register → 429",
            r.status_code == 429 and "secondi" in r.text.lower(),
            f"status={r.status_code} body={r.text[:200]}",
        )
        r = await cx.post(
            "/auth/email/resend-code", json={"email": email_re, "purpose": "bogus"}
        )
        record(
            "Case 12b: resend invalid purpose → 400",
            r.status_code == 400,
            f"status={r.status_code} body={r.text[:160]}",
        )
        r = await cx.post(
            "/auth/email/resend-code",
            json={
                "email": f"ghost+{uuid.uuid4().hex[:6]}@example.it",
                "purpose": "verify",
            },
        )
        record(
            "Case 12c: resend unknown email → 200 (no enumeration)",
            r.status_code == 200,
            f"status={r.status_code}",
        )
        await db.users.update_one(
            {"email": email_re},
            {"$unset": {"verification_sent_at": "", "reset_sent_at": ""}},
        )
        prev = await find_user(db, email_re)
        prev_otp = prev.get("verification_code") if prev else None
        r = await cx.post(
            "/auth/email/resend-code", json={"email": email_re, "purpose": "verify"}
        )
        post = await find_user(db, email_re)
        new_otp = post.get("verification_code") if post else None
        record(
            "Case 12d: resend after cooldown clear → 200 + new OTP",
            r.status_code == 200 and bool(new_otp) and new_otp != prev_otp,
            f"status={r.status_code} otp_changed={new_otp != prev_otp}",
        )

        # =========== TELEGRAM STRICT ===========

        # Ensure no telegram_channel for user_demo01
        await db.user_settings.update_one(
            {"user_id": "user_demo01"},
            {"$set": {"telegram_channel": ""}, "$setOnInsert": {"user_id": "user_demo01"}},
            upsert=True,
        )

        # CASE 13a: /telegram/status reports channel_source="none"
        r = await cx.get("/telegram/status", headers=HEADERS_AUTH)
        body = r.json() if r.status_code == 200 else {}
        record(
            "Case 13a: /telegram/status channel_source='none' when no channel",
            r.status_code == 200
            and body.get("channel_source") == "none"
            and body.get("configured") is False,
            f"status={r.status_code} body={body}",
        )

        # CASE 13b: /telegram/publish without channel → 400
        tiny_png_b64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX/AAAZ4gk3"
            "AAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
        )
        r = await cx.post(
            "/telegram/publish",
            headers=HEADERS_AUTH,
            json={
                "image_base64": tiny_png_b64,
                "media_type": "photo",
                "caption": "test",
            },
        )
        record(
            "Case 13b: /telegram/publish without channel → 400 'Canale Telegram non inserito'",
            r.status_code == 400 and "Canale Telegram non inserito" in r.text,
            f"status={r.status_code} body={r.text[:240]}",
        )

        # CASE 14a: PUT /user-settings with telegram channel
        r = await cx.put(
            "/user-settings",
            headers=HEADERS_AUTH,
            json={"telegram_channel": "@frammenti_pe"},
        )
        record(
            "Case 14a: PUT /user-settings telegram_channel='@frammenti_pe' → 200",
            r.status_code == 200 and r.json().get("telegram_channel") == "@frammenti_pe",
            f"status={r.status_code} body={r.text[:240]}",
        )

        # CASE 14b: /telegram/status now reports 'user'
        r = await cx.get("/telegram/status", headers=HEADERS_AUTH)
        body = r.json() if r.status_code == 200 else {}
        record(
            "Case 14b: /telegram/status channel_source='user' after set",
            r.status_code == 200
            and body.get("channel_source") == "user"
            and body.get("configured") is True
            and body.get("channel_id") == "@frammenti_pe",
            f"status={r.status_code} body={body}",
        )

        # Cleanup: revert telegram_channel to empty for downstream tests
        await db.user_settings.update_one(
            {"user_id": "user_demo01"},
            {"$set": {"telegram_channel": ""}},
        )
        r = await cx.get("/telegram/status", headers=HEADERS_AUTH)
        body = r.json() if r.status_code == 200 else {}
        record(
            "Case 14c: cleanup — /telegram/status back to 'none'",
            r.status_code == 200 and body.get("channel_source") == "none",
            f"status={r.status_code} body={body}",
        )

    # =========== Summary ===========
    print("\n" + "=" * 70)
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = total - passed
    print(f"TOTAL: {total}  PASS: {passed}  FAIL: {failed}")
    if failed:
        print("\nFailed cases:")
        for name, ok, info in results:
            if not ok:
                print(f"  - {name}: {info}")
    print("=" * 70)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
