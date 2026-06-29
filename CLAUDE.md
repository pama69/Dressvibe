# DressVibe — Migrazione da Emergent a Railway

App di **virtual try-on** per piccoli/medi negozi di abbigliamento.
Flusso: Galleria (capi) → AI veste una modella → Storia (immagini generate) → editing → pubblicazione social (Instagram/Facebook/WhatsApp/Telegram).

- **Backend:** FastAPI (Python) monolite in `backend/server.py` (~185 KB), MongoDB (Motor), provider registry in `backend/providers.py`.
- **Frontend:** Expo / React Native + expo-router (TypeScript), in `frontend/`. Web export statico servito dallo stesso host.
- **Dominio target:** dressvibe.app (hosting Aruba, mail attiva, deploy su Railway).

---

## Dipendenze Emergent da rimuovere

| # | Dipendenza | Dove | Sostituto |
|---|-----------|------|-----------|
| 1 | `emergentintegrations` (pkg pip) + `EMERGENT_LLM_KEY` | `backend/server.py` (5 usi: image gen fallback, caption x2) + `requirements.txt` | SDK diretti: `google-genai` (Gemini, già presente), `openai` |
| 2 | Google OAuth via Emergent (`auth.emergentagent.com`, `demobackend.emergentagent.com/.../session-data`) | `backend/server.py` `/auth/session` (riga ~260) + `frontend/.../AuthContext.tsx` `signIn` (riga ~127) | Google OAuth proprietario (Google Cloud Console + dominio dressvibe.app) |
| 3 | Deployment Emergent (`expo_mongo_base_image_cloud`) | `.emergent/emergent.yml` | Railway (backend + MongoDB plugin) |
| 4 | Immagini statiche su `static.prod-images.emergentagent.com` | `frontend/app/login.tsx`, `frontend/app/(app)/generating.tsx` | Asset locali in `frontend/assets/` o storage proprio |
| 5 | URL backend hardcoded preview emergent (commenti/fallback) | `frontend/src/api/client.ts` | `EXPO_PUBLIC_BACKEND_URL` = dominio Railway/dressvibe.app |

**Nota:** esiste GIÀ un percorso diretto Gemini (`_gemini_client` via `google-genai`) e un'autenticazione email/password (Resend OTP) parallela all'OAuth. La migrazione è quindi a metà strada.

---

## Stato variabili d'ambiente (backend `.env`)

Richieste: `MONGO_URL`, `DB_NAME`, `EMERGENT_LLM_KEY` (da rimuovere), `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL_CHAIN`, `XAI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `PUBLIC_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_WEBHOOK_SECRET`. Da aggiungere: credenziali Google OAuth proprie.

---

## Piano di distacco (ordine consigliato)

1. **LLM:** sostituire tutti i `LlmChat`/`EMERGENT_LLM_KEY` con chiamate dirette `google-genai` + `openai`; rimuovere `emergentintegrations` da `requirements.txt`.
2. **OAuth Google proprietario** (backend + frontend) — oppure, come ponte, affidarsi solo a email/password già presente.
3. **Deploy Railway:** Dockerfile/Procfile backend, MongoDB, build web Expo, env vars.
4. **Asset & branding:** rimpiazzare immagini emergent, configurare dominio dressvibe.app.

---

## Changelog modifiche

### 2026-06-29 — Distacco LLM da Emergent ✅
- Rimosso `from emergentintegrations.llm.chat import ...` e la variabile `EMERGENT_LLM_KEY` da [backend/server.py](backend/server.py).
- Aggiunto helper `_gemini_direct_generate_text(system_msg, user_prompt)` (chiamata diretta `google-genai`) accanto a `_gemini_direct_generate_image`.
- Sostituiti tutti e 5 gli usi di `LlmChat`:
  - image-gen: rimosso il fallback Emergent (ora solo Gemini diretto; in assenza di immagine ritorna `None`/429).
  - `/caption`: ora usa `_gemini_direct_generate_text`.
  - caption Instagram: rimosso il branch `else` LlmChat, usa l'helper diretto.
  - `zernio_caption`: usa l'helper diretto.
- Rimosso `emergentintegrations==0.1.0` da [backend/requirements.txt](backend/requirements.txt).
- `python -m py_compile backend/server.py` → OK.

> ⚠️ **Conseguenza:** `GEMINI_API_KEY` è ora **obbligatoria** per generazione immagini e caption (prima c'era il gateway Emergent come fallback). I provider OpenAI/Grok image-gen elencati in `providers.py` non hanno ancora un dispatcher diretto: andranno reimplementati con SDK proprie se servono.

### 2026-06-29 — Distacco Google OAuth (solo email/password) ✅
**Backend** [backend/server.py](backend/server.py):
- Rimosso endpoint `POST /api/auth/session`, modello `SessionCreate` e costante `EMERGENT_AUTH_SESSION_URL`.
- Aggiornato il commento del blocco email: ora è l'unico metodo di autenticazione.
- Restano attivi: `/auth/email/register|verify|login|forgot|reset|resend-code` (OTP via Resend), `/auth/me`, `/auth/logout`.

**Frontend**:
- [AuthContext.tsx](frontend/src/contexts/AuthContext.tsx): rimossi `signIn` (redirect `auth.emergentagent.com`), `parseSessionId`, `processSessionId`, i listener deep-link `session_id` e gli import `expo-linking`/`expo-web-browser`. Mantenuto `signInWithToken` (usato dal flusso email).
- [client.ts](frontend/src/api/client.ts): rimosso `api.exchangeSession` (`POST /auth/session`).
- [login.tsx](frontend/app/login.tsx): rimosso pulsante "Accedi con Google" e divider; "Accedi con Email" è ora il CTA primario.

> Recupero password: già attivo via `/auth/email/forgot` + `/auth/email/reset` con invio OTP tramite **Resend** (`RESEND_API_KEY`, `RESEND_FROM`). Per dressvibe.app verificare il dominio nella dashboard Resend e impostare `RESEND_FROM="DressVibe <noreply@dressvibe.app>"`.

### 2026-06-29 — Verifica dati Atlas (nessuna migrazione necessaria) ✅
Falso allarme "archivio diverso tra Emergent e Railway". Diagnosi via endpoint debug:
- Emergent-preview e Railway puntano allo **stesso** cluster Atlas, stesso `DB_NAME=dressvibe` (verificato confrontando i `.env`).
- I dati sono filtrati per `user_id`. L'utente `pama69@gmail.com` (`user_6e77cc5cf61f`) possiede **11 capi / 23 generazioni / 7 video** = il vero archivio. Gli altri 11 capi sul DB sono dell'account `demo@dressvibe.local` (seed) + 1 di golgolabruzzo.
- **Nessun account Google nascosto**: tutti gli utenti sono `user_xxx` (registrazione email). Niente da riassegnare/migrare.
- Confermato dall'utente: stesso login → stessi capi su entrambi gli ambienti.
- Endpoint admin temporanei (`users-summary`, `reassign-owner`) aggiunti per la diagnosi e **subito rimossi** (il secondo poteva riscrivere la proprietà dei dati con segreto di default). Restano solo i debug read-only.

### 2026-06-29 — Deploy backend su Railway ✅ ONLINE
Backend FastAPI **online** su Railway, connesso a MongoDB Atlas M0. Distacco da Emergent completato (LLM + OAuth + deploy).
- Builder: Dockerfile root del repo (Root Directory non impostato su Railway).
- Avvio via [backend/start.py](backend/start.py) (`CMD ["python","start.py"]`) per gestire `$PORT` a runtime — Railway esegue lo startCommand in exec form e non espande le env var, quindi `startCommand` rimosso da `railway.json`.
- Variabili impostate su Railway: `MONGO_URL`, `DB_NAME=dressvibe` (minuscolo!), `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `PUBLIC_BASE_URL`.
- Trappole risolte durante il deploy: Railpack non trovava il build (→ Dockerfile in root) · `$PORT` non espanso (→ start.py) · auth Atlas fallita (→ "Update User" non cliccato) · `DatabaseDifferCase` (→ `DB_NAME` minuscolo `dressvibe`).

