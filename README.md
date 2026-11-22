# Abdullah AI Video Studio — Backend

One prompt → one complete ~60-second AI video, for the **Abdullah Ki Duniya**
YouTube channel. Enter a story prompt, pick **Realistic Cinematic** or
**3D Cartoon**, choose 30s/60s, 9:16/16:9, quality, language
(Urdu / Hindi / English), and press Generate. The backend:

1. builds a real storyboard (scenes, camera moves, transitions, narration
   **and dialogue — each character speaks in their own AI voice**),
2. generates one AI clip per scene with the configured provider,
3. adds per-character voice-over + background music,
4. joins everything with FFmpeg (smooth transitions, captions for both
   narration and dialogue, with the speaker's name),
5. exports **one MP4** you can download to your phone.

> **Read this first — the honest part.** Without an AI video provider API
> key, this system **cannot generate real AI video**, and it will tell you
> so. In **Demo Mode** (the default) it returns a real storyboard + scene
> prompts as a downloadable plan — clearly labelled demo. It never creates
> a fake video, never pretends a slideshow is AI video, and never shows a
> "completed" video that is not real. Any website that promises unlimited
> free AI video with no provider is lying to you; the AI models cost real
> money per second (see [Costs](#costs--paid-features) below).

---

## Model verification (22 Nov 2026) — Gemini Omni 1.1 vs 1.2

The official Gemini API pricing page lists **both** Omni models — that is
where the 1.1 vs 1.2 confusion comes from. Here is the resolution, checked
directly against Google's own docs:

- **Current model: Gemini Omni Flash 1.2 — `gemini-omni-1.2-flash`.**
  The pricing page has a "Gemini Omni 1.2 Flash" section: output video
  **$12.00 per 1M tokens**. Billing is 5,792 tokens per second of 720p
  video, which the page states is approximately **$0.07 per second**
  (~$0.70 for a 10s clip, ~$1.04 for a 15s clip; **$0.023/s for 360p**
  at 1,931 tokens/s; **$0.104/s for 1080p** with upsampling at 8,688
  tokens/s; **$0.209/s for 4K** with upsampling at 17,376 tokens/s).
  Input $1.50 per 1M tokens. **Paid tier only — no free tier.**
- **Previous generation: Gemini Omni Flash 1.1 — `gemini-omni-1.1-flash`.**
  The same pricing page has a "Gemini Omni 1.1 Flash" section: output
  video **$17.50 per 1M tokens**, approximately **$0.10 per second** at
  720p. It is the older, more expensive model.
- **The Omni docs page says:** "`gemini-omni-1.1-flash` remains available
  during a 4-week transition window. Effective **December 3, 2026**, all
  API requests to `gemini-omni-1.1-flash` automatically route to
  `gemini-omni-1.2-flash` with no code changes required and are billed at
  the lower Gemini Omni 1.2 Flash rates." The docs page title, every code
  sample, and the REST endpoint all use `gemini-omni-1.2-flash`.

**Conclusion: the default model is `gemini-omni-1.2-flash`**, endpoint
`POST https://generativelanguage.googleapis.com/v1beta/interactions?key=$API_KEY`.
`gemini-omni-1.1-flash` must never be used as the default; it appears in
this repo only as the "previous generation" comparison (see the price
table below and `GET /api/estimate`'s `previousGeneration` field).

- Docs: https://ai.google.dev/gemini-api/docs/omni
- Pricing: https://ai.google.dev/gemini-api/docs/pricing

---

## Quick start (computer or phone + GitHub)

```bash
git clone <your-repo-url>
cd abdullah-ai-video-studio
npm install
cp .env.example .env
# Edit .env — add ONE provider key to generate real video, or leave
# DEMO_MODE=true to try the storyboard planner first.
npm start
# → http://localhost:3000  (health: http://localhost:3000/api/health)
```

Requirements: **Node.js 20+** (22 recommended) and **FFmpeg** on PATH.
FFmpeg is only needed for the final assembly step; Demo Mode works
without it (the server warns at startup if it is missing).

### Try Demo Mode first (no key, no cost)

```bash
curl -X POST http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Abdullah saves his father from a tiger in the jungle","mode":"cartoon","durationSeconds":60,"aspect":"9:16","quality":"1080p","language":"ur"}'
# → { projectId, jobId, demo: true, estimatedCostUsd, estimatedCostPkr, estimate, ... }
curl http://localhost:3000/api/jobs/<jobId>
curl http://localhost:3000/api/projects/<projectId>/download
# → downloads "<title>-demo-plan.md" — the full storyboard + scene prompts.
curl "http://localhost:3000/api/estimate?provider=omni&quality=720p&durationSeconds=60"
# → estimated cost of one video before you spend anything.
```

---

## Frontend (the website)

The repo ships its own complete website in `frontend/` — dependency-free,
no build step. The backend serves it at `/` and the API stays at `/api/*`,
so **one URL is the whole app** (no separate frontend deploy).

- `frontend/index.html` — 6 tabs: Home, Create, Projects, Characters,
  History, Settings. Roman Urdu labels, mobile-first (390px).
- `frontend/app.js` — vanilla JS. Backend URL from localStorage
  (`aivs-backend-url`) or same origin by default — when served by this
  backend it just works with no setup.
- `frontend/styles.css` — bottom tab bar, large touch targets.

What it does: **Create** (prompt → mode/duration/aspect/quality/language,
voice-over + music, character select) shows the cost table first
(`GET /api/estimate`: 8s and 60s × 720p/1080p/4K/360p, model
`gemini-omni-1.2-flash`), then Generate polls the job and shows the full
storyboard (scenes, dialogue with speaker + voice, narration, video
prompts, Character Lock) and the Download button. **Projects** (list,
detail, download, delete), **Characters** (upload + one-tap Abdullah
identity, list, delete), **History** (jobs), **Settings** (Backend URL +
Test Connection, provider list — Gemini Omni Flash first, Veo 3.1 Preview
marked discontinued). **No API key field exists anywhere** — keys live
only in the server `.env` file. In Demo Mode every download is clearly
labelled "NOT a video"; no fake video is ever presented as a real MP4.

Open it locally: `npm start` → **http://localhost:3000/**

---

## API reference

Base URL: `http://localhost:3000` (or your deployed URL). All responses are JSON.

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/api/health` | Server status, demo mode, configured provider, ffmpeg check |
| POST | `/api/generate` | Create project + queue job. Returns `{projectId, jobId, demo, estimatedCostUsd, estimatedCostPkr, estimate}` |
| GET | `/api/jobs/:id` | Job status + progress (`queued → processing → scenes_generating → voiceover → assembling → complete / failed / demo_complete`) |
| GET | `/api/jobs` | Recent jobs |
| GET | `/api/projects` | List projects (newest first) |
| GET | `/api/projects/:id` | Project + scenes + latest job |
| GET | `/api/projects/:id/storyboard` | Full storyboard JSON |
| GET | `/api/projects/:id/download` | Final MP4 (or the demo plan for demo projects) |
| DELETE | `/api/projects/:id` | Delete project + scenes + files |
| POST | `/api/characters` | Upload reference image (`image` file + `name` + `description`) + optional voice fields (`voice_provider`, `voice_id`, `voice_name`) |
| GET | `/api/characters` | List character profiles (with voice fields) |
| DELETE | `/api/characters/:id` | Delete a character profile |
| GET | `/api/settings` | Settings + provider capability table (never returns keys) |
| POST | `/api/settings` | Update provider/defaults/narrator voice (keys are refused here — see below) |
| GET | `/api/estimate` | Cost estimate for one video: `?provider=omni&quality=720p&durationSeconds=60&referenceImage=true` |

### Generate request body

```json
{
  "prompt": "Abdullah saves his father from a tiger in the jungle",
  "mode": "cartoon",
  "durationSeconds": 60,
  "aspect": "9:16",
  "quality": "1080p",
  "language": "ur",
  "voiceover": true,
  "music": true,
  "characterId": "<optional character profile id>"
}
```

- `mode`: `realistic` | `cartoon`
- `durationSeconds`: `30` (4 scenes) | `60` (8 scenes, ~8s each)
- `aspect`: `9:16` (Shorts) | `16:9`
- `quality`: `720p` | `1080p` | `4K` — 4K is an FFmpeg upscale from 1080p clips, honestly labelled "upscaled, not native 4K" in the file metadata and API response (`upscaled4K: true`), **unless the provider itself delivered 4K frames** (Omni 1080p/4K are upscaled by Google — the file then says "4K output upscaled by the video provider (not native 4K)"). No provider here generates native 4K video.
- `language`: `ur` (Roman Urdu narration) | `hi` (Roman Hindi) | `en`

### Character Lock

The default hero is **Abdullah — a young man in his early twenties, black
wavy hair, neatly trimmed beard, warm brown eyes, wearing a black Levi's
hoodie, blue jeans and blue-grey sneakers**. Same face, same hair, same
beard, same clothes, same body proportions in every scene — this exact
description is repeated **verbatim in every scene's video prompt**.

Upload a reference image at `POST /api/characters` with a description
(face, hair, clothes, body). The description is repeated verbatim in
every scene's video prompt, and the image is passed to providers that
support image conditioning (Omni, Veo GA, Runway). Kling and Luma need a
**public image URL** — a local file is honestly refused with a clear error.

---

## Environment variables

| Variable | Default | What it is |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Server bind |
| `DATABASE_PATH` | `./storage/studio.db` | SQLite file |
| `STORAGE_PATH` | `./storage` | Uploads + generated files |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Binary paths |
| `DEMO_MODE` | `true` | `true` = storyboard plans only. Set `false` + a provider key for real video |
| `GOOGLE_GEMINI_API_KEY` | — | Gemini Omni Flash (Gemini API) — the default provider |
| `OMNI_MODEL` | `gemini-omni-1.2-flash` | Omni model (do NOT use a veo-*-preview model — dead since Oct 22, 2026) |
| `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | — / `us-central1` | Veo 3.1 GA on Google Cloud (Vertex AI) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to a Google Cloud service-account JSON key file (Veo GA) |
| `VEO_GA_MODEL` / `VEO_GA_GCS_BUCKET` | `veo-3.1-generate-001` / — | Veo GA model + Cloud Storage bucket for output |
| `RUNWAY_API_KEY` | — | Runway Gen-4.5 / Gen-4 Turbo |
| `KLING_API_KEY` | — | Kling 4.0 (new official API) |
| `LUMA_API_KEY` | — | Luma Dream Machine (Ray 2) |
| `DEFAULT_PROVIDER` | `omni` | Provider to use when several are configured |
| `ELEVENLABS_API_KEY` | — | Voice-over (optional) |
| `GOOGLE_TTS_API_KEY` | — | Google Cloud TTS voice-over (optional) |
| `WORKER_ENABLED` / `WORKER_POLL_MS` | `true` / `5000` | Background job worker |
| `MAX_UPLOAD_MB` | `20` | Character image size limit |

**API keys live in `.env` only.** The settings API refuses any key/secret
field (`POST /api/settings` returns 400) and never returns keys.

---

## AI provider setup

One provider is enough. Pick the one whose pricing you accept — **verify
the current price on the provider's own pricing page before generating**;
prices change. The rates in the table below were verified from the
official pricing pages on 2026-11-22; `GET /api/estimate` computes the
per-video cost from this same rate card.

| Provider | Get a key | Model | Notes |
|---|---|---|---|
| **Gemini Omni Flash** (recommended start) | https://aistudio.google.com/ → Create API key | `gemini-omni-1.2-flash` | 3–15s clips, native audio, up to 6 reference images. Paid tier only — no free tier. Output video: 720p ~$0.07/s, 1080p (upsampled) ~$0.104/s, 4K (upsampled) ~$0.209/s, 360p ~$0.023/s. Pricing: https://ai.google.dev/gemini-api/docs/pricing |
| **Google Veo 3.1 GA** (Google Cloud / Vertex AI) | https://console.cloud.google.com/ | `veo-3.1-generate-001` (or `veo-3.1-fast-generate-001`) | 4/6/8s clips, native audio, reference image. Needs a Cloud project + billing + Vertex AI API enabled + a service account + a GCS bucket for output. Pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing |
| **Runway Gen-4.5 / Gen-4 Turbo** | https://dev.runwayml.com/ | `gen4.5` (text + image, 2–10s, 12 credits/s ≈ $0.12/s) / `gen4_turbo` (image only, 5s/10s, 5 credits/s ≈ $0.05/s) | No generated audio. Pricing: https://docs.dev.runwayml.com/guides/pricing |
| **Kling 4.0** | https://kling.ai/dev | `kling-4.0` (3–30s, native audio; `kling-4.0-flash` also available) | Reference image needs a **public URL**. Credit-based — verify the rate. Pricing: https://www.klingai.com/pricing |
| **Luma Ray 2** | https://lumalabs.ai/ | `ray-2` (5s/9s, resolution settable) | Reference image needs a **public URL**. Credit-based — verify the rate. Pricing: https://lumalabs.ai/pricing |

> ⚠️ **Veo 3.1 Preview is dead.** `veo-3.1-generate-preview`,
> `veo-3.1-fast-generate-preview` and `veo-3.1-lite-generate-preview` were
> shut down on the Gemini API on **Oct 22, 2026**. They are not referenced
> anywhere in this codebase. The current Google video model on the Gemini
> API is **Gemini Omni Flash** (`gemini-omni-1.2-flash`). Veo 3.1 GA exists
> only on Google Cloud (Vertex AI) as `veo-3.1-generate-001`.

How much does one 60s video cost? Check `GET /api/estimate` — it
multiplies the verified per-second rate by the seconds the provider
actually bills (Omni: exact seconds; Veo GA: 4/6/8s steps; Runway:
5s/10s for gen4_turbo, exact 2–10s for gen4.5; Kling: exact seconds;
Luma: 5s/9s clips) and returns USD + approximate PKR. There is no free
unlimited generation — free tiers (where offered) are small trial credits
only.

## Voice-over & music — per-character voices

Every character speaks in **their own voice**:

- **Dialogue:** each scene has 1–2 spoken lines for Abdullah and his
  father Abbu. Each line is synthesised with that character's voice
  (from the character profile: `voice_provider` + `voice_id`), and placed
  at its scene time. The narration is a separate voice (settings
  `narrator_voice_provider` / `narrator_voice_id`; default: the same
  voice as Abdullah, because the narration is first-person).
- **How to set a voice:**
  - **ElevenLabs:** create a voice at https://elevenlabs.io/ (Voice Lab
    or Voice Library), copy its voice_id, set `voice_id` + `voice_provider:
    elevenlabs` on the character. Free tier: 10,000 credits/month (~10
    min of audio), **no commercial licence on the free tier**; Starter is
    ~$5–6/month.
  - **Google Cloud TTS:** pick a voice name at
    https://cloud.google.com/text-to-speech/docs/voices (e.g.
    `ur-IN-Wavenet-B`), set `voice_id` + `voice_provider: google-tts`.
    Free tier: 4M Standard / 1M WaveNet/Neural2 characters per month (a
    billing account is required even for the free tier).
  - **Urdu voices:** Google Cloud TTS offers Urdu ONLY as **ur-IN**
    (Urdu, India) — there is **no ur-PK locale**. Urdu voices on Google:
    `ur-IN-Standard-A/B`, `ur-IN-Wavenet-A/B`. A Pakistani-accent Urdu
    voice is available from Microsoft Azure (`ur-PK-UzmaNeural` /
    `ur-PK-AsadNeural`) or ElevenLabs.
- **Without a TTS key**, the pipeline writes `voiceover-script.json`
  (every line + timing + voice assignment) and continues without audio —
  it never fakes a voice.
- **Music:** put royalty-free MP3/WAV files in `storage/music/` — the first
  file is looped under the video. With no files, FFmpeg synthesises a soft
  ambient pad, clearly labelled a placeholder. **Never add commercial
  songs** — they trigger YouTube Content ID claims.

> Google Translate TTS is **not** a production voice-over provider here.
> It is used ONLY in `test-audio-pipeline.js` as a free test harness to
> prove the timing/mixing/caption mechanism end-to-end. It must never be
> wired into `src/voiceover.js` or the production pipeline.

---

## Costs & paid features

Everything in this list needs a paid API or external service. Nothing
here is free-and-unlimited. **Check `GET /api/estimate` before every
generation** — it is the same verified rate card used by the pipeline.

### Verified prices — Gemini Omni Flash 1.2 (8s and 60s)

Verified 2026-11-22 from the official Gemini API pricing page
(https://ai.google.dev/gemini-api/docs/pricing). The 8s row is the
first test clip; the 60s row is one full Short. PKR is approximate at
280 PKR/USD, computed from the unrounded USD amount — always verify the
current rate on the pricing page before generating.

| Duration | 360p | 720p | 1080p (upscaled) | 4K (upscaled) |
|---|---|---|---|---|
| **8s test clip** | $0.18 (PKR 52) | **$0.56 (PKR 157)** | $0.83 (PKR 233) | $1.67 (PKR 468) |
| **60s video** | $1.38 (PKR 386) | **$4.20 (PKR 1,176)** | $6.24 (PKR 1,747) | $12.54 (PKR 3,511) |

Rates: 360p $0.023/s, 720p $0.07/s, 1080p $0.104/s, 4K $0.209/s.
`GET /api/estimate` returns the same numbers as a `breakdown` array
(8s and 60s × 720p/1080p, plus 4K/360p), plus the `previousGeneration`
field below.

| Model (previous generation — do not use) | 8s at 720p | 60s at 720p |
|---|---|---|
| Gemini Omni 1.1 Flash (`gemini-omni-1.1-flash`), $0.10/s at 720p | $0.80 (PKR 224) | $6.00 (PKR 1,680) |

1.1 is more expensive than 1.2 and auto-routes to 1.2 from Dec 3, 2026
(see [Model verification](#model-verification-22-nov-2026--gemini-omni-11-vs-12)
above).

| Feature | Needs | Cost for one 60s video (720p) | Free tier? |
|---|---|---|---|
| Real AI video — **Gemini Omni Flash** | `GOOGLE_GEMINI_API_KEY` + billing | **~$4.20** (≈ PKR 1,180) at $0.07/s × 60s | No free tier |
| Real AI video — Omni 1080p | Same | **~$6.24** (≈ PKR 1,750) at $0.104/s × 60s | No free tier |
| Real AI video — Omni 4K | Same | **~$12.54** (≈ PKR 3,510) at $0.209/s × 60s | No free tier |
| Real AI video — **Runway gen4.5** (no reference image) | `RUNWAY_API_KEY` | **~$7.20** (≈ PKR 2,020) at $0.12/s × 60s | Trial credits only |
| Real AI video — **Runway gen4_turbo** (with reference image) | `RUNWAY_API_KEY` | **~$3.75** (≈ PKR 1,050) at $0.05/s × 75 billed s (5s/10s clips) | Trial credits only |
| Real AI video — **Veo 3.1 GA** (Google Cloud) | Cloud project + billing + service account + GCS bucket | Verify at https://cloud.google.com/vertex-ai/generative-ai/pricing | Trial credits only |
| Real AI video — **Kling 4.0 / Luma Ray 2** | `KLING_API_KEY` / `LUMA_API_KEY` | No verified per-second USD rate in this repo — verify on the pricing page | Trial credits only |
| Voice-over (ElevenLabs / Google TTS) | TTS API key + credits | ~$0 within the free tiers (ElevenLabs 10,000 credits/mo; Google TTS 1M Neural2/WaveNet chars/mo) | Yes, small |
| Hosting the backend 24/7 | Render/Railway/VPS | Render Free $0 / Starter $7/mo (~PKR 2,000) | Free tier sleeps |
| 4K output | Nothing extra — it is an FFmpeg upscale (or the provider's own upscale), labelled as such | — | — |
| Storyboard plans, project storage, FFmpeg assembly | Nothing (runs on your server) | Free | Free |

**PKR figures are approximate at 280 PKR/USD.** A daily 60s video at
Omni 720p costs ~$4.20/day ≈ **~PKR 35,000/month** — budget for it before
generating daily. AI Plus (PKR 1,400/month) gives **Flow** credits, NOT
API billing — it does not pay for Omni API calls.

**No credit system is built in on purpose.** You pay the AI provider
directly; this backend never sells, counts, or fakes credits.

---

## Deploy from an Android phone only (no laptop)

You can do the whole deployment from Chrome on your phone.

### 1. Put the code on GitHub (phone Chrome)

1. Open **chrome** → github.com → sign in (create a free account if needed).
2. Tap **+ → New repository**, name it `abdullah-ai-video-studio`, Public, tap **Create repository**.
3. On the empty-repo page, tap **"uploading an existing file"**.
4. Upload the project files from your phone, one by one
   ("uploading an existing file" — make folders/sub-folders as needed):
   `server.js`, `package.json`, `package-lock.json`, `src/…`,
   `.env.example`, `Dockerfile`, `render.yaml`, `README.md`.
   - `package-lock.json` is **required** — the Dockerfile runs
     `npm ci`, which fails without it.
   - **Do NOT upload a zip** — GitHub's web uploader does not extract
     zips; the zip would sit in the repo as a file and the Render
     build would fail.
   - Never upload `node_modules/` or anything under `storage/`.
   - **Never upload a real `.env`** — only `.env.example`.
5. Tap **Commit changes**.

### 2. Host it free on Render (phone Chrome)

1. Open **render.com** → sign in with GitHub → **New → Web Service**.
2. Choose your `abdullah-ai-video-studio` repo → **Connect**.
3. Settings: **Runtime: Docker** (the repo has a Dockerfile), **Instance: Free**.
4. Tap **Environment → Add Environment Variable** and add:
   - `DEMO_MODE` = `false` (only after you add a provider key)
   - `GOOGLE_GEMINI_API_KEY` = your Gemini API key (paste from Google AI Studio)
   - Optional: `ELEVENLABS_API_KEY`, `GOOGLE_TTS_API_KEY`
5. Tap **Create Web Service**. Wait for the build (a few minutes).
6. Your backend URL is shown on the dashboard, e.g.
   `https://abdullah-ai-video-studio.onrender.com`.
7. Check `https://<your-url>/api/health` — it should say `"status":"ok"`.
8. In the Abdullah AI Video Studio web app, open Settings and set the
   **Backend URL** to that address.

### Render Free storage — read this before you render

The free tier's limits decide how your finished MP4s survive. All of
these are from the official Render docs (https://render.com/docs/free),
verified 2026-11-22:

- **Spins down after 15 minutes** without inbound traffic; spin-up takes
  about one minute.
- **"Whenever a service spins down, any changes to its local filesystem
  are lost."** Free web services have an **ephemeral filesystem**:
  uploaded images, the local SQLite database and generated files are
  **LOST on every redeploy, restart, or spin-down**.
- **Free services CANNOT attach a persistent disk.**
- **Free Render Postgres expires 30 days after creation** (14-day grace,
  then deleted) — it is **NOT suitable for video files**.
- **750 free instance hours per workspace per month.** Render may restart
  a Free web service at any time. No SSH, no scaling, no one-off jobs.
  Exceeding monthly bandwidth/build minutes without a payment method
  suspends all Free services.

**The safe-download plan (works on Free, costs nothing):**

1. **Keep the app open while a render runs.** The app polls the job
   every few seconds, and that polling is inbound traffic — it keeps the
   service awake, so it does not spin down mid-render.
2. **Download the MP4 immediately when the job completes.** Tap
   Download MP4 — the file saves to your phone's Downloads folder, and
   once it is on your phone it is safe no matter what the server does.
3. **If the server restarts before you download, the file is gone.**
   The API says so plainly: `GET /api/projects/:id/download` returns a
   404 explaining the file was lost in a restart. Just re-render.
4. The download is served as a real file attachment
   (`Content-Disposition: attachment`, `Content-Type: video/mp4`), so
   Android Chrome downloads it instead of playing it inline.

**Durable options for later (NOT done now — they need your approval):**

- **Cloudflare R2 free tier** — 10 GB storage, no egress fees: upload
  the finished MP4 there after every render and download it from R2
  whenever you want.
- **Render paid disk** — $0.25/GB/month, requires a paid instance
  (Starter $7/mo).

For daily generation, a paid instance (Starter $7/mo) or a small VPS
(see `docker-compose.yml` — `docker compose up -d`) is the reliable
choice.

### 3. Use it from your phone

The deployed Render URL **is** the website — open it in Chrome (no
separate app install, no separate frontend deploy):

1. Open your Render URL in Chrome, e.g. `https://abdullah-ai-video-studio.onrender.com`
   (the same URL serves the website AND the backend API).
2. Type **one story prompt** (e.g. "Abdullah apne abbu ko sher se bachata hai").
3. Pick **3D Cartoon** or **Realistic**, **60 seconds**, **9:16**, quality, **Urdu**.
4. Optional: upload a character photo in **Characters** first, then select it (Character Lock).
5. Tap **Generate Video**. Watch the progress; when it says complete, tap **Download** — the MP4 saves to your phone's Downloads.
6. Upload that MP4 to YouTube Studio as a Short.

(The live web app artifact is the same frontend on a different host — it
connects to this backend through Settings → Backend URL. The repo's own
`frontend/` needs no Backend URL at all when served from the same Render
service.)

---

## Architecture

```
server.js                 Express app + worker + graceful shutdown
src/
  db.js                   SQLite (node:sqlite, zero native build)
  storyboard.js           Deterministic storyboard engine (no API needed) —
                          narration + dialogue + per-character voices
  queue.js                Persistent job queue (SQLite, 2 auto-retries)
  jobs.js                 Pipeline worker: demo path + real path
  ffmpeg.js               Clip normalise, xfade joins, captions, multi-voice
                          audio mix, 4K upscale
  voiceover.js            ElevenLabs / Google TTS per-voice, or script-only
  music.js                storage/music library, or generated placeholder pad
  projects.js             Project CRUD service
  providers/
    base.js               Provider interface + shared HTTP helpers
    omni.js               Gemini Omni Flash (gemini-omni-1.2-flash, Gemini API)
    veo-ga.js             Google Veo 3.1 GA (Vertex AI, service-account OAuth)
    runway.js             Runway Gen-4.5 (text+image) / Gen-4 Turbo (image only)
    kling.js              Kling 4.0 (new official API, Bearer API key)
    luma.js               Luma Dream Machine Ray 2
    index.js              Registry + capability table + verified rate card
                          + cost estimation (estimateCost)
  routes/
    generate.js           POST /api/generate, GET /api/jobs/:id
    projects.js           Project read / download / delete
    characters.js         Character Lock uploads (multer) + voice fields
    settings.js           Settings (keys refused by design) + narrator voice
    estimate.js           GET /api/estimate
storage/                  SQLite DB, character images, clips, outputs
frontend/                 Static frontend files (see frontend/README.md)
test-pipeline.js          Free FFmpeg + multi-voice pipeline test
test-audio-pipeline.js    Free real-audio test (translate_tts harness only)
```

Job statuses: `queued → processing → scenes_generating → voiceover →
assembling → complete | failed | demo_complete`. Failed jobs retry twice
automatically, then stay `failed` with the error message.

## Tests (all free, no key needed)

```bash
node --check server.js && for f in $(find src -name '*.js'); do node --check "$f" || exit 1; done
node test-pipeline.js        # FFmpeg + multi-voice pipeline (tones stand in for TTS)
node test-audio-pipeline.js  # real Urdu audio via translate_tts harness, MP4 probe
```

`test-pipeline.js` verifies: 8-scene storyboard with dialogue + voices,
Character Lock text in every video prompt, script-only voiceover without
a key, assemble with one voice track per voice, captions, and the honest
4K-upscale flag. `test-audio-pipeline.js` fetches real Urdu speech for 2
dialogue lines (different characters) + 1 narration line, places them at
their scene times, mixes with music, assembles a real MP4 and probes it
(duration, resolution, audio present, audible volume).

## Troubleshooting

| Problem | Fix |
|---|---|
| `/api/health` says `demoMode: true` | No provider key is set, or `DEMO_MODE=true`. Add a key to `.env` and set `DEMO_MODE=false`, then restart. |
| Job ends as `demo_complete` | Expected in Demo Mode — download the demo plan, connect a provider, generate again. |
| `PROVIDER_NOT_CONFIGURED` | The chosen provider has no key in `.env`. Check the variable name against `.env.example`. |
| `REFERENCE_IMAGE_URL_REQUIRED` (Kling/Luma) | Upload the character image somewhere public and use its URL, or switch provider to Omni/Veo GA/Runway. |
| `ffmpeg was NOT found` at startup | Install FFmpeg (`apt install ffmpeg` / download from ffmpeg.org) or set `FFMPEG_PATH`. Demo Mode still works without it. |
| Job `failed` with a provider error | Read the error in `GET /api/jobs/:id` — it is the provider's own message (quota, invalid key, content policy). Fix that and re-generate. |
| Render free tier is slow to wake | Normal — free instances sleep. First request takes ~30–60s. |
| Captions missing in the output | No bold font was found on the server. Install `fonts-noto-core` (the Dockerfile does this). The API response still reports `captionsApplied`. |

## Honest limits — not yet proven live

- **No live Omni / Kling / Runway / Luma clip has ever been generated from
  this code** — no API key exists yet. The endpoints, models, request and
  response shapes were verified from the official docs (2026-11-22), but
  the first live call may still fail on quota, billing or content policy.
  The error is surfaced, never hidden.
- **Per-character voice quality is unproven until a TTS key is used.**
  The mechanism (per-voice tracks, timings, mixing, captions) was tested
  end-to-end with real Urdu audio via the translate_tts test harness —
  but ElevenLabs / Google TTS voices themselves have never been heard
  from this code.
- **Docker build is unverified** — the Dockerfile was written, not built.
- **Character consistency is best-effort, not guaranteed.** Repeating the
  character description in every prompt + a reference image helps a lot,
  but text-to-video models can still drift a face or outfit between
  scenes. Check each clip before publishing.
- **4K here means upscale, not native 4K.** No current video model in
  this backend generates native 4K; the file metadata says so.
- **No provider = no video.** Demo Mode returns a plan, never a video.
- **Costs are real.** ~60 seconds of AI video per Short, billed by the
  provider per second/credit. Budget for it before generating daily.
- **Content policy:** providers refuse some prompts (real people, violence,
  children in danger, etc.). If a scene fails, the job reports the
  provider's reason — rewrite that scene's prompt and retry.
- **Render free tier:** ephemeral disk (DB + files lost on restart) and
  15-minute idle sleep (a 10–20 minute job may be interrupted).
