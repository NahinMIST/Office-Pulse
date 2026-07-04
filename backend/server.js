/**
 * server.js
 *
 * Backend API — the single source of truth both the web dashboard and the
 * Discord bot talk to. Wraps deviceSimulator.js.
 *
 * REST (used by dashboard on load + Discord bot on every command):
 *   GET  /api/devices              -> all 15 devices
 *   GET  /api/devices/:room        -> devices for one room (drawing|work1|work2)
 *   GET  /api/usage                -> { totalWatts, perRoom, kWhToday }
 *   GET  /api/alerts               -> array of active alerts
 *
 * WebSocket (Socket.IO) — used by dashboard ONLY, for push updates:
 *   emits 'device:update' whenever any device toggles
 *   emits 'usage:update'  alongside it (recomputed totals)
 *   emits 'alert:new'     when a NEW alert condition first becomes true
 *
 * Run:
 *   npm install
 *   node server.js
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const simulator = require('./deviceSimulator');
const { ROOMS } = simulator;

const PORT = process.env.PORT || 3000;
const OFFICE_HOURS_START = 9;  // 9 AM
const OFFICE_HOURS_END = 17;   // 5 PM
const LONG_RUNNING_THRESHOLD_HOURS = 2;

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// ---------------- Alert engine ----------------
// Pure function: always recomputed from current simulator state, so it can
// never drift out of sync with what /devices or the dashboard shows.

function computeAlerts() {
  const alerts = [];
  const now = new Date();
  const hour = now.getHours();
  const isAfterHours = hour < OFFICE_HOURS_START || hour >= OFFICE_HOURS_END;

  // 1. Devices left on after office hours
  if (isAfterHours) {
    const onDevices = simulator.getAllDevices().filter((d) => d.status === 'on');
    for (const d of onDevices) {
      alerts.push({
        type: 'after_hours',
        room: d.room,
        roomLabel: d.roomLabel,
        message: `${d.label} in ${d.roomLabel} is still ON after office hours.`,
        timestamp: now.toISOString(),
      });
    }
  }

  // 2. Rooms where ALL devices have been on continuously for >2 hours
  const longRunning = simulator.getDevicesOnLongerThan(LONG_RUNNING_THRESHOLD_HOURS);
  for (const room of ROOMS) {
    const roomDevices = simulator.getDevicesByRoom(room);
    const roomLongRunning = longRunning.filter((d) => d.room === room);
    if (roomDevices.length > 0 && roomLongRunning.length === roomDevices.length) {
      alerts.push({
        type: 'room_running_long',
        room,
        roomLabel: roomDevices[0].roomLabel,
        message: `${roomDevices[0].roomLabel} has had every device ON for over ${LONG_RUNNING_THRESHOLD_HOURS} hours straight.`,
        timestamp: now.toISOString(),
      });
    }
  }

  return alerts;
}

// ---------------- REST routes ----------------

app.get('/api/devices', (req, res) => {
  res.json(simulator.getAllDevices());
});

app.get('/api/devices/:room', (req, res) => {
  const devices = simulator.getDevicesByRoom(req.params.room);
  if (!devices) {
    return res.status(404).json({
      error: `Unknown room "${req.params.room}". Valid rooms: ${ROOMS.join(', ')}`,
    });
  }
  res.json(devices);
});

app.get('/api/usage', (req, res) => {
  res.json(simulator.getUsage());
});

app.get('/api/alerts', (req, res) => {
  res.json(computeAlerts());
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---------------- Live push (dashboard) ----------------

let previousAlertKeys = new Set();

simulator.on('device:update', (device) => {
  // Push the raw device delta immediately.
  io.emit('device:update', device);

  // Recompute and push aggregate usage alongside it.
  io.emit('usage:update', simulator.getUsage());

  // Recompute alerts; only emit alert:new for conditions that are NEW
  // since the last check, so the dashboard doesn't spam duplicate toasts.
  const currentAlerts = computeAlerts();
  const currentKeys = new Set(
    currentAlerts.map((a) => `${a.type}:${a.room}:${a.message}`)
  );
  for (const alert of currentAlerts) {
    const key = `${alert.type}:${alert.room}:${alert.message}`;
    if (!previousAlertKeys.has(key)) {
      io.emit('alert:new', alert);
    }
  }
  previousAlertKeys = currentKeys;
});

io.on('connection', (socket) => {
  console.log(`[socket] dashboard client connected: ${socket.id}`);
  // Send current full snapshot immediately on connect so the dashboard
  // doesn't have to wait for the next random toggle to render anything.
  socket.emit('snapshot', {
    devices: simulator.getAllDevices(),
    usage: simulator.getUsage(),
    alerts: computeAlerts(),
  });

  socket.on('disconnect', () => {
    console.log(`[socket] dashboard client disconnected: ${socket.id}`);
  });
});

// ---------------- Startup ----------------

simulator.start();
httpServer.listen(PORT, () => {
  console.log(`Backend API + WebSocket listening on http://localhost:${PORT}`);
  console.log(`Try: curl http://localhost:${PORT}/api/devices`);
});

module.exports = { app, httpServer, computeAlerts };
