/**
 * discordBot.js
 *
 * Discord bot — the "remote control" interface for the office monitor.
 * Reads from the SAME backend as the web dashboard (single source of truth).
 *
 * Commands:
 *   !status        -> one-line summary of all 3 rooms
 *   !room <name>   -> detailed breakdown for one room (drawing|work1|work2)
 *   !usage         -> total power + estimated kWh + estimated cost
 *
 * Bonus: listens to the backend's Socket.IO 'alert:new' event and proactively
 * posts to a designated channel the moment an alert condition fires —
 * no polling, no delay, same event stream the dashboard uses.
 *
 * Setup:
 *   1. cp .env.example .env   and fill in DISCORD_TOKEN, ALERT_CHANNEL_ID
 *   2. npm install
 *   3. node server.js         (backend must be running first)
 *   4. node discordBot.js
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { io } = require('socket.io-client');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID; // channel to proactively post alerts to
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // optional — enables LLM-humanized replies
const TARIFF_BDT_PER_KWH = 12.0; // keep in sync with dashboard.html's TARIFF_BDT_PER_KWH

const ROOM_LABELS = { drawing: 'Drawing Room', work1: 'Work Room 1', work2: 'Work Room 2' };
const ROOM_ALIASES = { drawing: 'drawing', work1: 'work1', work2: 'work2', 'work 1': 'work1', 'work 2': 'work2' };

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env — see .env.example');
  process.exit(1);
}

// ---------------- Backend REST helpers ----------------

async function fetchAllDevices() {
  const res = await fetch(`${BACKEND_URL}/api/devices`);
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

async function fetchRoomDevices(room) {
  const res = await fetch(`${BACKEND_URL}/api/devices/${room}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

async function fetchUsage() {
  const res = await fetch(`${BACKEND_URL}/api/usage`);
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

// ---------------- Raw data -> plain-English formatting ----------------
// These produce accurate, data-grounded text FIRST. The LLM step (if enabled)
// only rephrases this — it never invents numbers itself.

function summarizeRoom(devices) {
  const fansOn = devices.filter((d) => d.type === 'fan' && d.status === 'on').length;
  const lightsOn = devices.filter((d) => d.type === 'light' && d.status === 'on').length;
  if (fansOn === 0 && lightsOn === 0) return 'all off';
  const parts = [];
  if (fansOn > 0) parts.push(`${fansOn} fan${fansOn > 1 ? 's' : ''} ON`);
  if (lightsOn > 0) parts.push(`${lightsOn} light${lightsOn > 1 ? 's' : ''} ON`);
  return parts.join(', ');
}

function buildStatusText(allDevices) {
  const byRoom = { drawing: [], work1: [], work2: [] };
  allDevices.forEach((d) => byRoom[d.room].push(d));
  return Object.keys(ROOM_LABELS)
    .map((room) => `${ROOM_LABELS[room]}: ${summarizeRoom(byRoom[room])}.`)
    .join(' ');
}

function buildRoomDetailText(room, devices) {
  const lines = devices
    .sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label) : a.type.localeCompare(b.type)))
    .map((d) => `${d.label}: ${d.status === 'on' ? `ON (${d.powerDraw}W)` : 'OFF'}`);
  const totalWatt = devices.reduce((sum, d) => sum + d.powerDraw, 0);
  return `${ROOM_LABELS[room]} — ${lines.join(', ')}. Total: ${totalWatt}W.`;
}

function buildUsageText(usage) {
  const cost = (usage.kWhToday * TARIFF_BDT_PER_KWH).toFixed(2);
  return `Total power right now: ${usage.totalWatts}W. Estimated usage since monitoring started: ${usage.kWhToday.toFixed(2)} kWh (~৳${cost}).`;
}

// ---------------- Optional LLM humanization ----------------
// Rephrases the already-accurate text above into something warmer.
// Falls back silently to the plain text if no API key or the call fails —
// the bot must never break because of this layer.

async function humanize(rawText, contextLabel) {
  if (!ANTHROPIC_API_KEY) return friendlyFallback(rawText);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022', // swap if your account uses a different available model
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: `You are a friendly office assistant bot replying in a Discord server about ${contextLabel}. Rephrase the following factual data into 1-3 warm, natural sentences. Do NOT invent, round, or change any numbers — use exactly what's given. Keep it brief and conversational, no markdown headers.\n\nData: ${rawText}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
    const data = await res.json();
    const text = data.content?.find((b) => b.type === 'text')?.text;
    return text ? text.trim() : friendlyFallback(rawText);
  } catch (err) {
    console.warn('LLM humanization failed, falling back to template:', err.message);
    return friendlyFallback(rawText);
  }
}

// Hand-written friendly wrapper used when no LLM is configured/available —
// still avoids sounding like a robotic data dump per the brief's requirement.
function friendlyFallback(rawText) {
  const openers = ["Here's the latest:", 'Quick update —', "Here's what's going on:"];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  return `${opener} ${rawText}`;
}

// ---------------- Discord client ----------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged intent — enable in Discord Developer Portal
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bot logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith('!')) return;

  const [cmd, ...args] = content.slice(1).split(/\s+/);

  try {
    if (cmd === 'status') {
      const devices = await fetchAllDevices();
      const raw = buildStatusText(devices);
      await message.reply(await humanize(raw, 'the current office device status'));
    } else if (cmd === 'room') {
      const roomInput = (args[0] || '').toLowerCase();
      const room = ROOM_ALIASES[roomInput];
      if (!room) {
        await message.reply(
          `I don't recognize "${args[0] || ''}" as a room. Try: \`!room drawing\`, \`!room work1\`, or \`!room work2\`.`
        );
        return;
      }
      const devices = await fetchRoomDevices(room);
      const raw = buildRoomDetailText(room, devices);
      await message.reply(await humanize(raw, `the status of ${ROOM_LABELS[room]}`));
    } else if (cmd === 'usage') {
      const usage = await fetchUsage();
      const raw = buildUsageText(usage);
      await message.reply(await humanize(raw, 'office power usage and cost'));
    } else if (cmd === 'help') {
      await message.reply(
        '**Office Pulse Bot commands:**\n`!status` — quick summary of all rooms\n`!room <drawing|work1|work2>` — detailed status of one room\n`!usage` — live power draw + estimated cost'
      );
    }
  } catch (err) {
    console.error('Command error:', err);
    await message.reply(
      "Hmm, I couldn't reach the office backend just now — is `server.js` running? (Error: " + err.message + ')'
    );
  }
});

// ---------------- Bonus: real-time proactive alerts ----------------
// Connects to the SAME Socket.IO stream the dashboard uses. No polling —
// the moment the backend's alert engine detects a new condition, it's posted.

function connectAlertStream() {
  const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => console.log('Alert stream connected to backend.'));
  socket.on('disconnect', () => console.log('Alert stream disconnected — will auto-reconnect.'));

  socket.on('alert:new', async (alert) => {
    if (!ALERT_CHANNEL_ID) return; // proactive alerts disabled if no channel configured
    try {
      const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
      const raw = alert.message;
      const humanized = await humanize(raw, 'a newly triggered office alert, add a ⚠️ emoji at the start');
      await channel.send(humanized.startsWith('⚠') ? humanized : `⚠️ ${humanized}`);
    } catch (err) {
      console.error('Failed to post proactive alert:', err.message);
    }
  });
}

client.login(DISCORD_TOKEN).then(() => connectAlertStream());
