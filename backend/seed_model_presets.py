"""
Seed the `model_presets` MongoDB collection with 15 Caucasian female faces
(age 20-30, Mediterranean + Nordic mix) for the DressVibe face library.

Idempotent: existing presets with the same `id` are replaced. Run with:

    cd /app/backend && python seed_model_presets.py

The faces are generated on-the-fly via Nano Banana (Gemini Image) so we never
ship copyrighted/recognisable people — each face is unique, AI-generated, and
royalty-free. The thumbnail is small (240x360 ~10 KB JPEG) to keep `GET
/api/model-presets` cheap.
"""
from __future__ import annotations
import asyncio
import base64
import io
import os
import sys
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Re-use the image pipeline already wired in server.py — it tries the user's
# Gemini key first, then falls back to the Emergent LLM gateway.
load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import generate_single_image  # noqa: E402  (import after dotenv)

try:
    from PIL import Image  # type: ignore
except ImportError:  # pragma: no cover
    print("Pillow is required. `pip install Pillow`")
    sys.exit(1)


# ---------- Catalog ---------------------------------------------------------
# 15 distinct preset descriptions. Each face_prompt is what gets injected
# into the outfit-generation prompt at use-time, so it has to encode every
# distinguishing trait (hair, eyes, skin tone, face shape, age). All 15 are
# Caucasian women aged 20-30 — a balanced mix of Mediterranean (Italian,
# Spanish, Greek-style) and Nordic (Scandinavian, Northern European) traits.
PRESETS: list[dict] = [
    {
        "id": "preset_sofia",  "name": "Sofia",
        "ethnicity": "mediterranean", "age": 24, "order": 1,
        "face_prompt": (
            "beautiful 24-year-old Italian woman, long dark chocolate-brown wavy hair "
            "loose on the shoulders, warm olive skin, deep brown almond-shaped eyes, "
            "soft oval face, full natural lips, subtle natural makeup, refined "
            "Mediterranean features, gentle confident expression"
        ),
    },
    {
        "id": "preset_bianca", "name": "Bianca",
        "ethnicity": "nordic", "age": 22, "order": 2,
        "face_prompt": (
            "beautiful 22-year-old Scandinavian woman, platinum blonde straight "
            "shoulder-length hair with a center part, very fair porcelain skin, "
            "ice blue eyes, delicate heart-shaped face, high cheekbones, thin "
            "rosy lips, no visible makeup, fresh Nordic look"
        ),
    },
    {
        "id": "preset_aurora", "name": "Aurora",
        "ethnicity": "mediterranean", "age": 26, "order": 3,
        "face_prompt": (
            "beautiful 26-year-old Spanish woman, long auburn chestnut wavy hair, "
            "light olive skin with a warm undertone, bright emerald-green eyes, "
            "soft round face, full natural lips, light freckles on the nose, "
            "warm photogenic smile"
        ),
    },
    {
        "id": "preset_emma",   "name": "Emma",
        "ethnicity": "nordic", "age": 25, "order": 4,
        "face_prompt": (
            "beautiful 25-year-old Northern European woman, ash blonde short pixie "
            "haircut, pale fair skin, light gray eyes, defined square jawline, "
            "minimalist Scandinavian beauty, no makeup, modern clean look"
        ),
    },
    {
        "id": "preset_giulia", "name": "Giulia",
        "ethnicity": "mediterranean", "age": 23, "order": 5,
        "face_prompt": (
            "beautiful 23-year-old Italian woman, jet-black long straight hair gathered "
            "in a low ponytail, warm tan skin, dark espresso-brown eyes, oval face "
            "with refined features, natural rose-tinted lips, elegant Mediterranean look"
        ),
    },
    {
        "id": "preset_freja",  "name": "Freja",
        "ethnicity": "nordic", "age": 27, "order": 6,
        "face_prompt": (
            "beautiful 27-year-old Norwegian woman, long strawberry-blonde curly hair "
            "below the shoulders, fair freckled skin, blue-green eyes, soft oval face, "
            "natural pink cheeks, light freckles across the nose and cheeks, "
            "wholesome Nordic charm"
        ),
    },
    {
        "id": "preset_martina","name": "Martina",
        "ethnicity": "mediterranean", "age": 28, "order": 7,
        "face_prompt": (
            "beautiful 28-year-old Italian woman, medium-length chocolate-brown hair "
            "with subtle caramel highlights, light olive skin, hazel eyes with golden "
            "flecks, diamond-shaped face with high cheekbones, natural full lips, "
            "confident editorial expression"
        ),
    },
    {
        "id": "preset_astrid", "name": "Astrid",
        "ethnicity": "nordic", "age": 24, "order": 8,
        "face_prompt": (
            "beautiful 24-year-old Swedish woman, icy platinum-blonde long straight "
            "hair, very pale skin with cool undertone, intense ice-blue eyes, "
            "sharp angular cheekbones, slim straight nose, minimalist makeup, "
            "modern high-fashion Nordic look"
        ),
    },
    {
        "id": "preset_chiara", "name": "Chiara",
        "ethnicity": "mediterranean", "age": 22, "order": 9,
        "face_prompt": (
            "beautiful 22-year-old Italian woman, dark chestnut hair to the shoulders "
            "with soft waves, warm olive skin, amber-brown eyes, soft oval face, "
            "sun-kissed glow, natural peach-tinted lips, easy youthful smile"
        ),
    },
    {
        "id": "preset_ingrid", "name": "Ingrid",
        "ethnicity": "nordic", "age": 26, "order": 10,
        "face_prompt": (
            "beautiful 26-year-old Danish woman, dirty-blonde shoulder-length hair "
            "with a center part, fair pale skin, light blue eyes, soft round face "
            "with rosy cheeks, no makeup look, calm friendly Scandinavian beauty"
        ),
    },
    {
        "id": "preset_valentina", "name": "Valentina",
        "ethnicity": "mediterranean", "age": 29, "order": 11,
        "face_prompt": (
            "beautiful 29-year-old Italian woman, deep mahogany-brown long sleek "
            "straight hair, smooth olive skin, deep brown eyes, sculpted oval face "
            "with defined cheekbones, natural berry lips, refined high-end Italian "
            "fashion editorial look"
        ),
    },
    {
        "id": "preset_linnea", "name": "Linnea",
        "ethnicity": "nordic", "age": 25, "order": 12,
        "face_prompt": (
            "beautiful 25-year-old Finnish woman, white-blonde long wavy hair, milky "
            "cool-toned skin, gray-blue eyes, defined cheekbones, slim oval face, "
            "minimalist nude makeup, ethereal Nordic appearance"
        ),
    },
    {
        "id": "preset_alessia","name": "Alessia",
        "ethnicity": "mediterranean", "age": 23, "order": 13,
        "face_prompt": (
            "beautiful 23-year-old Italian woman, mahogany red-brown shoulder-length "
            "hair with soft waves, warm olive skin, brown-gold eyes, gentle round "
            "face, natural rose lips, soft warm sun-kissed glow, approachable smile"
        ),
    },
    {
        "id": "preset_sigrid", "name": "Sigrid",
        "ethnicity": "nordic", "age": 27, "order": 14,
        "face_prompt": (
            "beautiful 27-year-old German woman, light brown long hair with caramel "
            "highlights cascading past the shoulders, fair skin, hazel eyes with "
            "green flecks, soft oval face, natural pink lips, refined Central "
            "European look"
        ),
    },
    {
        "id": "preset_beatrice","name": "Beatrice",
        "ethnicity": "mediterranean", "age": 24, "order": 15,
        "face_prompt": (
            "beautiful 24-year-old Italian woman, dark espresso-brown short bob "
            "haircut just above the shoulders, olive skin, dark almond-shaped eyes, "
            "refined oval face with classic Roman features, natural full lips, "
            "elegant chic Italian editorial style"
        ),
    },
]


