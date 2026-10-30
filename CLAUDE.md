# DressVibe — Migrazione da Emergent a Railway

App di **virtual try-on** per piccoli/medi negozi di abbigliamento.
Flusso: Galleria (capi) → AI veste una modella → Storia (immagini generate) → editing → pubblicazione social (Instagram/Facebook/WhatsApp/Telegram).

- **Backend:** FastAPI (Python) monolite in `backend/server.py` (~185 KB), MongoDB (Motor), provider registry in `backend/providers.py`.
- **Frontend:** Expo / React Native + expo-router (TypeScript), in `frontend/`. Web export statico servito dallo stesso host.
- **Dominio target:** dressvibe.app (hosting Aruba, mail attiva, deploy su Railway).

---

## Istruzioni operative (Claude)

- ⚠️ **Chiedere SEMPRE autorizzazione prima di ogni `git push`** — sia sul branch di lavoro sia, soprattutto, prima di ogni merge/push su `main` (che è collegato al deploy automatico su Railway). Commit e modifiche in locale non richiedono conferma; il push sì, sempre.
- **Dove scrivere la documentazione (2026-10-30).** Il `CLAUDE.md` si paga in token a ogni sessione: qui solo regole, stato attuale, avvertenze e TODO aperti. Il racconto delle modifiche fatte va in `docs/storico-modifiche.md` (in cima); regole valide solo per `backend/` o `frontend/` nel `CLAUDE.md` di quella cartella. Obiettivo: sotto i 40.000 caratteri. Regola generale in `~/.claude/CLAUDE.md`.

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

## Avvertenze e TODO aperti

Il racconto delle modifiche è in `docs/storico-modifiche.md`; qui restano le avvertenze ancora valide.

- ⚠️ **Conseguenza:** `GEMINI_API_KEY` è ora **obbligatoria** per generazione immagini e caption (prima c'era il gateway Emergent come fallback). I provider OpenAI/Grok image-gen elencati in `providers.py` non hanno ancora un dispatcher diretto: andranno reimplementati con SDK proprie se servono. _(da 2026-06-29 — Distacco LLM da Emergent ✅)_

### ⚠️ TODO sicurezza post-deploy _(da 2026-06-29 — Deploy backend su Railway ✅ ONLINE)_
- [ ] **Rigenerare la password utente Mongo** `Dressvibe` (esposta in chat) e aggiornare `MONGO_URL` su Railway.
- [ ] Restringere il ruolo dell'utente Atlas da `atlasAdmin` a `readWrite` sul solo DB `dressvibe`.

- ⚠️ **Rischio build:** `requirements.txt` ha versioni pinnate "2026" generate da Emergent. Pacchetti **non importati** dal backend (`litellm`, `boto3`, `stripe`, `pandas`) andrebbero rimossi per ridurre tempo/fallimenti di build. Da valutare anche `black/flake8/mypy/isort/pytest` (dev-only). _(da 2026-06-29 — Scaffolding deploy Railway 🚧)_
- ⏳ **Rimasto da fare:** setup canali "al volo" dal `PublishSheet` (evitare il rimbalzo a Profilo → Impostazioni). _(da 2026-07-01 — Restyling UX generazione + flusso pubblicazione ✅)_

## Prossimi passi

- [ ] Setup canali al-volo dal foglio Pubblica (no rimbalzo al Profilo).
- [ ] (Consigliato) Pulizia `requirements.txt` dai pacchetti Emergent inutilizzati.
- [ ] Pulizia stili inutilizzati in `login.tsx` (emailBtn/divider*).
- [ ] (Facoltativo) Ripulire i riferimenti al vecchio URL preview Emergent nei file di test (`backend_test_*.py`, `tests/conftest.py`).
