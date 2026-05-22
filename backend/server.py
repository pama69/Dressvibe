from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
    ROME_TZ = ZoneInfo("Europe/Rome")
except Exception:
    ROME_TZ = timezone(timedelta(hours=1))  # fallback CET

def now_rome() -> datetime:
    """Return current datetime in Europe/Rome timezone."""
    return datetime.now(ROME_TZ)

def fmt_rome(fmt: str = "%d/%m/%Y %H:%M") -> str:
    """Return formatted current datetime in Europe/Rome timezone."""
    return now_rome().strftime(fmt)

import httpx
import base64

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from providers import list_providers, get_provider, default_provider

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHANNEL_ID = os.environ.get('TELEGRAM_CHANNEL_ID', '')
# TELEGRAM_ADMIN_CHAT_ID was used to forward callback_query "PRENOTA" clicks
# to a single global admin chat. The flow has been replaced with an inline
# URL button that opens the public landing page directly, so this variable
# is no longer used anywhere in the code.
TELEGRAM_WEBHOOK_SECRET = os.environ.get('TELEGRAM_WEBHOOK_SECRET', '')
PUBLIC_BASE_URL = os.environ.get('PUBLIC_BASE_URL', '')
TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

XAI_API_KEY = os.environ.get('XAI_API_KEY', '')
XAI_API_BASE = "https://api.x.ai/v1"

# Optional: shop-owner-provided Gemini API key. When set, we route both text
# (Instagram captions, etc.) and image generation (Nano Banana) DIRECTLY to
# Google's official Gemini API instead of going through the Emergent LLM gateway
# (which has a shared budget). Free tier on AI Studio is generous.
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '').strip()
GEMINI_TEXT_MODEL = os.environ.get('GEMINI_TEXT_MODEL', 'gemini-flash-latest')
# Image generation: try the newest Nano Banana first, falling back across models
# if a specific one is overloaded (503) or unavailable.
GEMINI_IMAGE_MODEL_CHAIN = [
    m.strip() for m in os.environ.get(
        'GEMINI_IMAGE_MODEL_CHAIN',
        'gemini-3.1-flash-image-preview,nano-banana-pro-preview,gemini-3-pro-image-preview,gemini-2.5-flash-image',
    ).split(',') if m.strip()
]
GEMINI_IMAGE_MODEL = GEMINI_IMAGE_MODEL_CHAIN[0] if GEMINI_IMAGE_MODEL_CHAIN else 'gemini-3.1-flash-image-preview'

_gemini_client = None
if GEMINI_API_KEY:
    try:
        from google import genai as _google_genai
        _gemini_client = _google_genai.Client(api_key=GEMINI_API_KEY)
    except Exception as _e:  # pragma: no cover - defensive
        logging.getLogger("server").warning(f"Gemini client init failed: {_e}")
        _gemini_client = None

