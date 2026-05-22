"""
DressVibe — Performance / Thumbnail Optimisations test suite.

Scope (per the review request):
  1) List endpoints leanness:
     - GET /api/garments returns thumb_base64 and NO image_base64.
     - GET /api/generations returns thumbnail + image_count, NO images[].
  2) Detail endpoints unchanged:
     - GET /api/garments/{id} keeps image_base64.
     - GET /api/generations/{id} keeps images[] and thumbs[].
  3) Garment thumb generated on POST.
  4) POST /api/generations produces thumbs[] aligned with images[].
  5) POST /api/studio/edit appends both image + thumb.
  6) DELETE /api/generations/{id} sweeps short_links/videos/tg_publications.
  7) DELETE /api/generations/{id}/images/{idx} keeps thumbs aligned.
  8) Background backfill ran.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests

BASE = "https://outfit-gen-11.preview.emergentagent.com/api"
TOKEN = "test_session_screen"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
USER_ID = "user_demo01"

PASS: List[str] = []
FAIL: List[str] = []


def _ok(label: str, extra: str = "") -> None:
    print(f"[PASS] {label}" + (f"  ({extra})" if extra else ""))
    PASS.append(label)


def _bad(label: str, why: str) -> None:
    print(f"[FAIL] {label}  ->  {why}")
    FAIL.append(f"{label} :: {why}")


# -------------- helpers --------------------------------------------------------
def make_tiny_png_b64() -> str:
    """Return a real ~64×64 PNG base64 (without prefix) so make_thumb_b64
    can actually decode it and Gemini can accept it in the worst case."""
    try:
        from PIL import Image  # type: ignore
        img = Image.new("RGB", (64, 64), (200, 120, 60))
        for x in range(64):
            for y in range(64):
                img.putpixel((x, y), ((x * 4) & 0xFF, (y * 4) & 0xFF, 120))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lE"
            "QVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="
        )


def http_get(path: str) -> requests.Response:
    return requests.get(f"{BASE}{path}", headers=HEADERS, timeout=120)


def http_post(path: str, payload: Dict[str, Any], timeout: int = 180) -> requests.Response:
    return requests.post(f"{BASE}{path}", headers=HEADERS, data=json.dumps(payload), timeout=timeout)


def http_delete(path: str) -> requests.Response:
    return requests.delete(f"{BASE}{path}", headers=HEADERS, timeout=60)


def run_mongosh(script: str) -> str:
    """Run a mongosh script via a temp file to avoid shell-quoting issues."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(script)
        path = f.name
    try:
        return os.popen(f"mongosh --quiet --file {path}").read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# -------------- 1) list endpoint leanness --------------------------------------
def test_1_list_endpoints_lean() -> None:
    label_g = "1a) GET /api/garments lean (no image_base64, thumb_base64 present)"
    label_x = "1b) GET /api/generations lean (no images[], thumbnail+image_count present)"

    r = http_get("/garments")
    if r.status_code != 200:
        _bad(label_g, f"status={r.status_code} body={r.text[:200]}")
    else:
        items = r.json()
        body_kb = len(r.content) / 1024.0
        if not isinstance(items, list):
            _bad(label_g, f"unexpected body type: {type(items)}")
        else:
            has_img = [it for it in items if "image_base64" in it]
            missing_thumb = [it for it in items if not it.get("thumb_base64")]
            if has_img:
                _bad(label_g, f"{len(has_img)} items still contain image_base64")
            elif missing_thumb and items:
                _bad(label_g, f"{len(missing_thumb)}/{len(items)} items missing thumb_base64")
            elif body_kb > 500:
                _bad(label_g, f"response {body_kb:.1f} KB exceeds 500 KB budget")
            else:
                _ok(label_g, extra=f"{len(items)} items, body={body_kb:.1f} KB, no image_base64")

    r = http_get("/generations")
    if r.status_code != 200:
        _bad(label_x, f"status={r.status_code} body={r.text[:200]}")
    else:
        items = r.json()
        body_kb = len(r.content) / 1024.0
        bad_with_images = [it for it in items if "images" in it]
        missing_meta = [
            it for it in items
            if "image_count" not in it or "thumbnail" not in it
        ]
        if bad_with_images:
            _bad(label_x, f"{len(bad_with_images)} items still contain images[]")
        elif missing_meta:
            _bad(label_x, f"{len(missing_meta)} items missing thumbnail/image_count")
        elif body_kb > 1024:
            _bad(label_x, f"response {body_kb:.1f} KB exceeds 1 MB budget")
        else:
            _ok(label_x, extra=f"{len(items)} items, body={body_kb:.1f} KB")


