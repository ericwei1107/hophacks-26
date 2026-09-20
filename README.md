# Apogee — HopHacks 26

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

Optional: put `XAI_API_KEY=` in a gitignored `.env` at the repo root for the Grok pitch closer. The sim runs without it.

## What talks to what

| Piece | Owner |
|---|---|
| Live ascent | TypeScript workers |
| NOAA space weather | Python `/api/weather`, then browser NOAA, then a bundled snapshot |
| Payload Monte Carlo, IGEL analog, SATCAT crowding | Python `/api/analyze` |
| SATCAT census only | Python `/api/satcat?altitude_km=` (no full catalog) |

If uvicorn is down, debrief falls back to the TypeScript port. Browser fetches of CelesTrak usually fail CORS, so that fallback uses a labeled synthetic mix unless `/api/satcat` is up.

## SATCAT crowding

Objects in ±30 km of the mission altitude, split payload / rocket body / debris. `cam_scale` is that count vs a quieter 400 km shell, clipped 0.4–2.5, and it multiplies collision-avoidance Δv. This is a crowding **screen**, not operational collision probability.