app = FastAPI(title="DressVibe API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# =================== Models ===================
class SessionCreate(BaseModel):
    session_id: str  # one-time from emergent redirect


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime


class GarmentCreate(BaseModel):
    name: str
    image_base64: str  # without prefix
    category: str  # t-shirt, pantaloni, vestito, giacca, etc.
    color: Optional[str] = None
    size: Optional[str] = None
    price: Optional[float] = None
    season: Optional[str] = None  # primavera/estate/autunno/inverno
    gender: Optional[str] = None  # uomo/donna/unisex


class Garment(BaseModel):
    id: str
    user_id: str
    name: str
    image_base64: str
    category: str
    color: Optional[str] = None
    size: Optional[str] = None
    price: Optional[float] = None
    season: Optional[str] = None
    gender: Optional[str] = None
    created_at: datetime


class BackgroundCreate(BaseModel):
    name: str
    image_base64: str  # without prefix
    description: Optional[str] = None  # short, e.g. "boutique vetrina sera"


class GenerationCreate(BaseModel):
    garment_ids: List[str]
    model_gender: str  # uomo/donna/ragazzo/ragazza
    model_age: str  # giovane/adulto/maturo
    model_body: str  # slim/atletico/curvy
    model_ethnicity: str  # caucasica/africana/asiatica/latina/mediorientale
    pose: str  # casual_standing/dynamic_walking/sitting_elegant/street_style/mirror_selfie
    background: str  # white_studio/city_street/beach/inside_shop/lifestyle_home
    shoes: str = "comoda_fashion"  # alta_elegante/comoda_fashion/scarpa_bassa
    num_variations: int = 4
    title: Optional[str] = None
    provider: Optional[str] = None  # image_gen provider id; None = default
    custom_background_id: Optional[str] = None  # if set, overrides `background`
    look_styles: Optional[List[str]] = None  # optional aesthetic modifiers (warm/depth/vivid/dynamic/premium)
    add_price_tags: bool = False  # opt-in: when True, garment "Descrizione e prezzi" names are used to overlay price tags in the photo


class Generation(BaseModel):
    id: str
    user_id: str
    garment_ids: List[str]
    title: Optional[str] = None
    params: dict
    images: List[str]  # base64 strings
    status: str  # pending/done/failed
    created_at: datetime


class StudioEditRequest(BaseModel):
    image_base64: str
    edit_prompt: str  # what to do (change background to beach, add price text, etc.)
    gen_id: Optional[str] = None  # if provided, append the edited image to that generation's gallery
    provider: Optional[str] = None  # image_edit provider id; None = default
    add_price_tags: bool = False  # if True, append price tag instruction using descriptions from the source generation's garments


class VideoGenerateRequest(BaseModel):
    """Generate a fashion video clip from a base reference image."""
    image_base64: str
    prompt: Optional[str] = None  # extra instructions; default fashion prompt is applied
    duration_seconds: int = 5  # 3-8
    provider: Optional[str] = None  # required video_gen provider id
    gen_id: Optional[str] = None
    image_index: Optional[int] = None


class VirtualClientCreate(BaseModel):
    name: str
    model_gender: str
    model_age: str
    model_body: str
    model_ethnicity: str
    notes: Optional[str] = None


class CaptionRequest(BaseModel):
    garment_name: str
    category: str
    price: Optional[float] = None
    style: str = "instagram"  # instagram/casual/elegante


# =================== Auth helpers ===================
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication")
    token = authorization.replace("Bearer ", "", 1).strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# =================== Routes ===================
@api_router.get("/")
async def root():
    return {"message": "DressVibe API", "status": "ok"}


# Lightweight, no-auth endpoint dedicated to external uptime monitors.
# Hit this URL every 5 minutes from cron-job.org / UptimeRobot / similar
# to prevent the deployed container from being suspended for inactivity.
@api_router.get("/health")
async def health():
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


# ---------- Auth ----------
@api_router.post("/auth/session")
async def create_session(payload: SessionCreate):
    """Verify the one-time session_id with Emergent, persist user + session."""
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(
            EMERGENT_AUTH_SESSION_URL,
            headers={"X-Session-ID": payload.session_id},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session id")
    data = resp.json()
    email = data["email"].lower().strip()
    name = data.get("name", email.split("@")[0])
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc),
        })

    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return user


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "", 1).strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Garments ----------
@api_router.post("/garments")
async def create_garment(payload: GarmentCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    doc = {
        "id": f"g_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name": payload.name,
        "image_base64": payload.image_base64,
        "category": payload.category,
        "color": payload.color,
        "size": payload.size,
        "price": payload.price,
        "season": payload.season,
        "gender": payload.gender,
        "created_at": datetime.now(timezone.utc),
    }
    await db.garments.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.get("/garments")
async def list_garments(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.garments.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return items


@api_router.get("/garments/{garment_id}")
async def get_garment(garment_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    item = await db.garments.find_one(
        {"id": garment_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Garment not found")
    return item


@api_router.delete("/garments/{garment_id}")
async def delete_garment(garment_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.garments.delete_one({"id": garment_id, "user_id": user["user_id"]})
    return {"deleted": res.deleted_count}


# ---------- Custom Backgrounds ----------
@api_router.post("/backgrounds")
async def create_background(payload: BackgroundCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    name = (payload.name or "").strip() or "Sfondo personalizzato"
    bg_id = f"bg_{uuid.uuid4().hex[:12]}"
    doc = {
        "id": bg_id,
        "user_id": user["user_id"],
        "name": name[:80],
        "description": (payload.description or "").strip()[:160] or None,
        "image_base64": payload.image_base64,
        "created_at": datetime.now(timezone.utc),
    }
    await db.backgrounds.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.get("/backgrounds")
async def list_backgrounds(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.backgrounds.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return items


@api_router.delete("/backgrounds/{bg_id}")
async def delete_background(bg_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.backgrounds.delete_one({"id": bg_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sfondo non trovato")
    return {"ok": True}


# ---------- Generation prompt building ----------
GENDER_IT = {
    "uomo": "an adult male model",
    "donna": "an adult female model",
    "ragazzo": "a young male model in his early 20s",
    "ragazza": "a young female model in her early 20s",
}
AGE_IT = {
    "giovane": "young, around 22 years old",
    "adulto": "adult, around 32 years old",
    "maturo": "mature, around 50 years old",
}
BODY_IT = {
    "slim": "slim and slender body type",
    "atletico": "athletic and toned body type",
    "curvy": "curvy and natural body type",
}
ETHNICITY_IT = {
    "caucasica": "Caucasian features",
    "africana": "African features",
    "asiatica": "East Asian features",
    "latina": "Latin American features",
    "mediorientale": "Middle Eastern features",
}
POSE_IT = {
    "casual_standing": "standing casually facing the camera, relaxed posture",
    "dynamic_walking": "walking dynamically toward the camera with movement",
    "sitting_elegant": "sitting elegantly on a stool, refined posture",
    "street_style": "candid street-style pose, hand in pocket, looking aside",
    "mirror_selfie": "taking a mirror selfie with a smartphone",
}
BACKGROUND_IT = {
    "white_studio": "minimalist white photo studio background with soft lighting",
    "city_street": "fashionable European city street with bokeh background",
    "beach": "sunny beach at golden hour with soft sea bokeh",
    "inside_shop": "inside a chic clothing boutique with warm lighting",
    "lifestyle_home": "warm lifestyle home interior with natural window light",
}
SHOES_IT = {
    "alta_elegante": "elegant high-heeled shoes that match the outfit",
    "comoda_fashion": "comfortable fashionable sneakers or trendy flat shoes that match the outfit",
    "scarpa_bassa": "minimal low-cut flat shoes (ballerinas, loafers or low boots) that match the outfit",
}

# Optional aesthetic modifiers selectable from the generation UI. The prompts
# are appended verbatim to the main outfit prompt to nudge Gemini toward a
# specific photographic look. Provided in Italian by the shop owner; Gemini
# handles multilingual prompts natively.
LOOK_STYLES_PROMPTS = {
    "warm": (
        ", fotografia realistica con illuminazione naturale calda e morbida da finestra laterale, "
        "luce dorata delicata che crea volume sul corpo e sui tessuti, ombre leggere e naturali, "
        "profondità realistica, stile lifestyle elegante"
    ),
    "depth": (
        ", scattata da angolazione leggermente bassa e di tre quarti, prospettiva naturale che slancia la figura, "
        "sfocatura leggera sullo sfondo (bokeh delicato), ottima profondità di campo, look professionale e moderno"
    ),
    "vivid": (
        ", colori vividi e fedeli ai tessuti con contrasto equilibrato, tonalità ricche ma realistiche, "
        "luce diffusa che fa risaltare la trama dei tessuti, atmosfera fresca e commerciale, qualità fotografica premium"
    ),
    "dynamic": (
        ", posa naturale con leggero movimento (capelli o tessuto che si muove delicatamente), "
        "energia positiva e fluida, luce naturale, sensazione di vita reale senza esagerare, stile editoriale pulito"
    ),
    "premium": (
        ", ambientazione minimal con sfondo neutro leggermente sfocato, illuminazione da studio elegante ma calda, "
        "composizione bilanciata, look da catalogo di moda alto di gamma, molto appetibile per social"
    ),
}


import re

def build_outfit_prompt(
    p: GenerationCreate,
    variation_idx: int,
    custom_bg_label: Optional[str] = None,
    price_descriptions: Optional[List[str]] = None,
) -> str:
    gender = GENDER_IT.get(p.model_gender, p.model_gender)
    age = AGE_IT.get(p.model_age, p.model_age)
    body = BODY_IT.get(p.model_body, p.model_body)
    eth = ETHNICITY_IT.get(p.model_ethnicity, p.model_ethnicity)
    pose = POSE_IT.get(p.pose, p.pose)
    bg = BACKGROUND_IT.get(p.background, p.background)
    shoes = SHOES_IT.get(p.shoes, p.shoes)

    if custom_bg_label:
        background_instruction = (
            f"The LAST reference image is the EXACT background/scene to use ({custom_bg_label}). "
            f"Place the model inside that exact scene preserving its lighting, colors, perspective and mood. "
            f"Do NOT use the model from that reference, only the environment."
        )
    else:
        background_instruction = f"Setting: {bg}."

    return (
        f"Create a hyper-realistic, high-end fashion editorial photograph of {gender}, "
        f"{age}, with {eth}, {body}. "
        f"FULL BODY SHOT from head to feet, the entire figure must be visible including the shoes and the floor under them. "
        f"The model is wearing EXACTLY the clothing items shown in the reference images, "
        f"preserving every detail: color, pattern, texture, cut, logo, prints. "
        f"Footwear: {shoes}. "
        f"Pose: {pose}. {background_instruction} "
        f"Shot with a 35mm lens, soft natural lighting, magazine-quality, "
        f"sharp focus on the entire outfit, photorealistic skin tones, no plastic skin, no extra fingers, "
        f"correct anatomy with both feet on the ground. "
        f"STRICT vertical 4:5 aspect ratio (portrait, ratio 1080x1350 — the native Instagram feed format). "
        f"The composition must fit the model fully inside the 4:5 frame with comfortable margins on top and bottom. "
        f"Variation seed {variation_idx}."
        f"{_compose_price_tags_suffix(price_descriptions)}"
        f"{_compose_look_styles_suffix(p.look_styles)}"
    )


# Regex used to detect auto-generated placeholder names (e.g. "Cap 4521").
# When a garment's name matches this pattern it means the shop owner did NOT
# provide a real description/price list, so we do NOT inject a price-tag
# instruction into the AI prompt.
_AUTO_NAME_RE = re.compile(r"^Cap\s+\d{3,5}$", re.IGNORECASE)


def is_real_description(name: Optional[str]) -> bool:
    """Return True if `name` looks like a real shop description (e.g.
    "Vestito €59, pantalone €67") rather than the auto-generated "Cap NNNN"
    placeholder used by the upload flow when the user leaves the field blank.
    """
    if not name:
        return False
    s = name.strip()
    if not s:
        return False
    return not _AUTO_NAME_RE.match(s)


def _compose_price_tags_suffix(descriptions: Optional[List[str]]) -> str:
    """Append a price-tag instruction in English to the outfit prompt.

    The shop owner can type descriptions like "Vestito €59, pantalone €67" in
    the upload form. When at least one selected garment has such a real
    description, we tell Gemini to overlay tasteful price tags on the final
    image, each placed next to the matching garment.
    """
    real = [d.strip() for d in (descriptions or []) if d and d.strip()]
    if not real:
        return ""
    joined = " | ".join(real)
    return (
        f" Garment descriptions and prices provided by the shop owner: {joined}. "
        f"Render clear, well-visible price tags (like boutique price labels) inside the photo, "
        f"placed close to the corresponding garment they refer to (price for the dress next to the dress, "
        f"price for the trousers near the trousers, etc.). "
        f"Each tag must show the EXACT prices listed above, with a clean modern sans-serif font, "
        f"bold and easy to read at a glance, with a strongly contrasting color against the surrounding background "
        f"(e.g. white tag with dark text on dark fabric, or dark tag with white text on light fabric). "
        f"Make the tags noticeably visible — bigger than a discreet boutique label but NOT oversized "
        f"or intrusive: they should cover at most ~6-8% of the photo width each. "
        f"Use a clean rectangular shape with subtle rounded corners, no logos, no watermarks, no extra graphics. "
        f"Position the tags so they do NOT cover the model's face, hands, or the key parts of the outfit."
    )


def _compose_look_styles_suffix(look_styles: Optional[List[str]]) -> str:
    """Append the selected aesthetic-style snippets (in Italian) to the prompt."""
    if not look_styles:
        return ""
    parts: List[str] = []
    for sid in look_styles:
        snippet = LOOK_STYLES_PROMPTS.get(sid)
        if snippet:
            parts.append(snippet.strip())
    if not parts:
        return ""
    # Each snippet already starts with ", " — join naturally.
    return " " + " ".join(parts)


def pad_to_instagram_45(image_b64: str) -> str:
    """Ensure the image fits Instagram's feed natively (4:5 portrait).

    Strategy: smart CENTER CROP (no blurred letterbox, no white bars). We only
    remove pixels from the source image's edges to reach the 4:5 ratio. The
    final asset is then scaled up/down so its short side is exactly 1080 (the
    Instagram-recommended width) → output ≈ 1080×1350.

    This is the same approach Instagram itself uses when you upload a non-4:5
    image, and it preserves the model/subject because for fashion shots the
    subject is centered in the frame.

    If the image is already very close to 4:5 we return it untouched.
    """
    if not image_b64:
        return image_b64
    try:
        from PIL import Image
        from io import BytesIO

        raw = base64.b64decode(image_b64)
        src = Image.open(BytesIO(raw)).convert("RGB")
        w, h = src.size
        if w <= 0 or h <= 0:
            return image_b64
        cur = w / h
        target = 4 / 5  # 0.8
        # Already close to 4:5 — leave it alone (still scale to 1080 width
        # for consistency if it's larger than that)
        if abs(cur - target) < 0.02:
            out_img = src
        elif cur < target:
            # Taller than 4:5 (e.g. 9:16) → crop top + bottom equally.
            # For fashion shots we bias the crop SLIGHTLY toward the upper
            # portion (face/upper body matter more than excess background
            # near the feet).
            new_h = int(round(w / target))
            crop_total = h - new_h
            # 40% from top, 60% from bottom → keeps feet, trims sky.
            top = int(round(crop_total * 0.4))
            out_img = src.crop((0, top, w, top + new_h))
        else:
            # Wider than 4:5 → crop sides equally (center-anchored).
            new_w = int(round(h * target))
            left = (w - new_w) // 2
            out_img = src.crop((left, 0, left + new_w, h))

        # Normalize output size to the Instagram recommendation 1080×1350.
        target_w = 1080
        target_h = 1350
        if out_img.size != (target_w, target_h):
            out_img = out_img.resize((target_w, target_h), Image.LANCZOS)

        out = BytesIO()
        out_img.save(out, format="PNG", optimize=True)
        return base64.b64encode(out.getvalue()).decode("ascii")
    except Exception as e:
        logging.getLogger("server").warning(f"pad_to_instagram_45 (crop) failed: {e}")
        return image_b64


async def _gemini_direct_generate_image(
    prompt: str, reference_images_b64: List[str]
) -> Optional[str]:
    """Use the shop owner's personal Gemini API key — bypasses Emergent budget.

    Tries each model in GEMINI_IMAGE_MODEL_CHAIN until one succeeds. Each model
    is retried up to 3 times with exponential backoff on transient 503 errors.
    """
    if not _gemini_client:
        return None
    from google.genai import types as _gtypes

    parts: list = []
    for b64 in reference_images_b64:
        try:
            raw = base64.b64decode(b64)
            parts.append(_gtypes.Part.from_bytes(data=raw, mime_type="image/png"))
        except Exception:
            continue
    parts.append(_gtypes.Part.from_text(text=prompt))

    loop = asyncio.get_running_loop()

    def _try_one(model_name: str) -> Optional[str]:
        try:
            resp = _gemini_client.models.generate_content(
                model=model_name,
                contents=parts,
            )
            for c in (getattr(resp, "candidates", None) or []):
                content = getattr(c, "content", None)
                for p in (getattr(content, "parts", []) or []):
                    inline = getattr(p, "inline_data", None)
                    if inline and getattr(inline, "data", None):
                        raw = inline.data
                        if isinstance(raw, bytes):
                            return base64.b64encode(raw).decode("ascii")
                        if isinstance(raw, str):
                            return raw  # already base64
            return None
        except Exception as exc:
            # Re-raise so the caller can see the error / pick the next model
            raise exc

    last_err: Optional[Exception] = None
    # Track if the LAST seen error was specifically a rate-limit (429) — this is
    # account-wide on Gemini's free tier so retrying immediately on other models
    # rarely helps. We fail fast with a clear marker on the exception message
    # so the caller can surface a friendly 429 to the user.
    rate_limited = False
    # Limit total wall-clock time we're willing to spend here: 25s for a single
    # image keeps the user's perceived wait reasonable.
    import time as _time
    started = _time.monotonic()
    HARD_BUDGET_SECONDS = 25.0

    for model_idx, model_name in enumerate(GEMINI_IMAGE_MODEL_CHAIN or [GEMINI_IMAGE_MODEL]):
        # Only try a max of 2 models — beyond that the latency gets unreasonable
        # and rate limits are usually account-wide anyway.
        if model_idx >= 2:
            break
        # Each model gets up to 2 attempts (1 retry) with short backoff.
        for attempt in range(2):
            if _time.monotonic() - started > HARD_BUDGET_SECONDS:
                logger.warning(f"[Gemini-direct] budget exceeded ({HARD_BUDGET_SECONDS}s), aborting")
                break
            try:
                img = await loop.run_in_executor(None, _try_one, model_name)
                if img:
                    if attempt > 0 or model_idx > 0:
                        logger.info(f"[Gemini-direct] image OK via {model_name} (attempt {attempt + 1})")
                    return img
                logger.warning(f"[Gemini-direct] {model_name} returned no image, trying next model")
                break
            except Exception as e:
                last_err = e
                msg = str(e)
                is_rate_limit = (
                    "429" in msg or "RESOURCE_EXHAUSTED" in msg
                    or "quota" in msg.lower() or "rate limit" in msg.lower()
                )
                is_transient = (
                    "503" in msg or "UNAVAILABLE" in msg
                    or "overload" in msg.lower() or "high demand" in msg.lower()
                )
                if is_rate_limit:
                    rate_limited = True
                    # Account-wide limit → switching models rarely helps. Bail fast.
                    logger.warning(f"[Gemini-direct] {model_name} RATE LIMIT (429): {msg[:160]}")
                    break  # go to next model (one more try, then give up)
                if is_transient and attempt == 0:
                    # Short backoff for 503-style overload, only 1 retry.
                    import random as _rnd
                    backoff = 1.5 + _rnd.uniform(0, 1.0)
                    logger.warning(f"[Gemini-direct] {model_name} transient (try 1/2): {msg[:120]}; retry in {backoff:.1f}s")
                    await asyncio.sleep(backoff)
                    continue
                # Hard error or out of retries → next model
                logger.warning(f"[Gemini-direct] {model_name} error, skipping: {msg[:200]}")
                break

    if last_err:
        logger.error(f"[Gemini-direct] all models failed, last: {str(last_err)[:300]}")
    # Signal rate-limit via a sentinel exception attached attribute so the caller
    # can choose to surface HTTP 429 instead of a generic failure.
    if rate_limited and last_err is not None:
        try:
            setattr(last_err, "_dv_rate_limited", True)
        except Exception:
            pass
        raise last_err
    return None


async def generate_single_image(prompt: str, reference_images_b64: List[str], session_id: str) -> Optional[str]:
    """Generate a single image. Raises HTTPException(429) if hard-rate-limited.

    The returned base64 PNG is guaranteed to fit Instagram's feed natively
    (4:5 portrait) — if the upstream model returns a different ratio (e.g.
    9:16) we pad it with a blurred copy of itself so nothing gets cropped.
    """
    raw_img = await _generate_single_image_raw(prompt, reference_images_b64, session_id)
    if not raw_img:
        return None
    # CPU-bound PIL work → push to executor so we don't block the loop
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, pad_to_instagram_45, raw_img)


async def _generate_single_image_raw(prompt: str, reference_images_b64: List[str], session_id: str) -> Optional[str]:
    """Internal: returns the raw upstream image without post-processing."""
    rate_limit_hit = False
    # Prefer the shop-owner's personal Gemini key when configured.
    if _gemini_client:
        try:
            img = await _gemini_direct_generate_image(prompt, reference_images_b64)
            if img:
                return img
        except Exception as e:
            if getattr(e, "_dv_rate_limited", False):
                rate_limit_hit = True
                logger.warning("[Gemini-direct] hit rate limit, will try Emergent fallback once")
            else:
                logger.warning(f"[Gemini-direct] failed (non-rate-limit): {str(e)[:200]}")
        if not rate_limit_hit:
            logger.warning("[Gemini-direct] returned no image, falling back to Emergent gateway")

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_id,
            system_message="You are an expert fashion photographer and AI image generator.",
        ).with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

        msg = UserMessage(
            text=prompt,
            file_contents=[ImageContent(b64) for b64 in reference_images_b64],
        )
        _text, images = await chat.send_message_multimodal_response(msg)
        if images and len(images) > 0:
            return images[0]["data"]
    except Exception as e:
        emsg = str(e)
        # Emergent budget exhausted? Don't waste retries.
        if "Budget has been exceeded" in emsg or "budget" in emsg.lower():
            logger.warning(f"Emergent budget exhausted: {emsg[:150]}")
        else:
            logger.exception(f"Image generation failed via Emergent: {e}")

    # If we got here AFTER a rate-limit on the personal key, raise 429 so the
    # frontend can show a friendly "wait ~30s" message instead of a generic fail.
    if rate_limit_hit:
        raise HTTPException(
            status_code=429,
            detail="Limite Gemini raggiunto. Aspetta ~30-60 secondi e riprova.",
        )
    return None


# ---------- Generations ----------
@api_router.post("/generations")
async def create_generation(payload: GenerationCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)

    if not payload.garment_ids:
        raise HTTPException(status_code=400, detail="Seleziona almeno un capo")
    num = max(1, min(8, payload.num_variations))

    garments = await db.garments.find(
        {"id": {"$in": payload.garment_ids}, "user_id": user["user_id"]}, {"_id": 0}
    ).to_list(20)
    if not garments:
        raise HTTPException(status_code=404, detail="Capi non trovati")
    refs = [g["image_base64"] for g in garments]

    # Collect real (non-auto-placeholder) descriptions from the selected
    # garments — but ONLY if the user explicitly opted in via the
    # "Inserisci prezzi nell'immagine" checkbox. Without the opt-in,
    # the prompt is unchanged and no price tags are rendered.
    price_descriptions: List[str] = []
    if payload.add_price_tags:
        price_descriptions = [
            g["name"] for g in garments if is_real_description(g.get("name"))
        ]

    # Custom background: append its image as the LAST reference and pass label to prompt.
    custom_bg_label: Optional[str] = None
    if payload.custom_background_id:
        bg = await db.backgrounds.find_one(
            {"id": payload.custom_background_id, "user_id": user["user_id"]},
            {"_id": 0},
        )
        if bg and bg.get("image_base64"):
            refs.append(bg["image_base64"])
            custom_bg_label = bg.get("description") or bg.get("name") or "custom background"

    gen_id = f"gen_{uuid.uuid4().hex[:12]}"
    gen_doc = {
        "id": gen_id,
        "user_id": user["user_id"],
        "garment_ids": payload.garment_ids,
        "title": payload.title or f"Generazione del {fmt_rome('%d/%m %H:%M')}",
        "params": payload.dict(exclude={"garment_ids", "title"}),
        "images": [],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
    }
    await db.generations.insert_one(gen_doc.copy())

    # Run variations with limited concurrency to avoid hammering Gemini's
    # rate limit (free tier ~5 req/min for image models). 2 in parallel is a
    # sweet spot. We collect exceptions instead of letting them tear down the
    # whole gather so we can surface a clean 429 to the client.
    sem = asyncio.Semaphore(2)

    async def _bounded(i: int):
        async with sem:
            return await generate_single_image(
                build_outfit_prompt(payload, i, custom_bg_label, price_descriptions),
                refs,
                f"{gen_id}_{i}",
            )

    tasks = [_bounded(i) for i in range(num)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    images: list = []
    rate_limit_hit = False
    other_error: Optional[str] = None
    for r in results:
        if isinstance(r, HTTPException):
            if r.status_code == 429:
                rate_limit_hit = True
            else:
                other_error = str(r.detail)
        elif isinstance(r, Exception):
            other_error = str(r)[:160]
        elif r:
            images.append(r)

    status = "done" if images else ("rate_limited" if rate_limit_hit else "failed")
    await db.generations.update_one(
        {"id": gen_id},
        {"$set": {"images": images, "status": status}},
    )

    # If we got nothing back AND we hit a rate limit, raise 429 so the frontend
    # can show a clear "wait a minute" message instead of an infinite spinner.
    if not images and rate_limit_hit:
        raise HTTPException(
            status_code=429,
            detail="Limite Gemini raggiunto. Aspetta ~30-60 secondi e riprova.",
        )
    if not images and other_error:
        raise HTTPException(status_code=502, detail=f"Generazione fallita: {other_error}")

    gen_doc["images"] = images
    gen_doc["status"] = status
    gen_doc.pop("_id", None)
    return gen_doc


@api_router.get("/generations")
async def list_generations(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.generations.find(
        {"user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    # Strip images for list view to keep response light
    for it in items:
        it["image_count"] = len(it.get("images", []))
        it["thumbnail"] = it["images"][0] if it.get("images") else None
        it.pop("images", None)
    return items


@api_router.get("/generations/{gen_id}")
async def get_generation(gen_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    item = await db.generations.find_one(
        {"id": gen_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Generazione non trovata")
    return item


@api_router.delete("/generations/{gen_id}")
async def delete_generation(gen_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.generations.delete_one({"id": gen_id, "user_id": user["user_id"]})
    return {"deleted": res.deleted_count}


@api_router.delete("/generations/{gen_id}/images/{index}")
async def delete_generation_image(gen_id: str, index: int, authorization: Optional[str] = Header(None)):
    """Remove a single image (by zero-based index) from a generation's gallery."""
    user = await get_current_user(authorization)
    gen = await db.generations.find_one(
        {"id": gen_id, "user_id": user["user_id"]}, {"_id": 0, "images": 1}
    )
    if not gen:
        raise HTTPException(status_code=404, detail="Generazione non trovata")
    images = gen.get("images") or []
    if index < 0 or index >= len(images):
        raise HTTPException(status_code=400, detail="Indice immagine non valido")
    images.pop(index)
    await db.generations.update_one(
        {"id": gen_id, "user_id": user["user_id"]},
        {"$set": {"images": images}},
    )
    return {"deleted": 1, "remaining": len(images)}


# ---------- Studio (image edit) ----------
@api_router.post("/studio/edit")
async def studio_edit(payload: StudioEditRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    session_id = f"studio_{user['user_id']}_{uuid.uuid4().hex[:6]}"

    # Optional: if the shop owner ticked "Inserisci prezzi nell'immagine" in
    # the Studio, look up the source generation's garments to find real
    # descriptions (e.g. "Vestito €59, pantalone €67") and append a price-tag
    # instruction to the prompt.
    price_suffix = ""
    if payload.add_price_tags and payload.gen_id:
        gen = await db.generations.find_one(
            {"id": payload.gen_id, "user_id": user["user_id"]},
            {"_id": 0, "garment_ids": 1},
        )
        if gen and gen.get("garment_ids"):
            garments = await db.garments.find(
                {"id": {"$in": gen["garment_ids"]}, "user_id": user["user_id"]},
                {"_id": 0, "name": 1},
            ).to_list(50)
            descriptions = [g["name"] for g in garments if is_real_description(g.get("name"))]
            price_suffix = _compose_price_tags_suffix(descriptions)

    prompt = (
        f"Edit the provided photograph as requested while keeping the model, outfit, and overall composition identical. "
        f"Preserve the full-body framing (head to feet) and the 4:5 vertical aspect ratio (Instagram feed). "
        f"Request: {payload.edit_prompt}. "
        f"Keep photorealistic quality, high-end fashion photography aesthetic."
        f"{price_suffix}"
    )
    result = await generate_single_image(prompt, [payload.image_base64], session_id)
    if not result:
        raise HTTPException(status_code=502, detail="Modifica non riuscita, riprova")
    # If linked to a generation, append the edited image to that generation's gallery
    if payload.gen_id:
        await db.generations.update_one(
            {"id": payload.gen_id, "user_id": user["user_id"]},
            {"$push": {"images": result}},
        )
    return {"image_base64": result}


# ---------- Virtual Clients ----------
@api_router.post("/clients")
async def create_client(payload: VirtualClientCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    doc = {
        "id": f"c_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name": payload.name,
        "model_gender": payload.model_gender,
        "model_age": payload.model_age,
        "model_body": payload.model_body,
        "model_ethnicity": payload.model_ethnicity,
        "notes": payload.notes,
        "created_at": datetime.now(timezone.utc),
    }
    await db.virtual_clients.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.get("/clients")
async def list_clients(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.virtual_clients.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return items


@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.virtual_clients.delete_one({"id": client_id, "user_id": user["user_id"]})
    return {"deleted": res.deleted_count}


# ---------- Caption generator ----------
@api_router.post("/caption")
async def generate_caption(payload: CaptionRequest, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"cap_{uuid.uuid4().hex[:8]}",
            system_message="Sei un esperto di marketing per negozi di moda italiani. Scrivi caption Instagram brevi, eleganti e accattivanti in italiano, con emoji misurate e 4-6 hashtag in italiano.",
        ).with_model("gemini", "gemini-3.1-flash-image-preview")
        price_part = f" Il prezzo è {payload.price}€." if payload.price else ""
        msg = UserMessage(
            text=(
                f"Crea una caption Instagram in italiano per questo capo: '{payload.garment_name}' "
                f"(categoria: {payload.category}).{price_part} Stile: {payload.style}. "
                f"Massimo 2 frasi più gli hashtag su una riga separata."
            )
        )
        text, _images = await chat.send_message_multimodal_response(msg)
        return {"caption": (text or "").strip()}
    except Exception as e:
        logger.exception(f"Caption error: {e}")
        # graceful fallback
        return {
            "caption": (
                f"✨ {payload.garment_name} — disponibile in negozio!\n"
                f"#moda #stile #fashion #shoplocal #italianstyle"
            )
        }


# ---------- Categorise helper ----------
CATEGORIES = ["t-shirt", "camicia", "pantaloni", "jeans", "vestito", "gonna", "giacca", "cappotto", "maglione", "felpa", "scarpe", "accessorio"]


@api_router.get("/categories")
async def get_categories():
    return {"categories": CATEGORIES}


# ---------- Stats ----------
@api_router.get("/stats")
async def stats(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {
        "garments": await db.garments.count_documents({"user_id": user["user_id"]}),
        "generations": await db.generations.count_documents({"user_id": user["user_id"]}),
        "clients": await db.virtual_clients.count_documents({"user_id": user["user_id"]}),
    }


# =================== Providers (multi-AI) ===================
@api_router.get("/providers")
async def providers(authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    return list_providers()


# =================== Video generation ===================
FASHION_VIDEO_PROMPT = (
    "Fashion editorial video of the same person from the reference photo, "
    "wearing the same exact outfit. They perform natural fluid movements: "
    "a slow 360-degree turn showing the outfit from every angle, then a confident "
    "walk toward the camera with subtle smile and hand-on-hip pose. "
    "Cinematic camera, soft natural lighting, vertical 9:16 aspect ratio, "
    "full body always visible from head to feet, no morphing, photorealistic, "
    "no extra fingers, anatomically correct."
)


# ---------- Instagram Caption (AI) ----------
class InstagramCaptionRequest(BaseModel):
    gen_id: Optional[str] = None
    image_index: Optional[int] = None
    media_type: str = "photo"  # "photo" | "video"
    style: str = "elegante"  # elegante | friendly | minimal | trendy
    shop_name: Optional[str] = "Frammenti"
    city: Optional[str] = "Pescara"
    extra_hint: Optional[str] = None  # e.g. "saldi -30%" or "nuova collezione"


STYLE_DIRECTIVES = {
    "elegante": (
        "Tono: caldo, evocativo, sartoriale, da boutique di ricerca. "
        "Frasi corte, italiano forbito ma accessibile. Niente marketing aggressivo. "
        "Emoji rari (max 2) e pertinenti."
    ),
    "friendly": (
        "Tono: amichevole, parlato, come se la commessa raccontasse il capo a una cliente fidata. "
        "Italiano colloquiale, qualche emoji caldo (3-4)."
    ),
    "minimal": (
        "Tono: minimal, essenziale, due righe brevi. Italiano asciutto. Zero emoji o uno solo."
    ),
    "trendy": (
        "Tono: trendy / Gen-Z italiana, vibe Instagram editoriale. "
        "Emoji giusti (4-5), può usare termini in inglese se naturali (vibe, mood, slay, outfit del giorno)."
    ),
}


@api_router.post("/instagram/caption")
async def generate_instagram_caption(payload: InstagramCaptionRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)

    # Try to enrich context from the generation if provided
    ctx_parts: List[str] = []
    if payload.gen_id:
        gen = await db.generations.find_one(
            {"id": payload.gen_id, "user_id": user["user_id"]},
            {"_id": 0, "params": 1, "garment_ids": 1, "title": 1},
        )
        if gen:
            params = gen.get("params") or {}
            for k in ("model_gender", "model_age", "model_body", "model_ethnicity", "pose", "background", "shoes"):
                v = params.get(k)
                if v:
                    ctx_parts.append(f"{k}={v}")
            if gen.get("garment_ids"):
                grms = await db.garments.find(
                    {"id": {"$in": gen["garment_ids"]}, "user_id": user["user_id"]},
                    {"_id": 0, "name": 1, "category": 1, "color": 1, "season": 1},
                ).to_list(10)
                for g in grms:
                    bits = [g.get("name"), g.get("category"), g.get("color"), g.get("season")]
                    ctx_parts.append("capo=" + " ".join([b for b in bits if b]))

    shop = (payload.shop_name or "Frammenti").strip()
    city = (payload.city or "Pescara").strip()
    style = (payload.style or "elegante").lower()
    style_directive = STYLE_DIRECTIVES.get(style, STYLE_DIRECTIVES["elegante"])
    media = "Reel video 9:16" if payload.media_type == "video" else "foto outfit"
    extra = f"\nNota extra: {payload.extra_hint.strip()}" if (payload.extra_hint and payload.extra_hint.strip()) else ""
    ctx_line = " · ".join(ctx_parts) if ctx_parts else "(nessun dettaglio aggiuntivo)"

    system_msg = (
        "Sei un copywriter italiano specializzato in moda e boutique indipendenti. "
        "Scrivi caption per Instagram pensate per piccole boutique italiane (negozi fisici), non e-commerce di massa. "
        "Devi sempre rispondere SOLO in italiano e SOLO in JSON valido, nessun testo intorno."
    )

    user_prompt = (
        f"Boutique: {shop} — {city}, Italia.\n"
        f"Contenuto da pubblicare: {media}.\n"
        f"Contesto del look: {ctx_line}.{extra}\n\n"
        f"Stile della caption: {style_directive}\n\n"
        "Costruisci una caption pronta da incollare su Instagram con questa struttura:\n"
        "  1. Riga 1 — hook breve ed evocativo (max 60 caratteri)\n"
        "  2. 1-2 frasi che descrivono mood/capo (italiano scorrevole, non da venditore)\n"
        "  3. CTA naturale (esempi: 'Disponibile da Frammenti, in via [vuoto].',"
        "     'Passa in boutique a Pescara o scrivici in DM 💬', 'Prenota la prova in negozio')\n"
        "  4. Riga vuota\n"
        f"  5. 18 hashtag italiani pertinenti: mix di brand ({shop}), categoria del capo, "
        f"     città ({city} / Abruzzo), stagione, mood, e 2-3 hashtag boutique italiani famosi "
        "     (es. #boutiqueitaliana #modaitaliana #shoplocal #madeinitaly). Niente hashtag in inglese generici "
        "     (#fashion #ootd ok ma massimo 4). Tutti su una riga separati da spazio.\n\n"
        "Ritorna SOLO JSON con questa forma esatta:\n"
        "{\n"
        '  "caption": "testo completo pronto da incollare (incluso il blocco hashtag in fondo)",\n'
        '  "hashtags": ["lista", "di", "hashtag", "senza", "cancelletto"],\n'
        '  "hook": "riga 1"\n'
        "}\n"
        "Non aggiungere markdown, niente ```json, niente spiegazioni."
    )

    try:
        if _gemini_client:
            # Use the shop owner's personal Gemini key — no Emergent budget consumed
            loop = asyncio.get_running_loop()
            resp = await loop.run_in_executor(
                None,
                lambda: _gemini_client.models.generate_content(
                    model=GEMINI_TEXT_MODEL,
                    contents=f"{system_msg}\n\n{user_prompt}",
                ),
            )
            text = (getattr(resp, "text", None) or "").strip()
        else:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"ig_caption_{user['user_id']}_{uuid.uuid4().hex[:6]}",
                system_message=system_msg,
            ).with_model("gemini", "gemini-2.5-flash")
            msg = UserMessage(text=user_prompt)
            reply = await chat.send_message(msg)
            text = (reply or "").strip()
        # Strip eventual markdown fences just in case
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        import json as _json
        try:
            data = _json.loads(text)
        except Exception:
            # Last-resort: try to extract first {...}
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                data = _json.loads(text[start:end + 1])
            else:
                raise
        caption = (data.get("caption") or "").strip()
        hashtags = data.get("hashtags") or []
        hook = (data.get("hook") or "").strip()
        if not caption:
            raise ValueError("empty caption")
        return {"caption": caption, "hashtags": hashtags, "hook": hook, "style": style}
    except Exception as e:
        logger.exception(f"Instagram caption generation failed: {e}")
        # Fallback static caption so the UI never blocks
        fallback = (
            f"Nuovo arrivo da {shop} ✨\n"
            f"Un capo pensato per chi cerca dettagli che fanno la differenza.\n"
            f"Passa in boutique a {city} o scrivici in DM 💬\n\n"
            f"#{shop.lower()} #{shop.lower()}{city.lower()} #boutique{city.lower()} "
            "#boutiqueitaliana #modaitaliana #shoplocal #madeinitaly #abruzzo "
            "#ootditalia #stileitaliano #fashionitalia #lookdelgiorno #stilesartoriale "
            "#nuovoarrivo #nuovacollezione #moda #fashion #outfit #fashionstyle"
        )
        return {"caption": fallback, "hashtags": [], "hook": "Nuovo arrivo", "style": style, "fallback": True}




@api_router.post("/videos")
async def create_video(payload: VideoGenerateRequest, request: Request, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    # Always derive the public base URL from the *incoming* request — this
    # makes Grok Video work both in preview and in the deployed environment
    # (where PUBLIC_BASE_URL in .env is still the preview URL).
    fwd_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or ""
    ).split(",")[0].strip()
    fwd_proto = request.headers.get("x-forwarded-proto")
    if not fwd_proto:
        # If the request hits us behind the k8s ingress the scheme arrives
        # as http on the internal side, but the external URL is https. Default
        # to https for anything that isn't localhost so xAI accepts the URL.
        fwd_proto = "http" if fwd_host.startswith("localhost") or fwd_host.startswith("127.") else "https"
    public_base = f"{fwd_proto}://{fwd_host}" if fwd_host else PUBLIC_BASE_URL
    provider_id = payload.provider or default_provider("video_gen")
    if not provider_id:
        raise HTTPException(
            status_code=503,
            detail="Nessun provider video configurato. Aggiungi una chiave API (Google VEO, Kling o xAI) per abilitare la generazione video.",
        )
    p = get_provider("video_gen", provider_id)
    if not p:
        raise HTTPException(status_code=400, detail=f"Provider video '{provider_id}' sconosciuto")
    if not p["enabled"]:
        raise HTTPException(
            status_code=503,
            detail=f"Provider '{p['name']}' non configurato. Manca: {', '.join(p['missing_keys'])}.",
        )

    # Build the fashion prompt
    final_prompt = (payload.prompt or "").strip() or FASHION_VIDEO_PROMPT

    if provider_id == "grok_video":
        # 1. Store the reference image in MongoDB with a public token
        token = uuid.uuid4().hex[:14]
        await db.temp_images.insert_one({
            "token": token,
            "user_id": user["user_id"],
            "image_base64": payload.image_base64,
            "created_at": datetime.now(timezone.utc),
            # auto-expires via TTL index
        })
        image_url = f"{public_base}/api/temp-image/{token}"

        # 2. Call xAI Grok Video (image-to-video)
        try:
            async with httpx.AsyncClient(timeout=30.0) as http:
                start_resp = await http.post(
                    f"{XAI_API_BASE}/videos/generations",
                    headers={"Authorization": f"Bearer {XAI_API_KEY}", "Content-Type": "application/json"},
                    json={
                        "model": "grok-imagine-video",
                        "prompt": final_prompt,
                        "image": {"url": image_url},
                        "duration": max(3, min(15, payload.duration_seconds)),
                        "aspect_ratio": "9:16",
                    },
                )
            if start_resp.status_code != 200:
                logger.error(f"xAI start error {start_resp.status_code}: {start_resp.text}")
                raise HTTPException(status_code=502, detail=f"xAI start error: {start_resp.text[:300]}")
            start_data = start_resp.json()
            request_id = start_data.get("request_id") or start_data.get("id")
            if not request_id:
                raise HTTPException(status_code=502, detail=f"xAI: no request_id in response: {start_data}")

            # 3. Poll for completion
            video_url = None
            for _ in range(60):  # up to ~3 minutes (60 * 3s)
                await asyncio.sleep(3)
                async with httpx.AsyncClient(timeout=20.0) as http:
                    poll = await http.get(
                        f"{XAI_API_BASE}/videos/{request_id}",
                        headers={"Authorization": f"Bearer {XAI_API_KEY}"},
                    )
                if poll.status_code != 200:
                    continue
                pd = poll.json()
                status = (pd.get("status") or "").lower()
                if status in ("succeeded", "completed", "done"):
                    video_url = pd.get("url") or pd.get("video_url") or (pd.get("video") or {}).get("url")
                    break
                if status in ("failed", "error", "cancelled"):
                    raise HTTPException(status_code=502, detail=f"xAI generation failed: {pd}")
            if not video_url:
                raise HTTPException(status_code=504, detail="Timeout: video non pronto entro 3 minuti")
        finally:
            # Cleanup temp image regardless
            try:
                await db.temp_images.delete_one({"token": token})
            except Exception:
                pass

        # 4. Download the video bytes immediately — xAI URLs expire after a few
        # hours, so we self-host the file (served via /api/videos/{id}/file).
        video_bytes_b64: Optional[str] = None
        try:
            async with httpx.AsyncClient(timeout=120.0) as http:
                vr = await http.get(video_url)
                if vr.status_code == 200 and len(vr.content) < 14 * 1024 * 1024:
                    video_bytes_b64 = base64.b64encode(vr.content).decode("ascii")
                    logger.info(f"[VID] archived {video_id_for_log if False else 'pending'} bytes={len(vr.content)}")
                else:
                    logger.warning(f"[VID] could not archive video status={vr.status_code} size={len(vr.content)}")
        except Exception as e:
            logger.warning(f"[VID] archive download failed: {e}")

        # 5. Persist the video doc (with archived bytes if we got them)
        video_id = f"vid_{uuid.uuid4().hex[:12]}"
        doc = {
            "id": video_id,
            "user_id": user["user_id"],
            "provider": provider_id,
            "gen_id": payload.gen_id,
            "image_index": payload.image_index,
            "video_url": video_url,
            "video_b64": video_bytes_b64,  # None if download failed
            "archived": bool(video_bytes_b64),
            "duration_seconds": payload.duration_seconds,
            "prompt": final_prompt,
            "created_at": datetime.now(timezone.utc),
        }
        await db.videos.insert_one(doc.copy())
        # Don't leak the heavy bytes in the response
        doc.pop("_id", None)
        doc.pop("video_b64", None)
        # Tell the client our self-hosted playback url
        doc["playback_url"] = f"/api/videos/{video_id}/file" if video_bytes_b64 else video_url
        return doc

    raise HTTPException(
        status_code=501,
        detail=f"Implementazione provider '{p['name']}' in arrivo. Forniscimi la chiave API e completo l'integrazione.",
    )


@api_router.get("/temp-image/{token}")
async def serve_temp_image(token: str):
    """Serve a temporarily stored base64 image as binary so external AI providers
    (e.g., xAI Grok Video) can fetch it as image_url. Public on purpose — token
    is single-use & random."""
    from fastapi.responses import Response
    doc = await db.temp_images.find_one({"token": token}, {"_id": 0, "image_base64": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    data = base64.b64decode(doc["image_base64"])
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store"})


@api_router.get("/videos")
async def list_videos(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.videos.find(
        {"user_id": user["user_id"]}, {"_id": 0, "video_data": 0}
    ).sort("created_at", -1).to_list(200)
    return items


@api_router.get("/generations/{gen_id}/videos")
async def list_generation_videos(gen_id: str, request: Request, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.videos.find(
        {"user_id": user["user_id"], "gen_id": gen_id},
        {"_id": 0, "video_b64": 0, "prompt": 0},
    ).sort("created_at", 1).to_list(200)

    # Inject playback_url: self-hosted when archived, otherwise fall back to xAI URL
    fwd_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    fwd_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or ""
    ).split(",")[0].strip()
    base = f"{fwd_proto}://{fwd_host}" if fwd_host else ""

    # Also infer "archived" from presence of video_b64 in DB (without sending bytes)
    ids = [it["id"] for it in items]
    archived_ids: set = set()
    if ids:
        async for d in db.videos.find(
            {"id": {"$in": ids}, "video_b64": {"$exists": True, "$ne": None}}, {"_id": 0, "id": 1}
        ):
            archived_ids.add(d["id"])

    for it in items:
        if it["id"] in archived_ids:
            it["archived"] = True
            it["playback_url"] = f"{base}/api/videos/{it['id']}/file" if base else f"/api/videos/{it['id']}/file"
        else:
            it["archived"] = False
            it["playback_url"] = it.get("video_url")
    return items


@api_router.get("/videos/{video_id}/file")
async def serve_archived_video(video_id: str):
    """Serve the archived MP4 bytes for a video. Public on purpose so the
    HTML5/native video player can fetch it without sending Auth headers."""
    doc = await db.videos.find_one({"id": video_id}, {"_id": 0, "video_b64": 1})
    if not doc or not doc.get("video_b64"):
        raise HTTPException(status_code=404, detail="Video non disponibile (non archiviato)")
    try:
        data = base64.b64decode(doc["video_b64"])
    except Exception:
        raise HTTPException(status_code=500, detail="Video corrotto")
    return Response(
        content=data,
        media_type="video/mp4",
        headers={
            "Content-Length": str(len(data)),
            "Cache-Control": "public, max-age=86400",
            "Accept-Ranges": "bytes",
        },
    )


@api_router.delete("/videos/{video_id}")
async def delete_video(video_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.videos.delete_one({"id": video_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Video non trovato")
    return {"ok": True}


# =================== Telegram ===================
    image_base64: str
    caption: Optional[str] = None
    gen_id: Optional[str] = None
    image_index: Optional[int] = None


async def tg_api(method: str, payload: dict, files: Optional[dict] = None):
    async with httpx.AsyncClient(timeout=30.0) as http:
        if files:
            resp = await http.post(f"{TELEGRAM_API}/{method}", data=payload, files=files)
        else:
            resp = await http.post(f"{TELEGRAM_API}/{method}", json=payload)
    try:
        return resp.status_code, resp.json()
    except Exception:
        return resp.status_code, {"raw": resp.text}

class TelegramPublishRequest(BaseModel):
    image_base64: Optional[str] = None
    video_url: Optional[str] = None
    media_type: Optional[str] = "photo"  # "photo" | "video"
    caption: Optional[str] = None
    gen_id: Optional[str] = None
    image_index: Optional[int] = None




@api_router.post("/telegram/publish")
async def telegram_publish(payload: TelegramPublishRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram non configurato (token mancante)")

    # Per-user channel override; falls back to the env default
    us = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    channel_id = (us.get("telegram_channel") or "").strip() or TELEGRAM_CHANNEL_ID
    if not channel_id:
        raise HTTPException(status_code=503, detail="Nessun canale Telegram configurato. Imposta il canale nel Profilo.")

    media_type = (payload.media_type or "photo").lower()
    if media_type == "video":
        if not payload.video_url:
            raise HTTPException(status_code=400, detail="video_url richiesto per pubblicare un video")
    else:
        if not payload.image_base64:
            raise HTTPException(status_code=400, detail="image_base64 richiesto per pubblicare una foto")

    token = uuid.uuid4().hex[:14]
    caption = (payload.caption or "").strip() or "Disponibile in negozio ✨"
    if len(caption) > 1000:
        caption = caption[:1000] + "…"

    # Build (or reuse) the public landing-page URL for this photo. Pressing
    # the "RICHIEDI INFO" button on Telegram now opens the SAME landing page
    # used by the WhatsApp share flow — the customer can then either contact
    # the shop owner on WhatsApp (number configured in the owner's profile)
    # or submit an in-app info request. The previous callback_query/PRENOTA
    # flow has been removed.
    landing_url: Optional[str] = None
    if payload.gen_id is not None and payload.image_index is not None:
        # Validate ownership before generating a link
        owner_gen = await db.generations.find_one(
            {"id": payload.gen_id, "user_id": user["user_id"]},
            {"_id": 0, "images": 1, "title": 1},
        )
        if owner_gen:
            existing_sl = await db.short_links.find_one(
                {"user_id": user["user_id"], "gen_id": payload.gen_id, "image_index": payload.image_index},
                {"_id": 0, "short_id": 1, "tiny_url": 1},
            )
            if existing_sl:
                short_id_for_url = existing_sl["short_id"]
            else:
                # Mint a fresh short id (retry on extremely unlikely collision)
                short_id_for_url = ""
                for _ in range(8):
                    cand = _gen_short_id(6)
                    if not await db.short_links.find_one({"short_id": cand}):
                        short_id_for_url = cand
                        break
                if short_id_for_url:
                    await db.short_links.insert_one({
                        "short_id": short_id_for_url,
                        "user_id": user["user_id"],
                        "gen_id": payload.gen_id,
                        "image_index": payload.image_index,
                        "look_name": (owner_gen.get("title") or "Look").strip()[:120],
                        "tiny_url": None,
                        "created_at": datetime.now(timezone.utc),
                    })
            if short_id_for_url:
                base = (PUBLIC_BASE_URL or "").rstrip("/")
                if base:
                    landing_url = f"{base}/api/r/{short_id_for_url}"

    # Compose the inline keyboard. We prefer a URL button (opens the landing
    # page directly in the customer's browser) over the legacy callback_data
    # button, so no Telegram webhook round-trip is needed any more.
    if landing_url:
        keyboard = {
            "inline_keyboard": [[
                {"text": "RICHIEDI INFO", "url": landing_url}
            ]]
        }
    else:
        # Fallback: if we couldn't mint a landing URL (e.g. PUBLIC_BASE_URL
        # missing in env), publish without an inline button rather than
        # falling back to the deprecated callback flow.
        logger.warning(
            f"[TG-PUB] could not mint landing URL for gen={payload.gen_id} "
            f"idx={payload.image_index} — publishing without inline button"
        )
        keyboard = None

    import json as _json
    file_id: Optional[str] = None
    # Telegram rejects reply_markup="null" — only include the key when we
    # actually have a keyboard object to attach.
    reply_markup_str: Optional[str] = _json.dumps(keyboard) if keyboard is not None else None

    if media_type == "video":
        # Try URL-mode first. Telegram itself downloads from the URL.
        data = {
            "chat_id": channel_id,
            "video": payload.video_url,
            "caption": caption,
            "supports_streaming": True,
        }
        if reply_markup_str:
            data["reply_markup"] = reply_markup_str
        status, body = await tg_api("sendVideo", data)
        if status != 200 or not body.get("ok"):
            # Fallback: download the video and upload as multipart.
            try:
                async with httpx.AsyncClient(timeout=120.0) as http:
                    vr = await http.get(payload.video_url)
                if vr.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Impossibile scaricare il video sorgente ({vr.status_code})")
                files = {"video": ("clip.mp4", vr.content, "video/mp4")}
                up_data = {
                    "chat_id": channel_id,
                    "caption": caption,
                    "supports_streaming": "true",
                }
                if reply_markup_str:
                    up_data["reply_markup"] = reply_markup_str
                status, body = await tg_api("sendVideo", up_data, files=files)
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Telegram sendVideo fallback failed: {e}")
                raise HTTPException(status_code=502, detail=f"Telegram error: {body.get('description', 'sendVideo failed')}")

            if status != 200 or not body.get("ok"):
                logger.error(f"Telegram sendVideo error {status}: {body}")
                raise HTTPException(status_code=502, detail=f"Telegram error: {body.get('description', 'sendVideo failed')}")

        result = body["result"]
        message_id = result["message_id"]
        if result.get("video"):
            file_id = result["video"].get("file_id")
    else:
        photo_bytes = base64.b64decode(payload.image_base64)
        files = {"photo": ("outfit.png", photo_bytes, "image/png")}
        data = {
            "chat_id": channel_id,
            "caption": caption,
        }
        if reply_markup_str:
            data["reply_markup"] = reply_markup_str
        status, body = await tg_api("sendPhoto", data, files=files)
        if status != 200 or not body.get("ok"):
            logger.error(f"Telegram sendPhoto error {status}: {body}")
            raise HTTPException(status_code=502, detail=f"Telegram error: {body.get('description', 'sendPhoto failed')}")

        result = body["result"]
        message_id = result["message_id"]
        if result.get("photo"):
            file_id = result["photo"][-1]["file_id"]

    await db.tg_publications.insert_one({
        "token": token,
        "user_id": user["user_id"],
        "gen_id": payload.gen_id,
        "image_index": payload.image_index,
        "media_type": media_type,
        "channel_id": channel_id,
        "channel_message_id": message_id,
        "caption": caption,
        "file_id": file_id,
        "created_at": datetime.now(timezone.utc),
    })
    return {"ok": True, "channel_message_id": message_id, "token": token, "media_type": media_type}


@api_router.post("/telegram/setup-webhook")
async def telegram_setup_webhook(request: Request, authorization: Optional[str] = Header(None)):
    """
    Re-binds Telegram bot webhook to the *current* deployed host. This is critical
    because PUBLIC_BASE_URL is baked at preview time and does not auto-update when
    the app is deployed under a different domain. Calling this endpoint from the
    deployed frontend uses the inbound Host header to point Telegram at the right
    place.
    """
    user = await get_current_user(authorization)
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Telegram non configurato (token/secret mancanti)")

    # Pick the host that the client actually used to reach us (works behind the
    # k8s ingress because the ingress forwards the public host).
    fwd_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    fwd_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or ""
    ).split(",")[0].strip()
    if not fwd_host:
        raise HTTPException(status_code=400, detail="Impossibile determinare l'host pubblico")

    base = f"{fwd_proto}://{fwd_host}"
    webhook_url = f"{base}/api/telegram/webhook/{TELEGRAM_WEBHOOK_SECRET}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(
                f"{TELEGRAM_API}/setWebhook",
                json={
                    "url": webhook_url,
                    "allowed_updates": ["message", "channel_post", "callback_query"],
                    "drop_pending_updates": False,
                },
            )
            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"raw": resp.text}
            ok = bool(body.get("ok"))
            logger.info(f"[TG] setup-webhook by user={user['user_id']} url={webhook_url} ok={ok} body={body}")
            if not ok:
                raise HTTPException(status_code=502, detail=f"Telegram error: {body}")
        # Also fetch current webhook info for the response so the UI can show it
        async with httpx.AsyncClient(timeout=15.0) as http:
            info = await http.get(f"{TELEGRAM_API}/getWebhookInfo")
            info_body = info.json() if info.headers.get("content-type", "").startswith("application/json") else {}
        return {
            "ok": True,
            "webhook_url": webhook_url,
            "info": info_body.get("result", {}),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"setup-webhook failed: {e}")
        raise HTTPException(status_code=502, detail=f"setup-webhook failed: {e}")


@api_router.get("/telegram/webhook-info")
async def telegram_webhook_info(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram non configurato")
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            info = await http.get(f"{TELEGRAM_API}/getWebhookInfo")
            body = info.json()
        return {"ok": True, "info": body.get("result", {}), "user_id": user["user_id"]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"webhook-info failed: {e}")




@api_router.post("/telegram/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request):
    if not TELEGRAM_WEBHOOK_SECRET or secret != TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    update = await request.json()
    # Diagnostic logging: capture forwarded messages (to discover real channel IDs)
    try:
        msg = update.get("message") or update.get("channel_post") or {}
        if msg:
            await db.tg_updates_log.insert_one({
                "raw": update,
                "received_at": datetime.now(timezone.utc),
            })
            fwd = msg.get("forward_from_chat") or msg.get("forward_origin", {}).get("chat")
            if fwd:
                logger.info(f"[TG-DIAG] forwarded from chat id={fwd.get('id')} title={fwd.get('title')} type={fwd.get('type')}")
            elif msg.get("chat"):
                logger.info(f"[TG-DIAG] direct message from chat id={msg['chat'].get('id')} type={msg['chat'].get('type')} title={msg['chat'].get('title')}")
    except Exception as e:
        logger.warning(f"diag log failed: {e}")

    cq = update.get("callback_query")
    if cq:
        # Legacy callback_query handler ("book:<token>" / "PRENOTA") has been
        # removed. Newly published posts use a direct URL inline button that
        # opens the public landing page, so no callback round-trip is needed.
        # We still ack any stray callback to avoid the Telegram client showing
        # a perpetual loading spinner on old posts.
        try:
            await tg_api("answerCallbackQuery", {
                "callback_query_id": cq["id"],
                "text": "Apri il link 'RICHIEDI INFO' aggiornato per continuare.",
                "show_alert": False,
            })
        except Exception as e:
            logger.warning(f"[TG-CB] legacy ack failed: {e}")
    return {"ok": True}


@api_router.get("/telegram/status")
async def telegram_status(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    settings = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    return {
        "configured": bool(TELEGRAM_BOT_TOKEN and (settings.get("telegram_channel") or TELEGRAM_CHANNEL_ID)),
        "channel_id": settings.get("telegram_channel") or TELEGRAM_CHANNEL_ID if TELEGRAM_BOT_TOKEN else None,
        "channel_source": "user" if settings.get("telegram_channel") else "default",
    }


# =================== Short Links + Public "Richiesta Info" page ===================
import secrets as _secrets
import string as _string
from fastapi.responses import HTMLResponse, Response as FAResponse
import html as _html


def _gen_short_id(length: int = 6) -> str:
    alphabet = _string.ascii_letters + _string.digits
    return "".join(_secrets.choice(alphabet) for _ in range(length))


class ShortLinkCreate(BaseModel):
    gen_id: str
    image_index: int = 0
    look_name: Optional[str] = None  # human-friendly display name


class InfoRequestPublicCreate(BaseModel):
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    message: Optional[str] = None


@api_router.post("/short-links")
async def create_short_link(payload: ShortLinkCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    # Verify the generation belongs to the user
    gen = await db.generations.find_one({"id": payload.gen_id, "user_id": user["user_id"]}, {"_id": 0})
    if not gen:
        raise HTTPException(status_code=404, detail="Generazione non trovata")
    images = gen.get("images") or []
    if payload.image_index < 0 or payload.image_index >= len(images):
        raise HTTPException(status_code=400, detail="Indice immagine non valido")

    # Reuse an existing short link for the same (gen, image) if any → idempotent
    existing = await db.short_links.find_one(
        {"user_id": user["user_id"], "gen_id": payload.gen_id, "image_index": payload.image_index},
        {"_id": 0},
    )
    if existing:
        # If we have an existing record but it doesn't have a tiny URL yet
        # (e.g. created before this feature shipped, or tinyurl was down),
        # try to generate one now and persist it.
        if not existing.get("tiny_url"):
            base = (PUBLIC_BASE_URL or "").rstrip("/")
            full_url = f"{base}/api/r/{existing['short_id']}" if base else f"/api/r/{existing['short_id']}"
            tiny = await _shorten_with_tinyurl(full_url)
            if tiny:
                await db.short_links.update_one(
                    {"short_id": existing["short_id"]},
                    {"$set": {"tiny_url": tiny}},
                )
                existing["tiny_url"] = tiny
        return _short_link_response(existing)

    # Generate a unique short id (retry if collision)
    short_id = ""
    for _ in range(8):
        candidate = _gen_short_id(6)
        if not await db.short_links.find_one({"short_id": candidate}):
            short_id = candidate
            break
    if not short_id:
        raise HTTPException(status_code=500, detail="Impossibile generare short id")

    base = (PUBLIC_BASE_URL or "").rstrip("/")
    full_url = f"{base}/api/r/{short_id}" if base else f"/api/r/{short_id}"
    # Best-effort shortening via TinyURL (no key, free, generous limits).
    # If it fails the caller still gets the full public_url so the flow keeps
    # working — never breaks the user-facing share button.
    tiny_url = await _shorten_with_tinyurl(full_url)

    doc = {
        "short_id": short_id,
        "user_id": user["user_id"],
        "gen_id": payload.gen_id,
        "image_index": payload.image_index,
        "look_name": (payload.look_name or gen.get("title") or "Look").strip()[:120],
        "tiny_url": tiny_url,
        "created_at": datetime.now(timezone.utc),
    }
    await db.short_links.insert_one(doc.copy())
    return _short_link_response(doc)


async def _shorten_with_tinyurl(long_url: str) -> Optional[str]:
    """Call the free TinyURL endpoint. Returns the short URL or None on failure.
    No API key needed. Times out fast so we don't block the UI."""
    if not long_url or not long_url.startswith(("http://", "https://")):
        return None
    try:
        async with httpx.AsyncClient(timeout=4.0) as http:
            r = await http.get(
                "https://tinyurl.com/api-create.php",
                params={"url": long_url},
            )
            if r.status_code == 200:
                short = r.text.strip()
                # Sanity check: must look like a URL we can trust
                if short.startswith(("https://tinyurl.com/", "http://tinyurl.com/")):
                    # Always serve over HTTPS
                    return short.replace("http://", "https://", 1)
            logger.warning(f"[tinyurl] non-200 or unexpected body: {r.status_code} {r.text[:80]}")
    except Exception as e:
        logger.warning(f"[tinyurl] failed: {e}")
    return None


def _short_link_response(doc: dict) -> dict:
    base = (PUBLIC_BASE_URL or "").rstrip("/")
    short_id = doc["short_id"]
    full_url = f"{base}/api/r/{short_id}" if base else f"/api/r/{short_id}"
    return {
        "short_id": short_id,
        "look_name": doc.get("look_name"),
        # Long, canonical public URL (always works, even if TinyURL is down)
        "public_url": full_url,
        # Short, paste-friendly URL when available
        "tiny_url": doc.get("tiny_url") or None,
    }


@api_router.get("/r/{short_id}", response_class=HTMLResponse)
async def public_richiesta_info_page(short_id: str):
    """Mobile-first landing page shown when a customer taps the WhatsApp link."""
    sl = await db.short_links.find_one({"short_id": short_id}, {"_id": 0})
    if not sl:
        return HTMLResponse(_render_404_page(), status_code=404)
    # Load the shop owner's WhatsApp Business phone (for the "Chiedi su WA" button)
    owner_settings = await db.user_settings.find_one({"user_id": sl["user_id"]}, {"_id": 0}) or {}
    shop_phone_e164 = (owner_settings.get("whatsapp_business_phone") or "").strip()
    shop_name = (owner_settings.get("shop_name") or "").strip() or "Frammenti"
    base = (PUBLIC_BASE_URL or "").rstrip("/")
    image_url = f"{base}/api/r/{short_id}/image" if base else f"/api/r/{short_id}/image"
    # Prefer the short tinyurl in the wa.me message body — looks much nicer
    # when the customer's phone shows the auto-composed text, and the link
    # preview is identical (tinyurl just redirects). Fall back to the long
    # canonical URL when tinyurl wasn't generated (e.g. legacy short links).
    public_page_url = sl.get("tiny_url") or (f"{base}/api/r/{short_id}" if base else f"/api/r/{short_id}")
    return HTMLResponse(_render_landing_page(
        short_id=short_id,
        look_name=sl.get("look_name") or "Look",
        image_url=image_url,
        shop_phone_e164=shop_phone_e164,
        shop_name=shop_name,
        public_page_url=public_page_url,
    ))


@api_router.get("/r/{short_id}/image")
async def public_richiesta_info_image(short_id: str):
    sl = await db.short_links.find_one({"short_id": short_id}, {"_id": 0})
    if not sl:
        raise HTTPException(status_code=404, detail="Not found")
    gen = await db.generations.find_one({"id": sl["gen_id"]}, {"_id": 0})
    if not gen:
        raise HTTPException(status_code=404, detail="Not found")
    images = gen.get("images") or []
    idx = sl.get("image_index", 0)
    if idx >= len(images):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        raw = base64.b64decode(images[idx])
    except Exception:
        raise HTTPException(status_code=500, detail="Bad image data")
    return FAResponse(content=raw, media_type="image/png", headers={
        "Cache-Control": "public, max-age=3600",
    })


@api_router.post("/r/{short_id}/info-request")
async def public_submit_info_request(short_id: str, payload: InfoRequestPublicCreate, request: Request):
    sl = await db.short_links.find_one({"short_id": short_id}, {"_id": 0})
    if not sl:
        raise HTTPException(status_code=404, detail="Link non valido")
    name = (payload.customer_name or "").strip()[:80]
    phone = (payload.phone or "").strip()[:40]
    message = (payload.message or "").strip()[:600]
    # Sanity: require at least one of (name, phone, message) so we don't store
    # totally empty rows from accidental presses.
    if not (name or phone or message):
        raise HTTPException(status_code=400, detail="Inserisci almeno un dato (nome, telefono o messaggio).")

    doc = {
        "id": f"req_{uuid.uuid4().hex[:12]}",
        "user_id": sl["user_id"],
        "short_id": short_id,
        "gen_id": sl["gen_id"],
        "image_index": sl.get("image_index", 0),
        "look_name": sl.get("look_name") or "Look",
        "customer_name": name or None,
        "phone": phone or None,
        "message": message or None,
        "source": "whatsapp",
        "status": "new",
        "client_ip": (request.client.host if request.client else None),
        "user_agent": (request.headers.get("user-agent") or "")[:200],
        "created_at": datetime.now(timezone.utc),
    }
    await db.info_requests.insert_one(doc.copy())
    return {"ok": True}


# -------- Owner (authenticated) endpoints --------
@api_router.get("/info-requests")
async def list_info_requests(
    only_new: bool = False,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    q: dict = {"user_id": user["user_id"]}
    if only_new:
        q["status"] = "new"
    items = await db.info_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api_router.get("/info-requests/unread-count")
async def info_requests_unread_count(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    n = await db.info_requests.count_documents({"user_id": user["user_id"]
                                                 , "status": "new"})
    return {"count": n}


@api_router.post("/info-requests/{req_id}/read")
async def mark_info_request_read(req_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.info_requests.update_one(
        {"id": req_id, "user_id": user["user_id"]},
        {"$set": {"status": "read", "read_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    return {"ok": True}


@api_router.post("/info-requests/mark-all-read")
async def mark_all_info_requests_read(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.info_requests.update_many(
        {"user_id": user["user_id"], "status": "new"},
        {"$set": {"status": "read", "read_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "updated": res.modified_count}


@api_router.delete("/info-requests/{req_id}")
async def delete_info_request(req_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.info_requests.delete_one({"id": req_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    return {"ok": True}


def _render_404_page() -> str:
    return """<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Link non valido</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}</style>
</head><body><div><h1 style="font-weight:300;letter-spacing:-1px">Link non valido</h1><p style="opacity:.6">Questo link non esiste o è stato rimosso.</p></div></body></html>"""


def _render_landing_page(short_id: str, look_name: str, image_url: str,
                          shop_phone_e164: str = "", shop_name: str = "Frammenti",
                          public_page_url: str = "") -> str:
    name_safe = _html.escape(look_name)
    shop_safe = _html.escape(shop_name)
    has_wa_chat = bool(shop_phone_e164 and shop_phone_e164.startswith("+"))
    wa_button_html = ""
    if has_wa_chat:
        wa_digits = shop_phone_e164.lstrip("+")
        wa_message = (
            f"Ciao {shop_name}! 👋\n"
            f"Vorrei informazioni sul look:\n*{look_name}*\n"
            f"{public_page_url}"
        )
        from urllib.parse import quote
        wa_url = f"https://wa.me/{wa_digits}?text={quote(wa_message)}"
        wa_url_safe = _html.escape(wa_url, quote=True)
        wa_button_html = f"""
    <div class="option-block">
      <div class="option-num">Opzione 2</div>
      <div class="option-title">Contattaci su WhatsApp</div>
      <div class="option-desc">Apri una chat diretta. Il negozio risponde dal proprio cellulare.</div>
      <a class="wa-btn" href="{wa_url_safe}" target="_blank" rel="noopener" id="waChatBtn">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style="margin-right:10px;vertical-align:middle">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.14 1.6 5.95L2.05 22l4.27-1.65a9.9 9.9 0 0 0 5.72 1.74h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zM17.4 16.1c-.22.62-1.32 1.2-1.83 1.27-.49.07-1.1.1-1.78-.11-.41-.13-.94-.31-1.62-.6-2.84-1.23-4.7-4.1-4.84-4.28-.14-.18-1.16-1.54-1.16-2.94 0-1.4.73-2.09 1-2.38.27-.29.58-.36.78-.36.2 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.83 2.01.9 2.15.07.14.12.31.02.49-.1.18-.15.29-.29.45-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.16.29.71 1.18 1.53 1.9 1.06.93 1.95 1.22 2.23 1.36.28.14.45.12.62-.07.18-.19.71-.83.9-1.12.19-.29.39-.24.65-.14.27.1 1.7.81 1.99.95.29.14.49.22.56.34.07.12.07.69-.15 1.31z"/>
        </svg>
        <span>Apri WhatsApp</span>
      </a>
    </div>"""

    return f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>{name_safe} — Richiedi informazioni</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta property="og:title" content="{name_safe}" />
<meta property="og:image" content="{image_url}" />
<meta property="og:type" content="product" />
<meta name="twitter:card" content="summary_large_image" />
<style>
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; background: #0a0a0a; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased; }}
  .wrap {{ max-width: 480px; margin: 0 auto; padding: 24px 20px 60px; }}
  .brand {{ font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; opacity: 0.55; margin-bottom: 12px; }}
  .photo {{ width: 100%; aspect-ratio: 4/5; background: #1a1a1a; overflow: hidden; border-radius: 4px; }}
  .photo img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
  h1 {{ font-size: 26px; font-weight: 300; letter-spacing: -0.6px; line-height: 1.2; margin: 18px 0 6px; }}
  .hint {{ font-size: 14px; opacity: 0.75; line-height: 1.5; margin: 0 0 26px; font-weight: 500; }}

  .option-block {{ margin-top: 22px; padding: 18px 16px 16px;
    border: 1px solid #2a2a2a; border-radius: 8px; background: #131313; }}
  .option-num {{ font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase;
    color: #E11D48; font-weight: 700; margin-bottom: 6px; }}
  .option-title {{ font-size: 17px; font-weight: 600; letter-spacing: -0.3px; margin-bottom: 4px; }}
  .option-desc {{ font-size: 13px; opacity: 0.6; line-height: 1.4; margin-bottom: 14px; }}

  label {{ display: block; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.55; margin: 12px 0 6px; }}
  input, textarea {{ width: 100%; background: #1a1a1a; border: 1px solid #2e2e2e; color: #fff;
    padding: 12px 14px; font-size: 15px; border-radius: 4px; font-family: inherit; outline: none; }}
  input:focus, textarea:focus {{ border-color: #E11D48; }}
  textarea {{ min-height: 80px; resize: vertical; }}
  .btn {{ width: 100%; margin-top: 16px; padding: 16px 20px; border: 0; border-radius: 4px;
    background: linear-gradient(135deg, #E11D48 0%, #B91C1C 100%); color: #fff; font-size: 15px;
    font-weight: 700; letter-spacing: 0.5px; cursor: pointer; }}
  .btn[disabled] {{ opacity: 0.55; cursor: default; }}
  .wa-btn {{ display: flex; align-items: center; justify-content: center;
    width: 100%; padding: 16px 20px; border-radius: 4px;
    background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: #fff;
    font-size: 15px; font-weight: 700; letter-spacing: 0.3px; text-decoration: none;
    box-shadow: 0 4px 18px rgba(37,211,102,0.25); }}
  .wa-btn:active {{ transform: scale(0.985); }}
  .ok {{ margin-top: 20px; padding: 18px; background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.35);
    border-radius: 4px; color: #4ade80; font-size: 14px; line-height: 1.5; text-align: center; }}
  .err {{ margin-top: 12px; color: #f87171; font-size: 13px; }}
  .foot {{ margin-top: 30px; text-align: center; font-size: 11px; opacity: 0.35; letter-spacing: 1.5px; text-transform: uppercase; }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">{shop_safe} · Richiesta informazioni</div>
    <div class="photo"><img id="lookImg" src="{image_url}" alt="{name_safe}" /></div>
    <h1>{name_safe}</h1>
    <p class="hint">Come vuoi ricevere informazioni? Scegli una delle due opzioni:</p>

    <!-- Opzione 1: form di richiamata -->
    <div class="option-block">
      <div class="option-num">Opzione 1 · Consigliata</div>
      <div class="option-title">Contattaci ora · Ti ricontattiamo subito</div>
      <div class="option-desc">Lascia i tuoi dati e il negozio ti chiamerà al più presto (con notifica immediata).</div>

      <form id="f" autocomplete="on">
        <label>Il tuo nome</label>
        <input name="customer_name" id="iName" type="text"
          placeholder="es. Maria Rossi" maxlength="80" autocomplete="name" />

        <label>Telefono</label>
        <input name="phone" id="iPhone" type="tel"
          placeholder="+39 333 1234567" maxlength="40"
          inputmode="tel" autocomplete="tel" />

        <label>Messaggio</label>
        <textarea name="message" id="iMsg" placeholder="es. Vorrei sapere prezzo e taglie disponibili" maxlength="600" autocomplete="off"></textarea>

        <button class="btn" type="submit" id="btn">📨 Invia richiesta · Verrò ricontattato</button>
        <div id="err" class="err" style="display:none"></div>
      </form>

      <div id="ok" class="ok" style="display:none">
        ✅ Richiesta inviata!<br/>
        Il negozio ti contatterà al più presto. Grazie.
      </div>
    </div>

    {wa_button_html}

    <div class="foot">Powered by DressVibe</div>
  </div>

<script>
const f = document.getElementById('f');
const btn = document.getElementById('btn');
const okBox = document.getElementById('ok');
const errBox = document.getElementById('err');
const iName = document.getElementById('iName');
const iPhone = document.getElementById('iPhone');

// Strategy 2: localStorage pre-fill
const LS_KEY = 'dv_customer_v1';
try {{
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  if (saved && typeof saved === 'object') {{
    if (saved.name && !iName.value) iName.value = saved.name;
    if (saved.phone && !iPhone.value) iPhone.value = saved.phone;
  }}
}} catch (e) {{}}

f.addEventListener('submit', async function(e) {{
  e.preventDefault();
  errBox.style.display = 'none';
  const fd = new FormData(f);
  const body = {{
    customer_name: fd.get('customer_name') || null,
    phone: fd.get('phone') || null,
    message: fd.get('message') || null,
  }};
  if (!body.customer_name && !body.phone && !body.message) {{
    errBox.textContent = 'Inserisci almeno un dato (nome, telefono o messaggio).';
    errBox.style.display = 'block';
    return;
  }}
  try {{
    localStorage.setItem(LS_KEY, JSON.stringify({{
      name: body.customer_name || '',
      phone: body.phone || '',
    }}));
  }} catch (e) {{}}

  btn.disabled = true; btn.textContent = 'Invio in corso…';
  try {{
    const r = await fetch('/api/r/{short_id}/info-request', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify(body),
    }});
    if (!r.ok) {{
      const j = await r.json().catch(() => ({{}}));
      throw new Error(j.detail || 'Errore di invio');
    }}
    f.style.display = 'none';
    okBox.style.display = 'block';
  }} catch (err) {{
    errBox.textContent = err.message || 'Errore di invio. Riprova.';
    errBox.style.display = 'block';
    btn.disabled = false; btn.textContent = '📨 Invia richiesta · Verrò ricontattato';
  }}
}});
</script>
</body>
</html>"""



class UserSettingsUpdate(BaseModel):
    telegram_channel: Optional[str] = None
    whatsapp_channel_url: Optional[str] = None
    whatsapp_business_phone: Optional[str] = None
    shop_name: Optional[str] = None
    city: Optional[str] = None


def normalize_phone_e164(value: Optional[str]) -> Optional[str]:
    """Best-effort normalisation to E.164. Italian numbers without country
    code get a +39 prefix as a sensible default for this app."""
    if value is None:
        return None
    s = (value or "").strip()
    if not s:
        return ""
    cleaned = "".join(c for c in s if c.isdigit() or c == "+")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned:
        return ""
    if not cleaned.startswith("+"):
        digits = cleaned.lstrip("0")
        cleaned = "+39" + digits
    return cleaned


def normalize_whatsapp_channel(value: Optional[str]) -> Optional[str]:
    """Accept full WhatsApp channel URL or just the channel code/id.

    Returns the canonical https URL form, e.g.
    'https://whatsapp.com/channel/0029VaXXXX'. Empty string clears."""
    if value is None:
        return None
    s = (value or "").strip()
    if not s:
        return ""
    # Accept several inputs:
    #   https://whatsapp.com/channel/0029Va...
    #   whatsapp.com/channel/0029Va...
    #   wa.me/channel/0029Va...
    #   0029Va...
    low = s.lower()
    for prefix in (
        "https://whatsapp.com/channel/",
        "http://whatsapp.com/channel/",
        "whatsapp.com/channel/",
        "https://wa.me/channel/",
        "wa.me/channel/",
        "https://chat.whatsapp.com/channel/",
        "chat.whatsapp.com/channel/",
    ):
        if low.startswith(prefix):
            s = s[len(prefix):]
            break
    # If still looks like a URL, give up and keep as-is
    if "://" in s:
        return s
    s = s.strip("/").strip("@")
    return f"https://whatsapp.com/channel/{s}" if s else ""


def normalize_channel(value: Optional[str]) -> Optional[str]:
    """Accept '@frammenti_pe', 'frammenti_pe', 't.me/frammenti_pe', full URL.
    Always return Telegram's canonical form '@frammenti_pe' (or numeric id
    untouched). Empty string clears the override."""
    if value is None:
        return None
    s = value.strip()
    if not s:
        return ""  # explicit clear
    # numeric chat id (e.g. -1001234567890) — leave as-is
    if s.lstrip("-").isdigit():
        return s
    # strip URL prefixes
    for prefix in ("https://t.me/", "http://t.me/", "t.me/", "telegram.me/"):
        if s.lower().startswith(prefix):
            s = s[len(prefix):]
            break
    s = s.lstrip("@").strip("/")
    return f"@{s}" if s else ""


@api_router.get("/user-settings")
async def get_user_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    return {
        "telegram_channel": s.get("telegram_channel") or "",
        "telegram_channel_default": TELEGRAM_CHANNEL_ID or "",
        "whatsapp_channel_url": s.get("whatsapp_channel_url") or "",
        "whatsapp_business_phone": s.get("whatsapp_business_phone") or "",
        "shop_name": s.get("shop_name") or "Frammenti",
        "city": s.get("city") or "Pescara",
    }


@api_router.put("/user-settings")
async def update_user_settings(payload: UserSettingsUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    update_doc: dict = {"user_id": user["user_id"], "updated_at": datetime.now(timezone.utc)}
    if payload.telegram_channel is not None:
        update_doc["telegram_channel"] = normalize_channel(payload.telegram_channel)
    if payload.whatsapp_channel_url is not None:
        update_doc["whatsapp_channel_url"] = normalize_whatsapp_channel(payload.whatsapp_channel_url)
    if payload.whatsapp_business_phone is not None:
        update_doc["whatsapp_business_phone"] = normalize_phone_e164(payload.whatsapp_business_phone)
    if payload.shop_name is not None:
        update_doc["shop_name"] = payload.shop_name.strip()[:80]
    if payload.city is not None:
        update_doc["city"] = payload.city.strip()[:80]
    await db.user_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": update_doc},
        upsert=True,
    )
    return await get_user_settings(authorization)


# =================== App init ===================
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_db():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.garments.create_index("user_id")
    await db.garments.create_index("id", unique=True)
    await db.generations.create_index("user_id")
    await db.generations.create_index("id", unique=True)
    await db.virtual_clients.create_index("user_id")
    await db.virtual_clients.create_index("id", unique=True)
    await db.tg_publications.create_index("token", unique=True)
    await db.temp_images.create_index("created_at", expireAfterSeconds=900)  # 15 min TTL
    await db.videos.create_index("user_id")
    await db.videos.create_index("id", unique=True)
    await db.short_links.create_index("short_id", unique=True)
    await db.short_links.create_index([("user_id", 1), ("gen_id", 1), ("image_index", 1)])
    await db.info_requests.create_index("id", unique=True)
    await db.info_requests.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
    await db.info_requests.create_index("created_at")
    logger.info("DressVibe API started")

    # Register Telegram webhook (best-effort)
    if TELEGRAM_BOT_TOKEN and PUBLIC_BASE_URL and TELEGRAM_WEBHOOK_SECRET:
        try:
            webhook_url = f"{PUBLIC_BASE_URL}/api/telegram/webhook/{TELEGRAM_WEBHOOK_SECRET}"
            async with httpx.AsyncClient(timeout=10.0) as http:
                resp = await http.post(
                    f"{TELEGRAM_API}/setWebhook",
                    json={
                        "url": webhook_url,
                        "allowed_updates": ["callback_query", "message"],
                    },
                )
            logger.info(f"Telegram setWebhook: {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Telegram setWebhook failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
