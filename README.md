# THE SYSTEM — Backend

A real Node.js/Express API server for the THE SYSTEM task manager, making it
multi-device and multi-user instead of relying solely on browser storage.
All game logic (XP, adaptive difficulty, decay, emergency quests, trait
inference) is ported server-side here so the server is the single source of
truth — the frontend should call these endpoints rather than computing its
own XP/penalties once you wire it up.

## Setup

```bash
npm install
cp .env.example .env   # set a real JWT_SECRET for production
node server.js
```

Server runs on `http://localhost:3001` by default. Data is stored in
`data/db.json` (a JSON file via `lowdb` — no native compilation needed, so it
installs cleanly anywhere). Swap this for Postgres/Mongo later without
touching `logic/engine.js`, since all DB access is isolated in `db.js` and
the route files.

## Deployment

### GitHub

1. Create a GitHub repository.
2. Add it as remote and push from this folder:

```bash
git remote add origin <your-github-repo-url>
git branch -M main
git push -u origin main
```

3. The repository is ready to use with GitHub Actions via
`.github/workflows/ci.yml`.

### Vercel

1. Sign in to Vercel and import the repository.
2. Use the default settings and confirm the root project folder.
3. The `vercel.json` config will publish the frontend static app.

> Important: the current deployed site on Vercel will be frontend-only.
> API requests to `/api/*` need a separate backend host or a serverless
> deployment with a persistent database.

If you want a fully working website on Vercel, deploy the API separately and
update the frontend to use that backend URL rather than `/api`.

## Auth

```
POST /api/auth/register   { email, password }  -> { token, userId }
POST /api/auth/login      { email, password }  -> { token, userId }
```

All other routes require `Authorization: Bearer <token>`.

## Core state

```
GET  /api/state            -> full state + rank + traits
POST /api/state/sync       -> cross-device merge (last-write-wins + array union)
```

## Quests

```
POST   /api/quests              { title, cat, xp, penalty } -> add quest
POST   /api/quests/:id/toggle   -> mark done/undone, returns XP delta
DELETE /api/quests/:id          -> remove quest
```

## Day cycle

```
POST /api/day/close             -> apply penalties, decay, streak, history,
                                    triggers emergency quests if a category's
                                    weekly completion rate < 50%
POST /api/day/reset             -> clear all "done" flags without closing
GET  /api/day/traits            -> { discipline, resilience, focus }
```

## Emergency quests

```
POST /api/day/emergency/manual        -> manually issue one for the weakest category
POST /api/day/emergency/:id/toggle    -> complete it
POST /api/day/emergency/check         -> re-run the auto-trigger check
```

## Verification (GPS + photo anti-farming)

```
POST /api/verify/homebase     { cat, lat, lng, radiusMeters } -> set a location anchor
POST /api/verify/gps-check    { cat, lat, lng } -> verified: bool, distanceMeters
POST /api/verify/photo-check  { questId, phash } -> accepted: bool, flaggedAsDuplicate: bool
```

`phash` should be a perceptual hash computed client-side (e.g. with a small
JS pHash library on the captured photo) — the server never sees or stores
the actual image, only the hash, and flags near-duplicate hashes (Hamming
distance ≤ 5) submitted for the same quest as likely farming.

## What's intentionally NOT here

- Health API (Google Fit / Apple Health) integration — requires OAuth app
  registration with each provider; can't be faked, has to be added with real
  credentials when you're ready to register the app.
- Image storage/CV fraud detection beyond perceptual hashing — a real
  server-side vision model is a separate, heavier service to add later.
- Push notifications — needs a real device-token provider (FCM/APNs).

## Next steps if you want this production-grade

1. Swap `lowdb` for Postgres (the route logic doesn't change, only `db.js`).
2. Add rate limiting on auth routes.
3. Add input validation (e.g. `zod`) on all POST bodies.
4. Move `JWT_SECRET` to a real secrets manager.
5. Add a `/api/state/export` for GDPR-style data portability — relevant if
   you ever pursue the privacy-preserving-verification patent angle discussed
   earlier, since clean data minimization helps that case.
## Deployment

This repository is ready for GitHub source control and frontend deployment on
Vercel.

- GitHub: initialize the local repo, commit, then push to a GitHub remote.
- Vercel: import the repo and deploy as a static site from the root.

> Note: the current Vercel deployment will publish the frontend static app.
> The backend Express API is not deployed to Vercel in this repo because the
> app currently depends on a local server and file-based `lowdb` storage.