# -------------- 2) detail endpoints unchanged ----------------------------------
def test_2_detail_endpoints() -> Optional[Dict[str, Any]]:
    label_g = "2a) GET /api/garments/{id} returns full image_base64"
    label_x = "2b) GET /api/generations/{id} returns full images[] AND thumbs[]"

    rl = http_get("/garments")
    g_id = None
    if rl.status_code == 200 and rl.json():
        g_id = rl.json()[0]["id"]
    if not g_id:
        _bad(label_g, "no garments available")
    else:
        r = http_get(f"/garments/{g_id}")
        if r.status_code != 200:
            _bad(label_g, f"status={r.status_code}")
        else:
            d = r.json()
            if not d.get("image_base64"):
                _bad(label_g, "image_base64 missing or empty in detail response")
            else:
                _ok(label_g, extra=f"id={g_id} image_base64 length={len(d['image_base64'])}")

    rl2 = http_get("/generations")
    gen_id_with_images: Optional[str] = None
    if rl2.status_code == 200:
        for it in rl2.json():
            if it.get("image_count", 0) >= 1:
                gen_id_with_images = it["id"]
                break
    if not gen_id_with_images:
        _bad(label_x, "no generation with images available")
        return None

    r = http_get(f"/generations/{gen_id_with_images}")
    if r.status_code != 200:
        _bad(label_x, f"status={r.status_code}")
        return None
    d = r.json()
    imgs = d.get("images") or []
    thumbs = d.get("thumbs")
    if not imgs:
        _bad(label_x, "images[] empty or missing in detail")
    elif thumbs is None:
        _bad(label_x, "thumbs[] missing in detail")
    else:
        _ok(
            label_x,
            extra=f"gen={gen_id_with_images} images={len(imgs)} thumbs={len(thumbs)}",
        )
    return {"gen_id": gen_id_with_images, "images": imgs, "thumbs": thumbs}


# -------------- 3) garment thumb on POST ---------------------------------------
def test_3_garment_thumb_post() -> Optional[str]:
    label = "3) POST /api/garments produces image_base64 + thumb_base64 (thumb < image)"
    label_b = "3b) New garment appears in GET /api/garments without image_base64"

    # Use the existing demo garment's actual image so this is realistic
    src = http_get("/garments/g_test_demo01")
    if src.status_code == 200 and src.json().get("image_base64"):
        b64 = src.json()["image_base64"]
    else:
        b64 = make_tiny_png_b64()

    r = http_post(
        "/garments",
        {
            "name": "Maglione test thumb",
            "image_base64": b64,
            "category": "maglione",
            "color": "blu",
            "season": "inverno",
            "gender": "donna",
        },
    )
    if r.status_code != 200:
        _bad(label, f"status={r.status_code} body={r.text[:200]}")
        return None
    d = r.json()
    if not d.get("image_base64") or not d.get("thumb_base64"):
        _bad(label, f"missing fields: image_base64={bool(d.get('image_base64'))}, thumb_base64={bool(d.get('thumb_base64'))}")
        return None
    if len(d["thumb_base64"]) >= len(d["image_base64"]):
        _bad(label, f"thumb not smaller than image (thumb={len(d['thumb_base64'])} vs img={len(d['image_base64'])})")
    else:
        _ok(label, extra=f"id={d['id']} img={len(d['image_base64'])}B thumb={len(d['thumb_base64'])}B")

    r2 = http_get("/garments")
    if r2.status_code != 200:
        _bad(label_b, f"status={r2.status_code}")
        return d["id"]
    items = r2.json()
    new_item = next((it for it in items if it.get("id") == d["id"]), None)
    if not new_item:
        _bad(label_b, "new garment not present in list")
    elif "image_base64" in new_item:
        _bad(label_b, "image_base64 leaked into list response")
    elif not new_item.get("thumb_base64"):
        _bad(label_b, "thumb_base64 missing in list response")
    else:
        _ok(label_b, extra=f"id={d['id']}")
    return d["id"]


