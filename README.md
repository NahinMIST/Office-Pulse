# Office Pulse — Live Office Device Monitor

**Techathon Nationals & Rover Summit — Preliminary Round**
A real-time system for monitoring office lights and fans through a live web dashboard and a Discord bot, backed by a single shared simulated-device backend.

---

## Repository structure

```
.
├── backend/
│   ├── server.js            # Express REST API + Socket.IO push layer
│   ├── deviceSimulator.js   # Simulated device state (single source of truth)
│   ├── discordBot.js        # Discord bot (REST commands + live alert stream)
│   ├── package.json
│   └── .env.example         # Copy to .env and fill in before running the bot
├── dashboard/
│   └── dashboard.html       # Real-time web dashboard (open directly in a browser)
├── diagrams/
│   ├── system-diagram.svg   # High-level architecture & data flow (required deliverable)
│   └── circuit-schematic/   # Add your exported Wokwi schematic here — see note below
└── README.md
```

---

## Architecture overview

```
[Simulated Device Layer] → [Backend API + WebSocket] → [Web Dashboard]
                                       │
                                       └──────────────→ [Discord Bot]
```

- **One backend, one source of truth.** `deviceSimulator.js` holds the live state of all 15 devices (3 rooms × 2 fans + 3 lights). `server.js` wraps it in REST endpoints and a Socket.IO channel.
- **Dashboard** connects via Socket.IO and receives push updates — no polling, no manual refresh.
- **Discord bot** calls the same REST endpoints on command, and separately subscribes to the same Socket.IO alert stream to proactively post alerts the instant they fire.

See `diagrams/system-diagram.svg` for the full annotated data-flow diagram, including a step-by-step trace of one device state change from simulator → backend → both interfaces.

> **Note on device count:** the problem statement states "2 fans and 3 lights per room, 15 devices total" but later sections reference "18 devices." The math (3 rooms × 5 devices) supports **15**, so this project is built and documented around 15 devices throughout.

---

## Prerequisites

