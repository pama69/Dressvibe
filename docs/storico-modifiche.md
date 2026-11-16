# Storico delle modifiche — DressVibe

> Spostato da `CLAUDE.md` il 2026-10-30 per non caricarlo a ogni sessione. Le voci nuove vanno in cima; avvertenze e TODO ancora aperti restano in `CLAUDE.md`.

### 2026-11-16 — Capo su più foto: outfit spalmato su più scatti = fonte unica ✅
Un capo può ora avere fino a 5 foto (1 copertina + 4 extra) che l'AI legge **insieme**, come un'unica fonte, non come capi diversi.

**Backend** [backend/server.py](backend/server.py):
- `GarmentCreate`/`Garment`: nuovo campo `extra_images: List[str]` (cap a 4 in `create_garment`, escluso dalla projection di `GET /api/garments` perché pesante; `GET /api/garments/{id}` lo restituisce).
- `create_generation`: i riferimenti verso Gemini sono la concatenazione di `image_base64` + `extra_images` di ogni capo selezionato; `garment_photo_counts` tiene il numero di foto per capo.
- `_compose_garments_block(categories, photo_counts)` + `build_outfit_prompt(..., garment_photo_counts=...)`: quando un capo ha più foto il prompt le dichiara come intervallo (`references #1-#3 = 3 photos of ONE SINGLE item…`) e vieta esplicitamente di trattarle come capi separati da stratificare. Gli indici dei riferimenti successivi (accessori, sfondo) restano allineati perché `num_garments = len(refs)`.

**Frontend**:
- [upload.tsx](frontend/app/(app)/upload.tsx): stato `images: string[]`, picker con `allowsMultipleSelection`, striscia di miniature con X per rimuovere e tile "+" per aggiungere; tolto il bottone "Cambia" (ora ridondante). Invia `extra_images: images.slice(1)`.
- [garment/[id].tsx](frontend/app/(app)/garment/[id].tsx): striscia delle foto extra sotto la copertina.

**Mosaico in galleria** (stessa giornata): la card mostrava solo la copertina, quindi un outfit su più scatti era indistinguibile da un capo singolo. Ora `create_garment` salva anche `extra_thumbs` (miniature ~6-15 KB delle foto extra, incluse nella lista perché leggere) e la card in [index.tsx](frontend/app/(app)/index.tsx) diventa copertina grande + colonna delle altre foto, con badge `+N` oltre le tre. Per i capi creati prima, `_backfill_thumbnails` ha una nuova sweep (25 doc per boot) che riempie `extra_thumbs` dove mancano.

**Selezione multipla sin dalla prima schermata** (stessa giornata): il picker era già multiplo, ma non si capiva. Ora sopra i bottoni "Scegli foto / Scatta foto" c'è l'istruzione esplicita, e la regola è automatica: **1 foto = capo singolo, 2-5 foto = categoria `outfit`** impostata da sola (resta modificabile a mano). L'hint sotto la striscia cambia di conseguenza.

**Fix serving del web export** (stessa giornata): il mount statico è ora la classe `_WebExport` (sottoclasse di `StaticFiles`, definita a livello di modulo in [backend/server.py](backend/server.py)) e risolve due problemi distinti.
1. **404 su refresh fuori dalla home.** `app.json` ha `web.output: "static"`, quindi l'export produce una pagina per rotta (`upload.html`, `login.html`…). Gli URL reali sono però `/upload`, `/login`: `StaticFiles` non li trovava e rispondeva `{"detail":"Not Found"}` a ogni Ctrl+F5 o link diretto. Ora su 404 si riprova con `path + ".html"` e poi con `index.html`; restano 404 veri i path sotto `api/` e i file con estensione (asset mancanti).
2. **Cache dell'HTML.** `index.html` veniva servito senza `Cache-Control`, quindi dopo un deploy il browser continuava a caricare il bundle vecchio. Ora le sole risposte `text/html` escono con `Cache-Control: no-cache`; gli asset con hash nel nome restano cacheabili.

Check: [backend_test_web_routes.py](backend_test_web_routes.py) (estrae la classe con `ast`, la monta in una `Starlette` e verifica rotta/fallback/404/header) → `ok`.

**Check**: [backend_test_multiphoto_prompt.py](backend_test_multiphoto_prompt.py) (puro, senza Mongo né server: estrae la funzione da `server.py` con `ast`) → `ok`. `npx tsc --noEmit` sul frontend: nessun errore nuovo (resta solo il preesistente `expo-notifications`).


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


### 2026-07-01 — Restyling UX generazione + flusso pubblicazione ✅
Serie di migliorie UX su Galleria/Genera/Studio (tutte in `frontend/`, pushate su `main-mf20se`).
- **Pulizia archivio automatica + menu Genera** (`9862886`): impostazione `archive_retention_months` (1–6) e cleanup automatico all'apertura app (mostra n° capi/generazioni rimossi). Restyling pannello Genera: chip "Scegli modella" in linea con i pulsanti età, opzione "Scarpa custom", pulsanti Look uniformi, "Scena" → "Posa modello".
- **Ritocchi guidati sul prompt** (`cd73f0d`, `3a11e50`): 5 domande guidate (Rimuovi / Cambia colori / Cambia ambientazione / Cambia posa / Altro) iniettate come override ad alta priorità nel prompt di generazione. Componente riusabile `PromptTweaks` (predisposto per lo Studio, non ancora agganciato lì).
- **Categorie capo obbligatorie + ruoli multi-capo** (`558f012`): 8 categorie obbligatorie all'upload (Giacca, Camicia, Maglia, Vestito, Pantalone, Gonna, Accessorio, Outfit completo) con selezione a tap singolo e validazione; etichettatura per ruolo (top/bottom/full-body/shoes) con iniezione intelligente dei basici e ordine preservato nella generazione multi-capo.
- **Caption unificata** (`2bdff9b`): unico campo "Testo del post" + "✨ Genera con AI" (un solo copywriter); stesso testo su tutti i canali (Instagram/Facebook/Telegram/WhatsApp).
- **Flusso pubblicazione** (`d4007e4`, `09a0ab2`, `4c5806e`, `565445d`): pulsante "Pubblica" su ogni risultato nella griglia; `PublishSheet` unico coi soli canali configurati (ricorda l'ultimo usato); "Scarica" come pulsante piccolo affiancato a "Pubblica"; apertura foglio affidabile via `useFocusEffect`; reset selezione capo/ritocchi tra generazioni.
- **Fix Telegram nel foglio Pubblica** (`541b229`): `chTg` ora richiede canale personale + termini bot accettati alla versione corrente (combacia con il gate backend `/telegram/publish`); prima il canale di default lo faceva comparire ma la pubblicazione rispondeva "non configurato".
- **Fix web build** (`d0733d6`): il build web usa l'origin del browser invece dell'hardcoded `dressvibe.app`.


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

