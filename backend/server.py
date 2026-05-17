from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
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
TELEGRAM_ADMIN_CHAT_ID = os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '')
TELEGRAM_WEBHOOK_SECRET = os.environ.get('TELEGRAM_WEBHOOK_SECRET', '')
PUBLIC_BASE_URL = os.environ.get('PUBLIC_BASE_URL', '')
TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

XAI_API_KEY = os.environ.get('XAI_API_KEY', '')
XAI_API_BASE = "https://api.x.ai/v1"

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


def build_outfit_prompt(p: GenerationCreate, variation_idx: int) -> str:
    gender = GENDER_IT.get(p.model_gender, p.model_gender)
    age = AGE_IT.get(p.model_age, p.model_age)
    body = BODY_IT.get(p.model_body, p.model_body)
    eth = ETHNICITY_IT.get(p.model_ethnicity, p.model_ethnicity)
    pose = POSE_IT.get(p.pose, p.pose)
    bg = BACKGROUND_IT.get(p.background, p.background)
    shoes = SHOES_IT.get(p.shoes, p.shoes)

    return (
        f"Create a hyper-realistic, high-end fashion editorial photograph of {gender}, "
        f"{age}, with {eth}, {body}. "
        f"FULL BODY SHOT from head to feet, the entire figure must be visible including the shoes and the floor under them. "
        f"The model is wearing EXACTLY the clothing items shown in the reference images, "
        f"preserving every detail: color, pattern, texture, cut, logo, prints. "
        f"Footwear: {shoes}. "
        f"Pose: {pose}. Setting: {bg}. "
        f"Shot with a 35mm lens, soft natural lighting, magazine-quality, "
        f"sharp focus on the entire outfit, photorealistic skin tones, no plastic skin, no extra fingers, "
        f"correct anatomy with both feet on the ground. "
        f"STRICT vertical 9:16 aspect ratio (portrait, taller than wide, perfect for Instagram Stories and Telegram). "
        f"The composition must fit the model fully inside the 9:16 frame with comfortable margins. "
        f"Variation seed {variation_idx}."
    )


