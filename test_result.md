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

metadata:
  created_by: "main_agent"
  version: "1.2"
  test_sequence: 3
  run_ui: false

test_plan:
  current_focus:
    - "Telegram publish supports BOTH photo and video"
    - "Studio: free description field for Telegram post + publish video to Telegram"
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
