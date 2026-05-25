"""
Multi-provider registry for DressVibe.

Each task (image generation, image editing, video generation) has a list of
providers. A provider is enabled iff the relevant API key is present in the env.
The actual call is dispatched in `server.py` based on the provider id chosen by
the user. To plug in a new provider:

1. Add the API key env variable to /app/backend/.env
2. Add a row in the table below with `enabled = lambda env: bool(env.get('YOUR_KEY'))`
3. Implement the call branch in the dispatcher (server.py) when `provider == 'your_id'`

The frontend reads this registry via `GET /api/providers` and renders dropdowns.
"""
import os
from typing import Dict, List, Optional


def _env() -> Dict[str, str]:
    return dict(os.environ)


def _provider(
    id: str,
    name: str,
    description: str,
    env_keys: List[str],
    badge: Optional[str] = None,
) -> dict:
    e = _env()
    enabled = all(bool(e.get(k, "").strip()) for k in env_keys)
    return {
        "id": id,
        "name": name,
        "description": description,
        "enabled": enabled,
        "badge": badge,
        "missing_keys": [k for k in env_keys if not e.get(k, "").strip()] if not enabled else [],
    }


def list_providers() -> Dict[str, List[dict]]:
    """Returns the catalog of providers grouped by task."""
    return {
        "image_gen": [
            _provider(
                id="gemini_nano_banana",
                name="Gemini Nano Banana",
                description="Veloce, ottimo per editing realistico con riferimenti.",
                env_keys=["EMERGENT_LLM_KEY"],
                badge="Default",
            ),
            _provider(
                id="openai_gpt_image_1",
                name="OpenAI GPT Image 1",
                description="Alta qualità, scenari complessi.",
                env_keys=["EMERGENT_LLM_KEY"],
            ),
            _provider(
                id="grok_imagine",
                name="Grok Imagine (xAI)",
                description="Stile cinematografico, modelli realistici.",
                env_keys=["XAI_API_KEY"],
            ),
        ],
        "image_edit": [
            _provider(
                id="gemini_nano_banana",
                name="Gemini Nano Banana",
                description="Editing immagini (sfondo, ritocco, testo).",
                env_keys=["EMERGENT_LLM_KEY"],
                badge="Default",
            ),
            _provider(
                id="openai_gpt_image_1",
                name="OpenAI GPT Image 1",
                description="Editing immagini con maschera.",
                env_keys=["EMERGENT_LLM_KEY"],
            ),
        ],
        "video_gen": [
            _provider(
                id="grok_video",
                name="Grok Video (xAI)",
                description="Image-to-video, 9:16, movimenti fluidi naturali. Default consigliato per moda.",
                env_keys=["XAI_API_KEY"],
                badge="Consigliato moda",
            ),
            _provider(
                id="google_veo",
                name="Google VEO",
                description="8s clip cinematografiche di alta qualità.",
                env_keys=["GEMINI_API_KEY"],
            ),
            _provider(
                id="kling",
                name="Kling (Kuaishou)",
                description="Movimenti naturali, transizioni realistiche.",
                env_keys=["KLING_API_KEY"],
            ),
            _provider(
                id="sora",
                name="OpenAI Sora 2",
                description="Scene complesse, dettagli fini.",
                env_keys=["EMERGENT_LLM_KEY"],
            ),
        ],
    }


def get_provider(task: str, provider_id: str) -> Optional[dict]:
    for p in list_providers().get(task, []):
        if p["id"] == provider_id:
            return p
    return None


def default_provider(task: str) -> Optional[str]:
    """First enabled provider for a task, or None."""
    for p in list_providers().get(task, []):
        if p["enabled"]:
            return p["id"]
    return None