# -------------- 4) generation produces thumbs[] aligned ------------------------
def test_4_generation_thumbs(garment_id: Optional[str]) -> Optional[str]:
    label = "4) POST /api/generations stores thumbs[] aligned with images[] (status=done)"
    label_b = "4b) GET /api/generations list shows thumbnail populated for new gen"
    label_c = "4c) GET /api/generations/{id} returns images[] and thumbs[] with equal length"

    target_garment = None
    rl = http_get("/garments")
    if rl.status_code == 200:
        items = rl.json()
        for it in items:
            if it["id"] == "g_test_demo01":
                target_garment = it["id"]
                break
        if not target_garment:
            target_garment = garment_id or (items[0]["id"] if items else None)
    if not target_garment:
        _bad(label, "no garment available for generation")
        return None

    payload = {
        "garment_ids": [target_garment],
        "num_variations": 1,
        "model_gender": "donna",
        "model_age": "giovane",
        "model_body": "slim",
        "model_ethnicity": "caucasica",
        "pose": "casual_standing",
        "background": "white_studio",
    }
    t0 = time.time()
    r = http_post("/generations", payload, timeout=120)
    dt = time.time() - t0
    if r.status_code == 429:
        print(f"[SKIP] {label}  (Gemini rate limited, code 429)")
        return None
    if r.status_code == 502:
        print(f"[SKIP] {label}  (Gemini 502: {r.text[:150]})")
        return None
    if r.status_code != 200:
        _bad(label, f"status={r.status_code} body={r.text[:200]}")
        return None
    d = r.json()
    gen_id = d.get("id")
    if not gen_id:
        _bad(label, "no gen id in response")
        return None
    if d.get("status") != "done":
        print(f"[NOTE] generation status={d.get('status')} (took {dt:.1f}s)")

    rd = http_get(f"/generations/{gen_id}")
    if rd.status_code != 200:
        _bad(label_c, f"detail status={rd.status_code}")
        return gen_id
    det = rd.json()
    imgs = det.get("images") or []
    thumbs = det.get("thumbs") or []
    if not imgs:
        print(f"[NOTE] gen has no images (status={det.get('status')}); skipping alignment check")
    else:
        if len(thumbs) != len(imgs):
            _bad(label_c, f"thumbs len={len(thumbs)} != images len={len(imgs)}")
        elif any(not t for t in thumbs):
            _bad(label_c, f"one or more thumbs are empty: {[bool(t) for t in thumbs]}")
        else:
            _ok(label_c, extra=f"gen={gen_id} images={len(imgs)} thumbs={len(thumbs)}")
        _ok(label, extra=f"gen={gen_id} status={det.get('status')} dt={dt:.1f}s")

    rl2 = http_get("/generations")
    if rl2.status_code != 200:
        _bad(label_b, f"status={rl2.status_code}")
        return gen_id
    items = rl2.json()
    row = next((it for it in items if it["id"] == gen_id), None)
    if not row:
        _bad(label_b, f"gen {gen_id} not in list")
    else:
        if "images" in row:
            _bad(label_b, "list row leaks images[]")
        elif row.get("thumbnail") is None and imgs:
            _bad(label_b, "thumbnail is None despite gen having images")
        else:
            _ok(label_b, extra=f"image_count={row.get('image_count')} thumbnail={'present' if row.get('thumbnail') else 'none'}")
    return gen_id


# -------------- 5) studio edit appends both ------------------------------------
def test_5_studio_edit_appends_both(gen_id: Optional[str]) -> None:
    label = "5) POST /api/studio/edit appends image AND thumb to gen (lengths +1)"
    if not gen_id:
        print(f"[SKIP] {label}  (no gen_id available)")
        return

    rd = http_get(f"/generations/{gen_id}")
    if rd.status_code != 200:
        print(f"[SKIP] {label}  (detail status={rd.status_code})")
        return
    before = rd.json()
    imgs_before = before.get("images") or []
    thumbs_before = before.get("thumbs") or []
    if not imgs_before:
        print(f"[SKIP] {label}  (gen has no images to edit)")
        return

    payload = {
        "image_base64": imgs_before[0],
        "edit_prompt": "Subtle warm tone, no other changes.",
        "gen_id": gen_id,
    }
    t0 = time.time()
    r = http_post("/studio/edit", payload, timeout=120)
    dt = time.time() - t0
    if r.status_code in (429, 502):
        print(f"[SKIP] {label}  (Gemini {r.status_code}: {r.text[:140]})")
        return
    if r.status_code != 200:
        _bad(label, f"status={r.status_code} body={r.text[:200]}")
        return

    rd2 = http_get(f"/generations/{gen_id}")
    if rd2.status_code != 200:
        _bad(label, f"detail status={rd2.status_code}")
        return
    after = rd2.json()
    imgs_after = after.get("images") or []
    thumbs_after = after.get("thumbs") or []
    if len(imgs_after) != len(imgs_before) + 1:
        _bad(label, f"images grew {len(imgs_before)}→{len(imgs_after)}; expected +1")
    elif len(thumbs_after) != len(thumbs_before) + 1:
        _bad(label, f"thumbs grew {len(thumbs_before)}→{len(thumbs_after)}; expected +1")
    elif not thumbs_after[-1]:
        _bad(label, "appended thumb is empty")
    else:
        _ok(label, extra=f"gen={gen_id} images={len(imgs_before)}→{len(imgs_after)} thumbs={len(thumbs_before)}→{len(thumbs_after)} dt={dt:.1f}s")


