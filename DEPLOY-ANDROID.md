# Abdullah AI Video Studio — Android se Deploy Guide

Ye guide sirf phone (Chrome) se hai — laptop ki zaroorat nahi. **Pehle
poora parh lein, phir shuru karein.** Kuch bhi kharch karne se pehle
neeche diya gaya Approval Checklist dekhein.

> **DEMO_MODE abhi `true` hai.** Deploy karne ke baad bhi app Demo Mode
> mein hi rahegi jab tak aap key na daalein aur `DEMO_MODE=false` na
> karein. Bina key ke koi paisa kharch nahi hota.

## Step 1 — Code GitHub par daalein

1. Chrome kholein → **github.com** → sign in karein (free account bana
   lein agar nahi hai).
2. **+ → New repository** dabayein, naam likhein
   `abdullah-ai-video-studio`, Public rakhein, **Create repository**.
3. Khali repo wale page par **"uploading an existing file"** dabayein.
4. Project ki files **aik aik karke** upload karein ("uploading an
   existing file" se, folder aur sub-folder bana kar): `server.js`,
   `package.json`, `package-lock.json`, `src/…`, `frontend/…`
   (`index.html`, `app.js`, `styles.css`), `.env.example`,
   `Dockerfile`, `render.yaml`, `README.md`.
   - `package-lock.json` **zaroori** hai — Dockerfile mein `npm ci`
     is ke baghair fail ho jata hai.
   - `frontend/` **zaroori** hai — isi mein website hai; is ke baghair
     Render URL par sirf API chalegi, website nahi khulegi.
   - **Zip upload NA karein** — GitHub web zip ko extract nahi
     karta; zip file repo mein waisi ki waisi rehti hai aur Render
     build fail ho jati hai.
   - `node_modules/` aur `storage/` ki files kabhi upload na karein
     (wo phone par bohot bari hain aur deploy ke liye chahiye nahi).
5. **Kabhi real `.env` upload NA karein** — sirf `.env.example`.
6. **Commit changes** dabayein.

## Step 2 — Render par free host karein

1. Chrome mein **render.com** kholein → GitHub se sign in karein.
2. **New → Web Service** → apna `abdullah-ai-video-studio` repo
   chunein → **Connect**.
3. Settings: **Runtime: Docker**, **Instance: Free**.
4. **Create Web Service** dabayein. Build mein kuch minute lagte hain.
   (Repo mein `render.yaml` bhi hai — chahein to Dashboard mein
   **New → Blueprint** se bhi service bana sakte hain: Free plan,
   health check `/api/health`.)
5. Dashboard par aap ki backend URL dikhegi, jaise:
   `https://abdullah-ai-video-studio.onrender.com`

## Step 3 — Key daalein (SIRF aap ki approval ke baad)

Render dashboard mein **Environment → Add Environment Variable**:

| Variable | Value |
|---|---|
| `DEMO_MODE` | `false` (sirf key daalne ke baad) |
| `GOOGLE_GEMINI_API_KEY` | Aap ki Gemini API key (Google AI Studio se) |
| `ELEVENLABS_API_KEY` | Optional — awaaz ke liye |
| `GOOGLE_TTS_API_KEY` | Optional — awaaz ke liye |

Key **sirf yahin** daalein — kabhi code, chat ya website mein nahi.

## Step 4 — Health check karein

Chrome mein kholein:

```
https://<aap-ki-url>/api/health
```

Ye dikhna chahiye: `"status":"ok"`, `"demoMode":false`,
`"ffmpegAvailable":true`. Agar `demoMode:true` hai to key ya
`DEMO_MODE` setting check karein.

## Step 5 — Website kholein (Render URL hi website hai)

1. Chrome mein apni Render URL kholein — yehi website hai, koi alag app
   install nahi karni:
   `https://<aap-ki-url>/`
   Home tab par "Abdullah AI Video Studio" aur Demo Mode banner dikhna
   chahiye.
2. **Settings** → **Test Connection** dabayein — green status aani
   chahiye (version, FFmpeg, provider, Demo Mode). Isi service se serve
   ho rahi website mein Backend URL pehle se set hoti hai (same origin),
   is liye Test Connection baghair kuch likhe bhi pass hona chahiye.
3. Agar error aaye to URL dobara check karein (https, koi extra
   space nahi) aur Step 4 ka health check dekhein.
4. (Sirf agar aap alag live web app use kar rahi hain to: us ki
   Settings mein Backend URL mein apni Render URL likhein, phir
   Test Connection dabayein.)

## Step 6 — Pehla test: 30-second video (taqreeban $2.10)

1. Create mein aik chhoti si kahani likhein, **30 seconds** chunein.
   App mein sirf **30s ya 60s** hota hai — aik alag 8s clip nahi
   ban sakta.
2. Generate se pehle **cost estimate** dekhein — 30s video 720p
   taqreeban **$2.10 (PKR 588)** hai. ($0.56 sirf aik 8s clip ki
   qeemat hai jo video ke andar use hoti hai — wo alag test nahi hai.)
3. Generate dabayein, progress dekhein, phir **Download MP4**.

## Step 7 — Poori 60-second video

Jab 8s test theek ho jaye, to **60 seconds, 9:16, Urdu** ke saath
poori video banayein:
- 720p: **$4.20 (PKR 1,176)**
- 1080p: **$6.24 (PKR 1,747)**
- 4K (upscaled): **$12.54 (PKR 3,511)**

## ⚠️ Storage warning — MP4 foran download karein

Render **Free** par server ki files restart par khatam ho jati hain:

1. **Render chalte waqt app khuli rakhein.** App job ko poll karti
   hai, aur polling ki wajah se server soota nahi — render beech mein
   nahi rukta.
2. **Job complete hote hi MP4 download karein** — Download MP4
   dabate hi file aap ke phone ke Downloads folder mein save ho jati
   hai, phir wo mehfooz hai.
3. **Agar server download se pehle restart ho gaya to file khatam.**
   API saaf 404 dega ("file is no longer on this server") — dobara
   render karein.
4. Free Render Postgres (30 din mein expire) video files ke liye
   **suitable nahi** hai.
5. Mustaqil hal (baad mein, approval se): Cloudflare R2 free tier
   (10 GB, no egress fees) ya Render paid disk ($0.25/GB/month, paid
   instance chahiye).

## ✅ Approval Checklist — kuch bhi aap ke "haan" ke baghair nahi hoga

- [ ] **Gemini API key** — Google AI Studio se key lena (key free hai,
  lekin Omni paid tier hai, billing on karni hogi).
- [ ] **Billing on karna** — pehli test video (30s, 720p) taqreeban
  $2.10 ki hogi.
- [ ] **Render plan** — Free ($0) ya Starter ($7/month, taqreeban
  PKR 2,000).
- [ ] **Pehli live test video** — 30 second, 720p (taqreeban $2.10),
  us ke baad hi poori 60s video.

## Qeemat — aik nazar mein (verified, 22 Nov 2026)

| Video | 720p | 1080p | 4K (upscaled) |
|---|---|---|---|
| 8s clip (aik clip ki qeemat) | $0.56 (PKR 157) | $0.83 (PKR 233) | $1.67 (PKR 468) |
| 30s video | $2.10 (PKR 588) | $3.12 (PKR 874) | $6.27 (PKR 1,756) |
| 60s video | $4.20 (PKR 1,176) | $6.24 (PKR 1,747) | $12.54 (PKR 3,511) |

> 8s wali qeemat aik clip ki hai (video ke andar use hoti hai). App
> 30s ya 60s video banata hai — pehla live test 30s ka hoga.

Poori tafseel: [README.md](README.md) — Model verification, price
table, aur Render Free storage sections dekhein.
