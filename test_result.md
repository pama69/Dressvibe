#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  DressVibe — Italian clothing-store assistant. Generate model photos & videos from garment
  photos, edit in Studio, publish to Telegram channel (with PRENOTA inline button) and
  share via the native share sheet (Instagram-ready).

backend:
  - task: "Telegram publish supports BOTH photo and video"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          /api/telegram/publish now accepts media_type='photo'|'video'.
          For video: tries sendVideo with the xAI URL first; if Telegram refuses
          the URL, downloads the bytes and re-uploads as multipart sendVideo.
          PRENOTA inline button is attached identically for both media types.
      - working: true
        agent: "testing"
        comment: |
          Backend test executed via /app/backend_test.py against
          https://outfit-gen-11.preview.emergentagent.com/api with Bearer
          test_session_screen (user_demo01). 11/11 cases passed:
            * validation_video_missing_url → 400 "video_url richiesto..."
            * validation_photo_missing_image → 400 "image_base64 richiesto..."
            * validation_default_no_image (no media_type, no image) → 400
            * happy_photo_response → 200, ok=True, channel_message_id=20,
              token returned, media_type="photo"
            * happy_photo_db_row → row inserted in db.tg_publications with
              media_type="photo" and matching channel_message_id
            * happy_video_response (xAI mp4) → 200, channel_message_id=21,
              media_type="video" (Telegram accepted the URL on first try, no
              fallback needed)
            * happy_video_db_row → row inserted with media_type="video"
            * regression_providers → 200
            * regression_generation_videos (gen_web_test1) → 200 (1 video)
            * regression_delete_missing_404 → 404
            * regression_delete_existing_200 → 200 (after inserting a throwaway
              videos row)
          No issues detected; PRENOTA inline button paths present in both
          branches.

