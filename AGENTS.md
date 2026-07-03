# DressVibe — Migrazione da Emergent a Railway

App di **virtual try-on** per piccoli/medi negozi di abbigliamento.
Flusso: Galleria (capi) → AI veste una modella → Storia (immagini generate) → editing → pubblicazione social (Instagram/Facebook/WhatsApp/Telegram).

- **Backend:** FastAPI (Python) monolite in `backend/server.py` (~185 KB), MongoDB (Motor), provider registry in `backend/providers.py`.
- **Frontend:** Expo / React Native + expo-router (TypeScript), in `frontend/`. Web export statico servito dallo stesso host.
- **Dominio target:** dressvibe.app (hosting Aruba, mail attiva, deploy su Railway).

---

## Istruzioni operative (Codex)

- ⚠️ **Chiedere SEMPRE autorizzazione prima di ogni `git push`** — sia sul branch di lavoro sia, soprattutto, prima di ogni merge/push su `main` (che è collegato al deploy automatico su Railway). Commit e modifiche in locale non richiedono conferma; il push sì, sempre.

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

### 2026-07-01 — Restyling UX generazione + flusso pubblicazione ✅
Serie di migliorie UX su Galleria/Genera/Studio (tutte in `frontend/`, pushate su `main-mf20se`).
- **Pulizia archivio automatica + menu Genera** (`9862886`): impostazione `archive_retention_months` (1–6) e cleanup automatico all'apertura app (mostra n° capi/generazioni rimossi). Restyling pannello Genera: chip "Scegli modella" in linea con i pulsanti età, opzione "Scarpa custom", pulsanti Look uniformi, "Scena" → "Posa modello".
- **Ritocchi guidati sul prompt** (`cd73f0d`, `3a11e50`): 5 domande guidate (Rimuovi / Cambia colori / Cambia ambientazione / Cambia posa / Altro) iniettate come override ad alta priorità nel prompt di generazione. Componente riusabile `PromptTweaks` (predisposto per lo Studio, non ancora agganciato lì).
- **Categorie capo obbligatorie + ruoli multi-capo** (`558f012`): 8 categorie obbligatorie all'upload (Giacca, Camicia, Maglia, Vestito, Pantalone, Gonna, Accessorio, Outfit completo) con selezione a tap singolo e validazione; etichettatura per ruolo (top/bottom/full-body/shoes) con iniezione intelligente dei basici e ordine preservato nella generazione multi-capo.
- **Caption unificata** (`2bdff9b`): unico campo "Testo del post" + "✨ Genera con AI" (un solo copywriter); stesso testo su tutti i canali (Instagram/Facebook/Telegram/WhatsApp).
- **Flusso pubblicazione** (`d4007e4`, `09a0ab2`, `4c5806e`, `565445d`): pulsante "Pubblica" su ogni risultato nella griglia; `PublishSheet` unico coi soli canali configurati (ricorda l'ultimo usato); "Scarica" come pulsante piccolo affiancato a "Pubblica"; apertura foglio affidabile via `useFocusEffect`; reset selezione capo/ritocchi tra generazioni.
- **Fix Telegram nel foglio Pubblica** (`541b229`): `chTg` ora richiede canale personale + termini bot accettati alla versione corrente (combacia con il gate backend `/telegram/publish`); prima il canale di default lo faceva comparire ma la pubblicazione rispondeva "non configurato".
- **Fix web build** (`d0733d6`): il build web usa l'origin del browser invece dell'hardcoded `dressvibe.app`.

> ⏳ **Rimasto da fare:** setup canali "al volo" dal `PublishSheet` (evitare il rimbalzo a Profilo → Impostazioni).

### 2026-07-01 — PromptTweaks agganciato allo Studio ✅
I "ritocchi guidati" ora sono disponibili anche nell'editing dello Studio, con le stesse 5 domande e la stessa logica della schermata Genera.
- **Backend** [backend/server.py](backend/server.py): `StudioEditRequest` accetta i campi `tweak_remove/color/setting/pose/other`; `studio_edit` compone `compose_user_tweaks_suffix(...)` e lo appende **in fondo** al prompt (dopo accessori/prezzi → massima priorità), condividendo l'helper col flusso di generazione.
- **Client** [client.ts](frontend/src/api/client.ts): `studioEdit` accetta un parametro opzionale `tweaks` (payload `tweak_*`) e lo inoltra.
- **Studio** [studio/[id].tsx](frontend/app/(app)/studio/[id].tsx): sezione "🎯 Ritocchi guidati" sotto "Modifica personalizzata" (riusa il componente `PromptTweaks`); i ritocchi abilitano "Applica modifica", vengono inviati con la modifica e **azzerati one-shot** dopo l'edit (come nella generazione).
- Verifica: `py_compile` backend OK; `tsc --noEmit` sui file toccati OK (restano 3 errori pre-esistenti in `history.tsx`/`index.tsx`, non correlati).

### 2026-07-02 — Pubblicazione video unificata col flow foto ✅
Prima, i video generati nello Studio avevano un flusso di pubblicazione "proprietario": una riga fissa di 3 pulsanti (WhatsApp/Telegram/Instagram) sulla `VideoCard`, sempre visibili anche quando il canale non era configurato (a differenza delle foto, dove il `PublishSheet` mostra solo i canali realmente pronti). Nella schermata Storia → Risultati, i video non avevano **nessun** modo di pubblicare: solo Studio/Salva/Elimina.
- **`VideoCard`** [VideoCard.tsx](frontend/src/components/VideoCard.tsx): rimossi i prop `onShareInstagram/onShareWhatsApp/onPublishTelegram/publishing*/onShare` e la riga a 3 pulsanti; sostituiti da un unico prop `onPublish` + `publishing`, stesso trattamento visivo del CTA "Pubblica" delle foto.
- **`PublishSheet`** [PublishSheet.tsx](frontend/src/components/PublishSheet.tsx): aggiunto `subtitle` opzionale per distinguere "questo scatto" da "questo video" nello stesso foglio.
- **Studio** [studio/[id].tsx](frontend/app/(app)/studio/[id].tsx): nuovo stato `videoPublishTarget`; nuova funzione `videoPublishChannels(video)` (parallela a `publishChannels`) che riusa `handlePublishVideoTelegram`/`shareVideoToWhatsApp`/l'`InstagramShareSheet` esistenti, filtrati per `chTg`/`chWa` come le foto. Instagram resta sempre manuale per i video (Zernio, l'auto-publish IG/FB, supporta solo foto lato backend) — niente Facebook per i video, coerente col principio "mostra solo i canali che funzionano davvero". Il pulsante "Pubblica" su ogni `VideoCard` apre lo stesso `PublishSheet` scoping sul video; nuovo parametro URL `publishVideoId` (parallelo a `focus=publish`) apre il foglio automaticamente arrivando da Risultati.
- **Risultati** [results/[id].tsx](frontend/app/(app)/results/[id].tsx): aggiunto `onPublish` sulla `VideoCard` → naviga in Studio con `publishVideoId`, stesso pattern del pulsante "Pubblica" già presente sulle foto.
- Verifica: `py_compile` backend OK (nessuna modifica lato backend per questo task); `tsc --noEmit` sui file toccati OK (stessi 3 errori pre-esistenti non correlati).