#### ⚠️ TODO sicurezza post-deploy
- [ ] **Rigenerare la password utente Mongo** `Dressvibe` (esposta in chat) e aggiornare `MONGO_URL` su Railway.
- [ ] Restringere il ruolo dell'utente Atlas da `atlasAdmin` a `readWrite` sul solo DB `dressvibe`.

### 2026-06-29 — Scaffolding deploy Railway 🚧
Architettura scelta: **servizio backend unico** (FastAPI API) su Railway + **MongoDB Atlas M0**. App mobile (Expo) punta al backend via `EXPO_PUBLIC_BACKEND_URL`. Web opzionale servito dallo stesso dominio.
- [backend/Dockerfile](backend/Dockerfile): immagine `python:3.12-slim`, build deps, `uvicorn server:app` su `$PORT`.
- [backend/railway.json](backend/railway.json): builder Dockerfile, healthcheck `/api/health`, restart on-failure.
- [backend/.env.example](backend/.env.example): tutte le env documentate.
- [backend/.dockerignore](backend/.dockerignore).
- [backend/server.py](backend/server.py): mount statico opzionale `backend/web/` (serve il build Expo web dallo stesso origin se presente).

#### Procedura deploy (da seguire)
1. **Atlas**: crea cluster M0, utente DB, IP allowlist `0.0.0.0/0`, copia la connection string.
2. **Railway**: New Project → Deploy from GitHub repo (branch `detach-emergent` o `main`).
   - Service settings → **Root Directory = `backend`** (così trova Dockerfile/railway.json).
   - **Variables**: incolla quelle di `.env.example` (almeno `MONGO_URL`, `DB_NAME`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`; `PUBLIC_BASE_URL` = URL Railway).
3. Deploy → verifica `GET https://<app>.up.railway.app/api/health` → `{"ok": true}`.
4. **Dominio**: su Railway aggiungi `dressvibe.app` (custom domain) e configura il CNAME su Aruba; aggiorna `PUBLIC_BASE_URL`.
5. **Mobile**: build Expo (EAS) con `EXPO_PUBLIC_BACKEND_URL=https://dressvibe.app`.

> ⚠️ **Rischio build:** `requirements.txt` ha versioni pinnate "2026" generate da Emergent. Pacchetti **non importati** dal backend (`litellm`, `boto3`, `stripe`, `pandas`) andrebbero rimossi per ridurre tempo/fallimenti di build. Da valutare anche `black/flake8/mypy/isort/pytest` (dev-only).

### Prossimi step
- [ ] Eseguire il deploy su Railway secondo la procedura sopra.
- [ ] (Consigliato) Pulizia `requirements.txt` dai pacchetti Emergent inutilizzati.
- [ ] Asset/branding: rimpiazzare immagini `emergentagent.com` ([login.tsx](frontend/app/login.tsx), [generating.tsx](frontend/app/(app)/generating.tsx)), dominio dressvibe.app.
- [ ] Pulizia stili inutilizzati in `login.tsx` (emailBtn/divider*).
