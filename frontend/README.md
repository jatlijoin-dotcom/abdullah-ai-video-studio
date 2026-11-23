# Frontend — the website (served by the backend)

This folder IS the website. Dependency-free, no build step: `server.js`
serves these files at `/` and the API stays at `/api/*`.

- `index.html` — 6 tabs: Home, Create, Projects, Characters, History, Settings.
  Roman Urdu labels with English technical terms. Mobile-first (390px).
- `app.js` — vanilla JS. Talks to the backend REST API. Backend URL comes
  from localStorage (`aivs-backend-url`) or defaults to the same origin, so
  when served by this backend it just works with no setup.
- `styles.css` — mobile-first CSS (bottom tab bar, large touch targets,
  no horizontal overflow).

What the website does:
- **Create:** story prompt → mode (3D Cartoon / Realistic Cinematic) →
  30s/60s, 9:16/16:9, quality (720p/1080p/4K upscaled), language
  (Urdu/Hindi/English), voice-over + music, character select. Before
  generating it calls `GET /api/estimate` and shows the cost table
  (8s and 60s × 720p/1080p/4K/360p, model `gemini-omni-1.2-flash`).
  Generate polls `GET /api/jobs/:id` and shows the storyboard
  (scenes, dialogue with speaker + voice, narration, video prompts,
  Character Lock) plus the Download button.
- **Projects:** list (newest first), detail with storyboard, download,
  delete (with confirm).
- **Characters:** upload reference image + name + description + voice
  (provider/id/name); one-tap "Abdullah identity" buttons fill the exact
  description for Realistic and 3D Cartoon. List + delete.
- **History:** recent jobs with status and progress.
- **Settings:** Backend URL field + Test Connection (shows version,
  FFmpeg, provider, demo mode, or a clear error); provider list with
  Gemini Omni Flash first and Veo 3.1 Preview marked discontinued.
  **There is NO API key field anywhere** — keys live only in the server
  `.env` file.
- **Demo Mode:** the banner and every download say plainly that Demo
  Mode returns a storyboard plan, NOT a video. A demo download is
  labelled "NOT a video" everywhere it appears. No fake video is ever
  presented as a real MP4.

Run locally: `npm start` → open http://localhost:3000/

The production frontend for the channel is also available as the live
web app (the "Space" artifact) — same API, same backend. This folder is
the self-contained version that ships with the repo and deploys with it
on Render (one URL serves frontend + backend).