### 2026-07-02 — Fix "indietro" da Risultati (tornava al menu invece che a Storia) ✅
Il pulsante indietro in [results/[id].tsx](frontend/app/(app)/results/[id].tsx) faceva `router.replace("/(app)")` **fisso**, ignorando da dove si arrivava: da Storia (`history.tsx`) tornava sempre al menu principale invece che alla lista Storia. Sostituito con `router.canGoBack() ? router.back() : router.replace("/(app)")`, che fa il "pop" reale dello stack di navigazione (torna a Storia se si arriva da lì, o al flusso Genera se si arriva da una generazione appena creata), con fallback al menu solo se non c'è history da cui tornare.

### 2026-07-02 — CTA "Carica Altro" al posto del "+" in header (Galleria) ✅
Il pulsante "+" in alto a destra nella Galleria [index.tsx](frontend/app/(app)/index.tsx) era poco visibile (piccolo, in un angolo, vicino alla campanella notifiche). Rimosso e sostituito con una barra fissa **"Carica Altro"** sopra la tab bar (icona + testo, stessa posizione/ombra della barra azioni già usata in `history.tsx`), mostrata solo quando la galleria ha già almeno un capo — la schermata vuota mantiene il suo CTA esistente "+ Carica capo". Rimossi gli stili `uploadFab`/`fabPlus` non più usati; riattivato e ristilizzato `uploadFabBig` (era dead code da una versione precedente).

### 2026-07-02 — Distacco asset da Emergent (indipendenza completa) ✅
Ultimo legame runtime con Emergent rimosso: le 2 immagini ancora hot-linkate dalla CDN `static.prod-images.emergentagent.com` (sfondo login + aura generazione) sono state **scaricate in locale** in [frontend/assets/images/](frontend/assets/images/) (`login-hero.png`, `generating-aura.png`) e referenziate via `require`.
- [login.tsx](frontend/app/login.tsx): `HERO_BG` ora `require("@/assets/images/login-hero.png")` (source diretta, non più `{uri}`).
- [generating.tsx](frontend/app/(app)/generating.tsx): `MAGIC_AURA` ora `require("@/assets/images/generating-aura.png")`.
- [server.py](backend/server.py): pulito il log fuorviante `will try Emergent fallback once` (il fallback non esiste più).
- **Verifica distacco:** nessuna env var, chiamata HTTP o asset runtime punta più a Emergent. Backend/LLM/auth/deploy/DB interamente su Railway + Atlas + Gemini. Restano solo riferimenti in **test** (`backend_test_*.py`, `tests/`) e **docs** (`design_guidelines.json`, `test_reports/`), non in produzione.
- **→ Emergent può essere disattivato.** Unico check consigliato prima di spegnerlo: aprire login e schermata di generazione e verificare che le immagini (ora locali) si vedano.

### Prossimi step
- [ ] Setup canali al-volo dal foglio Pubblica (no rimbalzo al Profilo).
- [ ] (Consigliato) Pulizia `requirements.txt` dai pacchetti Emergent inutilizzati.
- [ ] Pulizia stili inutilizzati in `login.tsx` (emailBtn/divider*).
- [ ] (Facoltativo) Ripulire i riferimenti al vecchio URL preview Emergent nei file di test (`backend_test_*.py`, `tests/conftest.py`).