PORTRAIT_PROMPT_TEMPLATE = (
    "Studio portrait headshot of a {face_prompt}. "
    "FRONT-FACING, looking straight at the camera, neutral expression with a soft hint of smile. "
    "Plain seamless light-gray background. Soft beauty-dish lighting. "
    "STRICT vertical 2:3 portrait framing (head, shoulders and upper chest visible, "
    "head occupies the top half of the frame). Photorealistic skin texture, no plastic skin, "
    "no extra fingers, no jewellery, no logos. Magazine-quality, "
    "Shot on 85mm lens, f/2, professional fashion photography."
)


def make_thumb(image_b64: str, max_size: int = 360, quality: int = 75) -> Optional[str]:
    """Resize the raw PNG to a vertical thumbnail JPEG. Returns base64 (no
    prefix). Returns None on failure (caller falls back to the raw image)."""
    try:
        raw = image_b64.split(",", 1)[-1] if image_b64.startswith("data:") else image_b64
        data = base64.b64decode(raw)
        im = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = im.size
        # Crop to 2:3 portrait if needed
        target_ratio = 2 / 3
        cur_ratio = w / h
        if abs(cur_ratio - target_ratio) > 0.01:
            if cur_ratio > target_ratio:
                # too wide → crop sides
                new_w = int(h * target_ratio)
                left = (w - new_w) // 2
                im = im.crop((left, 0, left + new_w, h))
            else:
                # too tall → crop top/bottom (keep upper portion: head)
                new_h = int(w / target_ratio)
                top = max(0, (h - new_h) // 4)  # bias toward upper
                im = im.crop((0, top, w, top + new_h))
        # Scale to max_size on the long edge
        im.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as e:
        print(f"  [thumb] failed: {e}")
        return None


async def generate_face(preset: dict) -> Optional[str]:
    """Call Nano Banana to generate a face portrait. Returns base64 PNG."""
    prompt = PORTRAIT_PROMPT_TEMPLATE.format(face_prompt=preset["face_prompt"])
    session_id = f"seed_face_{preset['id']}"
    try:
        # No reference images — we want the AI to invent the face from scratch
        img = await generate_single_image(prompt, [], session_id)
        return img
    except Exception as e:
        print(f"  [gen] failed for {preset['id']}: {e}")
        return None


async def main():
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        print("MONGO_URL not configured in backend/.env")
        sys.exit(1)
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ.get("DB_NAME", "dressvibe")]

    total = len(PRESETS)
    print(f"== Seeding {total} model presets ==")
    ok = 0
    skipped = 0
    failed = []

    # Skip presets that already have a thumbnail (idempotent re-run).
    existing_ids = {
        d["id"]
        for d in await db.model_presets.find(
            {"thumb_base64": {"$exists": True, "$ne": None}}, {"_id": 0, "id": 1}
        ).to_list(1000)
    }

    for idx, preset in enumerate(PRESETS, 1):
        if preset["id"] in existing_ids:
            print(f"[{idx:2}/{total}] {preset['name']:10} — already seeded, skip")
            skipped += 1
            continue

        print(f"[{idx:2}/{total}] {preset['name']:10} — generating…", flush=True)
        face_b64 = await generate_face(preset)
        if not face_b64:
            print(f"           ✗ generation failed")
            failed.append(preset["id"])
            # small pause to avoid hammering the free tier on transient errors
            await asyncio.sleep(2)
            continue

        thumb = make_thumb(face_b64)
        if not thumb:
            print(f"           ⚠ thumb failed, storing raw bytes")
            thumb = face_b64

        doc = {
            "id": preset["id"],
            "name": preset["name"],
            "gender": "female",
            "ethnicity": preset["ethnicity"],
            "age": preset["age"],
            "order": preset["order"],
            "face_prompt": preset["face_prompt"],
            "thumb_base64": thumb,
            "active": True,
            "created_at": datetime.now(timezone.utc),
        }
        await db.model_presets.update_one(
            {"id": preset["id"]},
            {"$set": doc},
            upsert=True,
        )
        ok += 1
        print(f"           ✓ saved (thumb={len(thumb)//1024} KB)")
        # gentle rate-limit guard for Gemini free tier (~5 req/min)
        await asyncio.sleep(8)

    print(f"\n== Done: {ok} created, {skipped} skipped, {len(failed)} failed ==")
    if failed:
        print("Failed ids:", ", ".join(failed))
        print("Re-run the script to retry just the failed ones.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
