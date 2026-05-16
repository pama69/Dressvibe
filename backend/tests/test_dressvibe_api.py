"""DressVibe backend integration tests.

Covers:
- Auth: invalid session id -> 401, /auth/me without token -> 401, with valid -> user
- Garments CRUD
- Generations create / list / get / delete (AI: small num_variations=2)
- Studio edit (AI)
- Caption (AI) — has graceful fallback
- Virtual clients CRUD
- Stats
- Categories
- Authorization enforcement across protected endpoints
"""
import time
import pytest


# ---------- Health ----------
class TestHealth:
    def test_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "ok"
        assert "DressVibe" in data.get("message", "")


# ---------- Auth ----------
class TestAuth:
    def test_create_session_invalid_id_returns_401(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/session",
            json={"session_id": "definitely-not-a-real-session-id-xyz"},
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_auth_me_without_token_returns_401(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401, r.text

    def test_auth_me_with_bad_token_returns_401(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert r.status_code == 401, r.text

    def test_auth_me_with_valid_token_returns_user(
        self, api_client, base_url, auth_headers, _seeded_session
    ):
        r = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == _seeded_session["user_id"]
        assert data["email"] == _seeded_session["email"]
        assert "_id" not in data, "MongoDB _id leaked in response"


# ---------- Categories (public) ----------
class TestCategories:
    def test_get_categories(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/categories")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("categories"), list)
        # spot-check a few Italian categories
        cats = data["categories"]
        for expected in ["t-shirt", "pantaloni", "vestito", "giacca"]:
            assert expected in cats, f"missing category {expected} in {cats}"


# ---------- Authorization enforcement on protected endpoints ----------
class TestAuthEnforcement:
    # Each entry: (method, path, valid_body_to_pass_pydantic_validation)
    # We use a valid body so the auth dependency is actually reached
    # (otherwise FastAPI's pydantic 422 fires before the Header dependency).
    @pytest.mark.parametrize(
        "method,path,body",
        [
            ("GET", "/api/auth/me", None),
            ("GET", "/api/garments", None),
            ("POST", "/api/garments", {"name": "x", "image_base64": "x", "category": "t-shirt"}),
            ("GET", "/api/generations", None),
            ("POST", "/api/generations", {
                "garment_ids": ["g_x"], "model_gender": "donna", "model_age": "adulto",
                "model_body": "slim", "model_ethnicity": "caucasica",
                "pose": "casual_standing", "background": "white_studio", "num_variations": 1,
            }),
            ("POST", "/api/studio/edit", {"image_base64": "x", "edit_prompt": "y"}),
            ("GET", "/api/clients", None),
            ("POST", "/api/clients", {
                "name": "x", "model_gender": "donna", "model_age": "adulto",
                "model_body": "slim", "model_ethnicity": "caucasica",
            }),
            ("POST", "/api/caption", {"garment_name": "x", "category": "t-shirt"}),
            ("GET", "/api/stats", None),
        ],
    )
    def test_no_token_returns_401(self, api_client, base_url, method, path, body):
        kwargs = {}
        if body is not None:
            kwargs["json"] = body
        r = api_client.request(method, f"{base_url}{path}", **kwargs)
        assert r.status_code == 401, f"{method} {path} should be 401, got {r.status_code}: {r.text[:200]}"


# ---------- Garments CRUD ----------
class TestGarmentsCRUD:
    def test_create_list_get_delete(self, api_client, base_url, auth_headers, tiny_png_b64):
        # create
        payload = {
            "name": "TEST_Maglietta Rossa",
            "image_base64": tiny_png_b64,
            "category": "t-shirt",
            "color": "rosso",
            "size": "M",
            "price": 19.9,
            "season": "estate",
            "gender": "unisex",
        }
        r = api_client.post(f"{base_url}/api/garments", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["id"].startswith("g_")
        assert created["name"] == payload["name"]
        assert created["category"] == "t-shirt"
        assert created["image_base64"] == tiny_png_b64
        assert "_id" not in created
        gid = created["id"]

        # list
        r = api_client.get(f"{base_url}/api/garments", headers=auth_headers)
        assert r.status_code == 200, r.text
        items = r.json()
        assert any(it["id"] == gid for it in items), "created garment not in list"

        # get one
        r = api_client.get(f"{base_url}/api/garments/{gid}", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["id"] == gid

        # get unknown -> 404
        r = api_client.get(f"{base_url}/api/garments/g_doesnotexist", headers=auth_headers)
        assert r.status_code == 404

        # delete
        r = api_client.delete(f"{base_url}/api/garments/{gid}", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 1

        # confirm gone
        r = api_client.get(f"{base_url}/api/garments/{gid}", headers=auth_headers)
        assert r.status_code == 404


# ---------- Virtual clients CRUD ----------
class TestVirtualClientsCRUD:
    def test_create_list_delete(self, api_client, base_url, auth_headers):
        payload = {
            "name": "TEST_Cliente Tipo",
            "model_gender": "donna",
            "model_age": "adulto",
            "model_body": "slim",
            "model_ethnicity": "caucasica",
            "notes": "TEST note",
        }
        r = api_client.post(f"{base_url}/api/clients", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["id"].startswith("c_")
        assert created["name"] == payload["name"]
        cid = created["id"]

        r = api_client.get(f"{base_url}/api/clients", headers=auth_headers)
        assert r.status_code == 200
        assert any(it["id"] == cid for it in r.json())

        r = api_client.delete(f"{base_url}/api/clients/{cid}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 1


# ---------- Stats ----------
class TestStats:
    def test_stats_keys(self, api_client, base_url, auth_headers):
        r = api_client.get(f"{base_url}/api/stats", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("garments", "generations", "clients"):
            assert k in data and isinstance(data[k], int)


# ---------- Caption (AI w/ graceful fallback) ----------
class TestCaption:
    def test_generate_caption(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/caption",
            json={
                "garment_name": "Camicia di lino bianca",
                "category": "camicia",
                "price": 49.0,
                "style": "instagram",
            },
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        caption = r.json().get("caption", "")
        assert isinstance(caption, str) and len(caption) > 0


# ---------- Generations (real AI calls) ----------
class TestGenerations:
    """Slow: each call uses Gemini Nano Banana. Uses num_variations=2."""

    @pytest.fixture(scope="class")
    def garment_for_gen(self, api_client, base_url, auth_headers, tiny_png_b64):
        r = api_client.post(
            f"{base_url}/api/garments",
            json={
                "name": "TEST_Generation Garment",
                "image_base64": tiny_png_b64,
                "category": "t-shirt",
            },
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        gid = r.json()["id"]
        yield gid
        api_client.delete(f"{base_url}/api/garments/{gid}", headers=auth_headers)

    def test_generation_empty_garment_ids_400(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/generations",
            json={
                "garment_ids": [],
                "model_gender": "donna", "model_age": "adulto", "model_body": "slim",
                "model_ethnicity": "caucasica", "pose": "casual_standing",
                "background": "white_studio", "num_variations": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text

    def test_generation_unknown_garment_returns_404(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/generations",
            json={
                "garment_ids": ["g_doesnotexist"],
                "model_gender": "donna", "model_age": "adulto", "model_body": "slim",
                "model_ethnicity": "caucasica", "pose": "casual_standing",
                "background": "white_studio", "num_variations": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 404, r.text

    def test_create_list_get_delete_generation(
        self, api_client, base_url, auth_headers, garment_for_gen
    ):
        t0 = time.time()
        r = api_client.post(
            f"{base_url}/api/generations",
            json={
                "garment_ids": [garment_for_gen],
                "model_gender": "donna",
                "model_age": "adulto",
                "model_body": "slim",
                "model_ethnicity": "caucasica",
                "pose": "casual_standing",
                "background": "white_studio",
                "num_variations": 2,
                "title": "TEST_Generation",
            },
            headers=auth_headers,
            timeout=180,
        )
        elapsed = time.time() - t0
        print(f"[generation] took {elapsed:.1f}s -> {r.status_code}")
        assert r.status_code == 200, r.text
        gen = r.json()
        assert gen["id"].startswith("gen_")
        assert gen["status"] in ("done", "failed")
        assert isinstance(gen["images"], list)
        if gen["status"] == "done":
            assert len(gen["images"]) >= 1
            assert all(isinstance(img, str) and len(img) > 100 for img in gen["images"])
        else:
            pytest.skip(f"AI generation returned status=failed (upstream); body={gen}")

        gen_id = gen["id"]

        # list -> should have thumbnail + image_count and NO images
        r = api_client.get(f"{base_url}/api/generations", headers=auth_headers)
        assert r.status_code == 200, r.text
        items = r.json()
        ours = [it for it in items if it["id"] == gen_id]
        assert ours, "created generation missing in list"
        item = ours[0]
        assert "images" not in item, "list endpoint must strip full images"
        assert "image_count" in item and item["image_count"] >= 1
        assert "thumbnail" in item and item["thumbnail"]

        # detail -> full images
        r = api_client.get(f"{base_url}/api/generations/{gen_id}", headers=auth_headers)
        assert r.status_code == 200, r.text
        full = r.json()
        assert isinstance(full.get("images"), list) and len(full["images"]) >= 1

        # delete
        r = api_client.delete(f"{base_url}/api/generations/{gen_id}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 1

        # confirm gone
        r = api_client.get(f"{base_url}/api/generations/{gen_id}", headers=auth_headers)
        assert r.status_code == 404


# ---------- Studio edit (real AI call) ----------
class TestStudio:
    def test_studio_edit_returns_image(self, api_client, base_url, auth_headers, tiny_png_b64):
        t0 = time.time()
        r = api_client.post(
            f"{base_url}/api/studio/edit",
            json={
                "image_base64": tiny_png_b64,
                "edit_prompt": "remove background and replace with white studio",
            },
            headers=auth_headers,
            timeout=120,
        )
        elapsed = time.time() - t0
        print(f"[studio/edit] took {elapsed:.1f}s -> {r.status_code}")
        if r.status_code == 502:
            pytest.skip(f"Studio edit upstream failure (502): {r.text}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "image_base64" in body and isinstance(body["image_base64"], str)
        assert len(body["image_base64"]) > 100