- [Node.js](https://nodejs.org) v18 or later (uses native `fetch`)
- A Discord bot application + token (only needed for the bot — see [Discord bot setup](#3-discord-bot))

---

## 1. Backend (run this first)

The backend must be running before the dashboard or bot are used — both depend on it.

```bash
cd backend
npm install
npm start
```

You should see:
```
Backend API + WebSocket listening on http://localhost:3000
```

**Verify it's working:**
```bash
curl http://localhost:3000/api/devices    # all 15 devices
curl http://localhost:3000/api/usage      # total + per-room wattage
curl http://localhost:3000/api/alerts     # currently active alerts
```

The simulator starts automatically and randomly toggles one device every 4–9 seconds, so there's always live data to observe.

### REST API reference

| Endpoint | Description |
|---|---|
| `GET /api/devices` | All 15 devices |
| `GET /api/devices/:room` | Devices for one room — `drawing`, `work1`, or `work2` |
| `GET /api/usage` | `{ totalWatts, perRoom, kWhToday }` |
| `GET /api/alerts` | Currently active alerts (after-hours, >2hr continuous run) |
| `GET /api/health` | Health check |

### Socket.IO events (used by the dashboard and bot)

| Event | Payload | When |
|---|---|---|
| `snapshot` | `{ devices, usage, alerts }` | Sent once immediately on connect |
| `device:update` | single device object | Any time a device toggles |
| `usage:update` | usage object | Alongside every device toggle |
| `alert:new` | single alert object | Only when a *new* alert condition first becomes true |

---

## 2. Web dashboard

With the backend running, just open the file in a browser:

```bash
open dashboard/dashboard.html      # macOS
# or double-click it / drag into a browser window
```

By default it connects to `http://localhost:3000`. If you host the backend elsewhere, edit the `API_BASE` constant near the top of the `<script>` tag in `dashboard.html`.

**What you'll see:**
- **Office floor plan** (bonus) — top-view layout with lights that glow amber when on and fans that spin when running, live
- **Live Power Consumption Meter** — total wattage + per-room breakdown, updating in real time
- **Active Alerts** — timestamped, live
- **Insights strip** (unique additions) — estimated cost in ৳ (Taka), a live power trend sparkline, and a "longest running device" callout
- **Live Device Status — By Room** — all 15 devices individually labeled with on/off state, per the minimum requirement

Everything updates via the Socket.IO connection — no page refresh needed at any point.

> **Assumption:** the estimated cost uses a placeholder tariff of **৳12/kWh**. Replace `TARIFF_BDT_PER_KWH` near the top of `dashboard.html`'s script with the real BPDB commercial rate if you have it, and update the same constant in `discordBot.js` to keep both interfaces consistent.

---

## 3. Discord bot

### One-time Discord setup
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot
2. Under **Bot**, enable **MESSAGE CONTENT INTENT** (required — commands won't receive text without it)
3. Copy the bot token
4. Under **OAuth2 → URL Generator**, select scope `bot`, permissions `Send Messages` + `Read Message History`, then use the generated URL to invite the bot to your server
5. (For proactive alerts) right-click your target channel → Copy Channel ID (requires Developer Mode: User Settings → Advanced → Developer Mode)

### Configure and run

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=your_bot_token_here
ALERT_CHANNEL_ID=your_channel_id_here     # optional — enables proactive alerts
BACKEND_URL=http://localhost:3000
ANTHROPIC_API_KEY=                        # optional — enables LLM-humanized replies
```

Then, with the backend already running in another terminal:
```bash
npm run bot
```

### Commands

| Command | Example | What it does |
|---|---|---|
| `!status` | `!status` | One-line summary of all 3 rooms |
| `!room <name>` | `!room work1` | Detailed device-by-device breakdown for one room |
| `!usage` | `!usage` | Total live wattage + estimated kWh + estimated cost |
| `!help` | `!help` | Lists commands |

All responses are generated from the live backend data — never hardcoded or random.

### LLM-humanized responses (optional)
If `ANTHROPIC_API_KEY` is set in `.env`, the bot rephrases its data-grounded replies into warmer, more conversational sentences via the Anthropic API. If the key is missing or the call fails for any reason, it automatically falls back to a friendly built-in template — the bot never breaks or goes silent because of this.

### Proactive alerts (bonus)
If `ALERT_CHANNEL_ID` is set, the bot opens a live connection to the backend's alert stream (the same one the dashboard uses) and posts to that channel the instant a new alert condition fires — no polling delay.

---

## Diagrams

- **`diagrams/system-diagram.svg`** — full system architecture and data flow, including an annotated trace of one device state change end-to-end. Open directly in a browser or vector editor; export to PNG if your submission platform needs a raster image.
- **`diagrams/circuit-schematic/`** — add your Wokwi or Tinkercad export here. Build a representative one-room circuit (ESP32 + 5-channel relay module + LEDs/DC motor as light/fan stand-ins + optional ACS712 current sensor). Export as PNG/PDF or share the Wokwi project link in this folder's own short `README.md`.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Dashboard shows "Reconnecting…" forever | Backend isn't running, or `API_BASE` in `dashboard.html` doesn't match where it's hosted |
| Bot doesn't respond to commands | MESSAGE CONTENT INTENT not enabled in Developer Portal |
| Bot replies with a backend error message | Backend isn't running, or `BACKEND_URL` in `.env` is wrong |
| No proactive alerts ever post | `ALERT_CHANNEL_ID` not set, or it's after 5 PM / before 9 AM check — alerts only fire under real trigger conditions |
| `npm install` fails on `discord.js` | Node version too old — needs v18+ |

---

## Evaluation criteria mapping

| Criterion | Where to find it |
|---|---|
| Working web dashboard with real-time data | `dashboard/dashboard.html`, Socket.IO push, no refresh needed |
| Working Discord bot reflecting real simulated data | `backend/discordBot.js`, calls same backend REST API |
| Dashboard visuals and UX quality | Floor plan, room panels, insights strip |
| Clear, correct system diagram | `diagrams/system-diagram.svg` |
| Sensible circuit schematic | `diagrams/circuit-schematic/` (add your Wokwi export) |
| Quality of demo & dummy data simulation | `backend/deviceSimulator.js` — dynamic, realistic wattages, timestamps |
| Well structured and documented codebase | This repo structure + inline comments throughout |