frontend:
  - task: "Studio: free description field for Telegram post + publish video to Telegram"
    implemented: true
    working: true
    file: "/app/frontend/app/(app)/studio/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          - Added "📝 DESCRIZIONE DEL POST TELEGRAM" multiline input (max 1000 chars,
            live counter) — replaces the auto "Generazione del…" title as the
            Telegram caption.
          - Each generated VideoCard now exposes a "🚀 Pubblica TG" action that
            posts the video to the Telegram channel with the same description and
            the PRENOTA inline button.
          - Existing PUBBLICA TG (photo) and Instagram native share now use the
            same description fallback chain: tgDescription -> IG caption -> default.
          - Verified visually at /studio/gen_web_test1?index=0 — all controls
            render and the bottom tab bar respects safe-area insets.

  - task: "VideoCard supports publishToTelegram callback"
    implemented: true
    working: true
    file: "/app/frontend/src/components/VideoCard.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Added onPublishTelegram + publishingTelegram props with Telegram-blue styled button (disabled+'Invio…' label while busy)."

  - task: "Custom Backgrounds endpoints (CRUD)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Tested via /app/backend_test_backgrounds.py against
          https://outfit-gen-11.preview.emergentagent.com/api with Bearer
          test_session_screen (user_demo01).
            * GET /api/backgrounds → 200, returns 2 pre-seeded items
              (bg_demo01_a "Vetrina natalizia", bg_demo01_b "Borgo medievale")
              each with non-empty image_base64, sorted desc by created_at ✅
            * POST /api/backgrounds {name:"Test BG", image_base64:<1x1 PNG>,
              description} → 200, returned id starts with "bg_", user_id is
              user_demo01, image_base64 echoed back ✅
            * GET /api/backgrounds → new item present (count went 2→3) ✅
            * DELETE /api/backgrounds/{id} → 200 {"ok":true}, item removed
              from subsequent GET; second DELETE on the same id → 404
              {"detail":"Sfondo non trovato"} ✅
            * Validation: POST /api/backgrounds with body {name:"Bad BG"}
              (no image_base64) → 422 with pydantic "missing" detail on
              body.image_base64 ✅

  - task: "POST /api/generations accepts custom_background_id"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Integration with /api/generations verified.
            * Valid custom_background_id (freshly created with a tiny valid
              1x1 PNG) + garment_ids=[g_test_demo01], num_variations=1
              → 200 in ~10s, status="done", images[0] is a base64 string
              (Gemini gemini-3.1-flash-image-preview), and
              params.custom_background_id is preserved in the gen_doc ✅
            * Nonexistent custom_background_id="nonexistent" + same garment
              → 200 in ~18s, status="done", images[0] non-empty, and
              params.custom_background_id="nonexistent" preserved. The bg
              lookup yields no extra ref and the standard background flow
              kicks in — no error, exactly as required ✅
            * Pre-seeded backgrounds bg_demo01_a and bg_demo01_b in the
              database happen to contain CORRUPT/TRUNCATED PNG bytes
              (exactly 225000 / 150000 bytes, PIL reports "Truncated File
              Read"). When fed to Gemini as the LAST reference image, the
              upstream returns:
                  GeminiException 400: "Unable to process input image"
              and the generation completes with status="failed", images=[]
              — but params.custom_background_id is still preserved.
              This is a SEED-DATA issue (the two demo .png blobs are
              truncated), NOT a server.py bug. Verified by uploading a
              valid PNG via POST /api/backgrounds and re-running the same
              request: status=done, 1 image returned, params preserved.
          Net: the custom_background_id wiring in create_generation
          (lookup + ref append + label propagation + params persistence)
          is correct and working end-to-end.

metadata:
  created_by: "main_agent"
  version: "1.4"
  test_sequence: 5
  run_ui: false

backend:
  - task: "POST /api/generations rate-limit refactor (bounded retry + fast 429)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Tested via /app/backend_test_ratelimit.py against
          https://outfit-gen-11.preview.emergentagent.com/api with Bearer
          test_session_screen (user_demo01) + seeded garment g_test_demo01.
          7/7 cases PASS.

          A) Happy path single gen (num_variations=1):
             POST /api/generations → 200 in 17.3s, status="done",
             images count = 1, gen_id=gen_f82839fc477c.
             (Well under the 30s SLA.)
          B) Immediate 2nd gen (num_variations=1):
             POST /api/generations → 200 in 17.8s, status="done",
             images count = 1.
             Total elapsed bound: 17.8s << 35s budget. Even when Gemini
             does NOT rate-limit (today's case), the call returns fast
             and the previous 70-120s hang is gone. The 25-second hard
             wall-clock budget + 2 models × 2 attempts logic is in
             place in _gemini_direct_generate_image() and verified.
             The fast-429 path (raise HTTPException(429, "Limite
             Gemini raggiunto...")) was not exercised live because no
             rate-limit was triggered, but the code path is wired:
                * _gemini_direct_generate_image sets
                  _dv_rate_limited=True on the exception and bails.
                * generate_single_image catches it and raises
                  HTTPException(429) when Emergent fallback also
                  fails on rate limit.
                * create_generation uses asyncio.gather(...,
                  return_exceptions=True) and translates 429s into a
                  clean HTTP 429 (gen_doc persisted with
                  status="rate_limited"). No code paths can hang
                  beyond ~25s/variation.
          C) Regression sanity (all 200):
             GET /api/health → 200 {ok:true}
             GET /api/providers → 200, keys = [image_gen, image_edit,
                video_gen]
             GET /api/generations → 200, list of 9
             GET /api/garments → 200, list of 1
             GET /api/backgrounds → 200, list of 2
          POST /api/studio/edit was intentionally NOT exercised (per
          review request — also consumes Gemini); it shares
          generate_single_image() so the same 429 propagation applies.

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Iteration: added Telegram publishing for videos and a dedicated free-text
      Telegram description field. Verified visually. Awaiting user verification
      from their phone (the user has been actively testing — backend logs show
      successful video generation and image publish today).
  - agent: "testing"
    message: |
      Backend tests for /api/telegram/publish (photo + video) all PASS (11/11).
      Validation 400s correct, photo & video happy paths return 200 with
      channel_message_id and persist rows in db.tg_publications (media_type
      correct). xAI mp4 was accepted by Telegram URL-mode directly (no
      multipart fallback needed). Regression checks: GET /api/providers,
      GET /api/generations/gen_web_test1/videos, DELETE /api/videos/<id>
      (404 + 200) all pass. Test script at /app/backend_test.py.
  - agent: "testing"
    message: |
      Custom Backgrounds suite (/app/backend_test_backgrounds.py): 8/9 PASS
      on first run, 9/9 PASS after substituting a freshly-uploaded valid PNG
      for case 5a. All 6 review-request cases verified:
        1) GET /api/backgrounds — 2 pre-seeded items, sorted desc, image_b64 present ✅
        2) POST /api/backgrounds — 200, id starts with "bg_" ✅
        3) GET shows new item ✅
        4) DELETE 200 then 404 on re-delete ✅
        5a) /api/generations with custom_background_id="bg_demo01_a" returned
            200 but gen.status="failed" because the SEED PNG for bg_demo01_a
            (and bg_demo01_b) is a truncated/corrupt PNG that Gemini rejects
            with "Unable to process input image". params.custom_background_id
            IS preserved. Confirmed integration is correct by repeating the
            test with a freshly-created valid background (status="done",
            images[0] non-empty, params preserved). Action item for main:
            re-seed bg_demo01_a / bg_demo01_b with non-truncated PNGs (or
            JPEGs) so the demo flow actually returns generated images. ✅ (code)
        5b) custom_background_id="nonexistent" → 200, status="done",
            images[0] non-empty, params preserved — no error ✅
        6) POST /api/backgrounds without image_base64 → 422 ✅
      Telegram/video/studio paths were intentionally NOT retested (out of scope).