# -------------- 6) orphan cleanup on delete ------------------------------------
def test_6_orphan_cleanup() -> None:
    label = "6) DELETE /api/generations/{id} sweeps short_links/videos/tg_publications"

    # Need a gen that has at least one image so POST /short-links accepts it.
    # We'll trigger a fresh single-variation generation specifically for this
    # test so we don't destroy any existing demo data.
    rl_g = http_get("/garments")
    real = None
    if rl_g.status_code == 200:
        real = next((g for g in rl_g.json() if g["id"] == "g_test_demo01"), None) or (
            rl_g.json()[0] if rl_g.json() else None
        )
    if not real:
        _bad(label, "no garment available")
        return
    gr = http_post(
        "/generations",
        {
            "garment_ids": [real["id"]],
            "num_variations": 1,
            "model_gender": "donna",
            "model_age": "giovane",
            "model_body": "slim",
            "model_ethnicity": "caucasica",
            "pose": "casual_standing",
            "background": "white_studio",
        },
        timeout=180,
    )
    if gr.status_code != 200 or not (gr.json().get("images") or []):
        print(f"[SKIP] {label}  (Gemini didn't produce an image: status={gr.status_code} body={gr.text[:120]})")
        return
    gen_id = gr.json()["id"]

    # 1) mint a short_link
    sl = http_post("/short-links", {"gen_id": gen_id, "image_index": 0, "look_name": "Orphan test"})
    if sl.status_code != 200:
        _bad(label, f"POST /short-links failed: {sl.status_code} {sl.text[:120]}")
        return

    # 2) seed a fake video and a fake tg_publication referencing the gen
    token_uniq = f"tok_orphan_test_xx_{int(time.time())}"
    js_payload = f"""
db = db.getSiblingDB("dressvibe");
db.videos.insertOne({{id: "vid_orphan_test_xx_{int(time.time())}", user_id: "user_demo01", gen_id: "{gen_id}", created_at: new Date()}});
db.tg_publications.insertOne({{token: "{token_uniq}", user_id: "user_demo01", gen_id: "{gen_id}", created_at: new Date()}});
print("seeded-sl:" + db.short_links.countDocuments({{gen_id:"{gen_id}"}}));
print("seeded-vid:" + db.videos.countDocuments({{gen_id:"{gen_id}"}}));
print("seeded-tg:" + db.tg_publications.countDocuments({{gen_id:"{gen_id}"}}));
"""
    seed = run_mongosh(js_payload)
    print(f"[SEED] {seed.strip()}")

    # Pre-counts should all be > 0
    pre = {}
    for line in seed.strip().splitlines():
        k, _, v = line.partition(":")
        try:
            pre[k.strip()] = int(v.strip())
        except ValueError:
            pass
    if not pre or any(v < 1 for v in pre.values()):
        _bad(label, f"seed failed, pre-counts: {pre} raw={seed!r}")
        return

    # 3) DELETE the gen
    d = http_delete(f"/generations/{gen_id}")
    if d.status_code != 200:
        _bad(label, f"DELETE /generations status={d.status_code}")
        return

    # 4) verify sweep
    js_check = f"""
db = db.getSiblingDB("dressvibe");
print("post-sl:" + db.short_links.countDocuments({{gen_id:"{gen_id}"}}));
print("post-vid:" + db.videos.countDocuments({{gen_id:"{gen_id}"}}));
print("post-tg:" + db.tg_publications.countDocuments({{gen_id:"{gen_id}"}}));
print("post-gen:" + db.generations.countDocuments({{id:"{gen_id}"}}));
"""
    out = run_mongosh(js_check)
    print(f"[CHECK] {out.strip()}")
    counts = {}
    for line in out.strip().splitlines():
        k, _, v = line.partition(":")
        try:
            counts[k.strip()] = int(v.strip())
        except ValueError:
            pass
    failures = [k for k, v in counts.items() if v != 0]
    if failures:
        _bad(label, f"orphans remain: {counts}")
    else:
        _ok(label, extra=f"gen={gen_id} pre={pre} post={counts}")


