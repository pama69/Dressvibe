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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

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
    logger.info("DressVibe API started")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
