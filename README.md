# Zenith — HopHacks 26

Build a rocket in the browser, fly it with the TypeScript ascent solver, then hand the parking orbit to Python for payload operations.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn api:app --reload --port 8000
```

In another terminal:

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the FastAPI process.

Optional: put `XAI_API_KEY=<your key>` in a gitignored `.env`, either at the repo root or in `web/`. It powers the Grok pitch closer and the spoken narration buttons. Restart the dev server after adding it; without a key those buttons read "Audio off" and everything else still works.

## What talks to what

| Piece | Owner |
|---|---|
| Live ascent | TypeScript workers |
| NOAA space weather | Python `/api/weather`, then browser NOAA, then a bundled snapshot |
| Payload Monte Carlo, IGEL analog | Python `/api/analyze` |
| SATCAT crowding screen | Browser TypeScript (`sim/orbital/debris.ts`) |

If uvicorn is down, debrief falls back to the TypeScript port. Browser fetches of CelesTrak usually fail CORS, so the crowding screen often uses a labeled synthetic mix.

## SATCAT crowding

Objects in ±30 km of the mission altitude, split payload / rocket body / debris. `cam_scale` is that count vs a quieter 400 km shell, clipped 0.4–2.5, and it multiplies collision-avoidance Δv on the TypeScript fallback path. Python payload analysis uses a unit `cam_scale`. This is a crowding **screen**, not operational collision probability.
