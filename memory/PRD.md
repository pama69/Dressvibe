# DressVibe — PRD

## Vision
DressVibe is a premium mobile app for small/medium Italian clothing stores that
lets shop owners upload photos of their garments and instantly generate
realistic photographs of models (different ages, body types, ethnicities, poses)
wearing those exact clothes. The shop owner can then edit, caption, download
or share each generated image on Telegram / Instagram.

## Target Users
Italian small clothing shop owners (negozianti di abbigliamento).

## Core Flows
1. **Onboarding** — One-tap "Accedi con Google" (Emergent managed Google OAuth).
2. **Galleria capi** — Grid view of uploaded clothes with name, category, price.
3. **Upload capo** — Pick from library or take a photo, tag with name, category,
   color, size, price, season, gender.
4. **Magic Outfit Generator** — Select 1+ garments, pick model gender, age,
   body, ethnicity, pose, background, variations (4/6/8). One-tap
   "✨ Genera Outfit Realistico".
5. **Generating screen** — Luxe loading state with magical aura, rotating
   steps in Italian.
6. **Results gallery** — Bento grid of generated images (1.25:1 portrait).
7. **Studio** — Edit a single image: quick edits (remove bg, change scene),
   custom edit prompt (free-text), AI Instagram caption generator (Italian),
   share to Telegram / Instagram / native share, download HD.
8. **Cliente Virtuale** — Save preferred model presets per real-world client.
9. **History** — Browse past generations.
10. **Profile + Stats** — User info, stats (capi/outfit/clienti), logout.

## Tech Stack
- Frontend: Expo (React Native, expo-router, expo-image-picker, expo-sharing,
  expo-secure-store, expo-linear-gradient, expo-haptics).
- Backend: FastAPI + Motor (Mongo) + emergentintegrations.
- AI: Gemini Nano Banana (`gemini-3.1-flash-image-preview`) via
  EMERGENT_LLM_KEY for both outfit generation (multi-image reference) and
  studio image edits + caption generation.
- Auth: Emergent managed Google OAuth + Bearer session token.

## Smart Business Enhancement
- **Cliente Virtuale**: shop owners save the "virtual avatar" of each real
  client (e.g. "Maria Rossi — donna, adulto, curvy, caucasica") so they can
  re-generate outfits for that customer in one tap — drives WhatsApp / Telegram
  conversions because every new arrival can be instantly tailored and sent.

## Constraints
- Italian language UI everywhere.
- Dark mode default, fashion editorial styling (sharp corners, generous space).
- Mobile-first; works in Expo Go and on web preview.
- Images stored as base64 in MongoDB for portability.

## Non-goals (MVP)
- Real Telegram Bot / Instagram Graph API publishing — handled via native share
  sheet for now.
- Multi-tenant team support.
- Subscription billing.