async def generate_single_image(prompt: str, reference_images_b64: List[str], session_id: str) -> Optional[str]:
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
        return None
    except Exception as e:
        logger.exception(f"Image generation failed: {e}")
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

    gen_id = f"gen_{uuid.uuid4().hex[:12]}"
    gen_doc = {
        "id": gen_id,
        "user_id": user["user_id"],
        "garment_ids": payload.garment_ids,
        "title": payload.title or f"Generazione del {datetime.now().strftime('%d/%m %H:%M')}",
        "params": payload.dict(exclude={"garment_ids", "title"}),
        "images": [],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
    }
    await db.generations.insert_one(gen_doc.copy())

    # Run variations in parallel (limit to keep latency reasonable)
    tasks = [
        generate_single_image(
            build_outfit_prompt(payload, i),
            refs,
            f"{gen_id}_{i}",
        )
        for i in range(num)
    ]
    results = await asyncio.gather(*tasks)
    images = [img for img in results if img]

    status = "done" if images else "failed"
    await db.generations.update_one(
        {"id": gen_id},
        {"$set": {"images": images, "status": status}},
    )

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
    prompt = (
        f"Edit the provided photograph as requested while keeping the model, outfit, and overall composition identical. "
        f"Preserve the full-body framing (head to feet) and the 9:16 vertical aspect ratio. "
        f"Request: {payload.edit_prompt}. "
        f"Keep photorealistic quality, high-end fashion photography aesthetic."
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


@api_router.post("/videos")
async def create_video(payload: VideoGenerateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
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
        image_url = f"{PUBLIC_BASE_URL}/api/temp-image/{token}"

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

        # 4. Persist the video doc
        video_id = f"vid_{uuid.uuid4().hex[:12]}"
        doc = {
            "id": video_id,
            "user_id": user["user_id"],
            "provider": provider_id,
            "gen_id": payload.gen_id,
            "image_index": payload.image_index,
            "video_url": video_url,
            "duration_seconds": payload.duration_seconds,
            "prompt": final_prompt,
            "created_at": datetime.now(timezone.utc),
        }
        await db.videos.insert_one(doc.copy())
        doc.pop("_id", None)
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
async def list_generation_videos(gen_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.videos.find(
        {"user_id": user["user_id"], "gen_id": gen_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return items


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
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHANNEL_ID:
        raise HTTPException(status_code=503, detail="Telegram non configurato")

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

    keyboard = {
        "inline_keyboard": [[
            {"text": "PRENOTA IL TUO CAPO ORA!", "callback_data": f"book:{token}"}
        ]]
    }

    import json as _json
    file_id: Optional[str] = None

    if media_type == "video":
        # Try URL-mode first. Telegram itself downloads from the URL.
        data = {
            "chat_id": TELEGRAM_CHANNEL_ID,
            "video": payload.video_url,
            "caption": caption,
            "reply_markup": _json.dumps(keyboard),
            "supports_streaming": True,
        }
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
                    "chat_id": TELEGRAM_CHANNEL_ID,
                    "caption": caption,
                    "reply_markup": _json.dumps(keyboard),
                    "supports_streaming": "true",
                }
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
            "chat_id": TELEGRAM_CHANNEL_ID,
            "caption": caption,
            "reply_markup": _json.dumps(keyboard),
        }
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
        "channel_id": TELEGRAM_CHANNEL_ID,
        "channel_message_id": message_id,
        "caption": caption,
        "file_id": file_id,
        "created_at": datetime.now(timezone.utc),
    })
    return {"ok": True, "channel_message_id": message_id, "token": token, "media_type": media_type}


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
        data = cq.get("data", "")
        from_user = cq.get("from", {}) or {}
        user_id_tg = from_user.get("id")
        username = from_user.get("username")
        first = from_user.get("first_name", "")
        last = from_user.get("last_name", "")
        full_name = (first + " " + last).strip() or "Cliente"
        handle = f"@{username}" if username else (f"id:{user_id_tg}" if user_id_tg else "anonimo")

        if data.startswith("book:"):
            token = data.split(":", 1)[1]
            pub = await db.tg_publications.find_one({"token": token}, {"_id": 0})

            # 1. Acknowledge the tap (always shows a Telegram-native toast)
            await tg_api("answerCallbackQuery", {
                "callback_query_id": cq["id"],
                "text": "✓ Prenotazione inviata! Sarai contattata al più presto.",
                "show_alert": True,
            })

            # 2. Try to DM the user a private confirmation
            if user_id_tg:
                await tg_api("sendMessage", {
                    "chat_id": user_id_tg,
                    "text": "Grazie, sarai contattata al più presto per la conferma 💛",
                })

            # 3. Notify the admin
            if TELEGRAM_ADMIN_CHAT_ID:
                now = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
                admin_text = (
                    f"🔔 *Nuova prenotazione*\n"
                    f"👤 Cliente: {full_name} ({handle})\n"
                    f"🕒 Orario: {now}\n"
                )
                if pub and pub.get("caption"):
                    admin_text += f"📝 Capo: {pub['caption'][:200]}\n"
                # Forward the original photo to admin, fallback to text-only
                if pub and pub.get("file_id"):
                    await tg_api("sendPhoto", {
                        "chat_id": TELEGRAM_ADMIN_CHAT_ID,
                        "photo": pub["file_id"],
                        "caption": admin_text,
                        "parse_mode": "Markdown",
                    })
                else:
                    await tg_api("sendMessage", {
                        "chat_id": TELEGRAM_ADMIN_CHAT_ID,
                        "text": admin_text,
                        "parse_mode": "Markdown",
                    })

            # 4. Log the booking
            await db.tg_bookings.insert_one({
                "token": token,
                "tg_user_id": user_id_tg,
                "tg_username": username,
                "tg_name": full_name,
                "created_at": datetime.now(timezone.utc),
            })
        else:
            await tg_api("answerCallbackQuery", {"callback_query_id": cq["id"]})
    return {"ok": True}


@api_router.get("/telegram/status")
async def telegram_status(authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    return {
        "configured": bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID),
        "channel_id": TELEGRAM_CHANNEL_ID if TELEGRAM_BOT_TOKEN else None,
    }


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