# -------------- 7) image delete keeps thumbs aligned ---------------------------
def test_7_image_delete_keeps_aligned() -> None:
    label = "7) DELETE /generations/{id}/images/0 keeps thumbs aligned (both -1)"

    rl = http_get("/generations")
    target_gen = None
    if rl.status_code == 200:
        for it in rl.json():
            if it.get("image_count", 0) >= 2:
                target_gen = it["id"]
                break

    if not target_gen:
        # Try to manufacture by running a 2-variation gen on g_test_demo01
        rl_g = http_get("/garments")
        if rl_g.status_code == 200:
            real = next((g for g in rl_g.json() if g["id"] == "g_test_demo01"), None) or (
                rl_g.json()[0] if rl_g.json() else None
            )
            if real:
                gr = http_post(
                    "/generations",
                    {
                        "garment_ids": [real["id"]],
                        "num_variations": 2,
                        "model_gender": "donna",
                        "model_age": "giovane",
                        "model_body": "slim",
                        "model_ethnicity": "caucasica",
                        "pose": "casual_standing",
                        "background": "white_studio",
                    },
                    timeout=180,
                )
                if gr.status_code == 200 and len(gr.json().get("images") or []) >= 2:
                    target_gen = gr.json()["id"]

    if not target_gen:
        print(f"[SKIP] {label}  (no gen with ≥2 images available)")
        return

    rd = http_get(f"/generations/{target_gen}")
    if rd.status_code != 200:
        _bad(label, f"detail status={rd.status_code}")
        return
    before = rd.json()
    n_imgs = len(before.get("images") or [])
    n_thumbs = len(before.get("thumbs") or [])
    if n_imgs != n_thumbs:
        _bad(label, f"pre-condition violated: images={n_imgs} thumbs={n_thumbs}")
        return
    if n_imgs < 2:
        print(f"[SKIP] {label}  (gen now has {n_imgs} images)")
        return

    di = http_delete(f"/generations/{target_gen}/images/0")
    if di.status_code != 200:
        _bad(label, f"DELETE image status={di.status_code} body={di.text[:120]}")
        return

    rd2 = http_get(f"/generations/{target_gen}")
    if rd2.status_code != 200:
        _bad(label, f"post-detail status={rd2.status_code}")
        return
    after = rd2.json()
    n_imgs2 = len(after.get("images") or [])
    n_thumbs2 = len(after.get("thumbs") or [])
    if n_imgs2 != n_imgs - 1:
        _bad(label, f"images expected {n_imgs-1}, got {n_imgs2}")
    elif n_thumbs2 != n_thumbs - 1:
        _bad(label, f"thumbs expected {n_thumbs-1}, got {n_thumbs2}")
    elif n_imgs2 != n_thumbs2:
        _bad(label, f"misaligned after delete: images={n_imgs2} thumbs={n_thumbs2}")
    else:
        _ok(label, extra=f"gen={target_gen} {n_imgs}→{n_imgs2} (images), {n_thumbs}→{n_thumbs2} (thumbs)")


# -------------- 8) backfill ran on startup -------------------------------------
def test_8_backfill() -> None:
    label_l = "8a) backend log contains '[backfill] thumbnail sweep complete'"
    label_c = "8b) db.garments has at least one thumb_base64 populated"

    out = os.popen("grep -l 'thumbnail sweep complete' /var/log/supervisor/backend.*.log 2>/dev/null").read().strip()
    if not out:
        _bad(label_l, "log marker not found")
    else:
        _ok(label_l, extra=out.splitlines()[0])

    js = '''
db = db.getSiblingDB("dressvibe");
print(db.garments.countDocuments({thumb_base64: {$exists: true, $ne: null}}));
'''
    raw = run_mongosh(js).strip()
    try:
        n = int(raw.splitlines()[-1])
    except Exception:
        n = -1
    if n <= 0:
        _bad(label_c, f"count={raw}")
    else:
        _ok(label_c, extra=f"garments_with_thumb={n}")


# -------------- entry ----------------------------------------------------------
def main() -> int:
    print(f"BASE={BASE}")
    print(f"USER={USER_ID} TOKEN=test_session_screen")
    print("-" * 72)

    test_1_list_endpoints_lean()
    print()
    info = test_2_detail_endpoints()
    print()
    new_garment_id = test_3_garment_thumb_post()
    print()
    new_gen_id = test_4_generation_thumbs(new_garment_id)
    print()
    test_5_studio_edit_appends_both(new_gen_id or (info.get("gen_id") if info else None))
    print()
    test_6_orphan_cleanup()
    print()
    test_7_image_delete_keeps_aligned()
    print()
    test_8_backfill()

    print()
    print("=" * 72)
    print(f"PASS: {len(PASS)}")
    print(f"FAIL: {len(FAIL)}")
    for f in FAIL:
        print(f"  - {f}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
