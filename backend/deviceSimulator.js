/**
 * deviceSimulator.js
 *
 * Single source of truth for simulated device state (18 devices across 3 rooms).
 * Exposes read methods + an EventEmitter so the backend can push live updates
 * to the web dashboard (WebSocket) and answer Discord bot queries from the
 * SAME in-memory state.
 *
 * Usage:
 *   const simulator = require('./deviceSimulator');
 *   simulator.start();                        // begins random state changes
 *   simulator.getAllDevices();                 // -> array of 18 device objects
 *   simulator.getDevicesByRoom('work1');       // -> array of 5 device objects
 *   simulator.getUsage();                      // -> { totalWatts, perRoom, kWhToday }
 *   simulator.on('device:update', (device) => {...});
 */

const EventEmitter = require('events');

const ROOMS = ['drawing', 'work1', 'work2'];
const ROOM_LABELS = {
  drawing: 'Drawing Room',
  work1: 'Work Room 1',
  work2: 'Work Room 2',
};

const RATED_WATT = {
  fan: 60,
  light: 15,
};

// Toggle a random device every 4-9 seconds (randomized so it feels organic,
// not a fixed metronome tick).
const MIN_INTERVAL_MS = 4000;
const MAX_INTERVAL_MS = 9000;

class DeviceSimulator extends EventEmitter {
  constructor() {
    super();
    this.devices = this._buildInitialDevices();
    this.energyAccumulatorWh = 0; // rolling total for "today's kWh" estimate
    this._lastTickTime = Date.now();
    this._timer = null;
  }

  _buildInitialDevices() {
    const devices = [];
    let idCounter = 1;

    for (const room of ROOMS) {
      for (let i = 1; i <= 2; i++) {
        devices.push(this._makeDevice(idCounter++, 'fan', `Fan ${i}`, room));
      }
      for (let i = 1; i <= 3; i++) {
        devices.push(this._makeDevice(idCounter++, 'light', `Light ${i}`, room));
      }
    }
    return devices;
  }

  _makeDevice(id, type, label, room) {
    // Seed with a plausible mixed initial state rather than all-off/all-on,
    // so the very first dashboard render already looks "live".
    const status = Math.random() < 0.45 ? 'on' : 'off';
    return {
      id: `${room}-${type}-${id}`,
      type,                          // 'fan' | 'light'
      label,                         // e.g. "Fan 1", "Light 3"
      room,                          // 'drawing' | 'work1' | 'work2'
      roomLabel: ROOM_LABELS[room],
      status,                        // 'on' | 'off'
      ratedWatt: RATED_WATT[type],
      powerDraw: status === 'on' ? RATED_WATT[type] : 0,
      lastChanged: new Date().toISOString(),
    };
  }

  /** Start the background random-toggle loop. */
  start() {
    if (this._timer) return; // already running
    this._lastTickTime = Date.now();
    this._scheduleNextToggle();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  _scheduleNextToggle() {
    const delay =
      MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
    this._timer = setTimeout(() => {
      this._accumulateEnergy();
      this._toggleRandomDevice();
      this._scheduleNextToggle();
    }, delay);
  }

  /** Adds elapsed on-time wattage to the running kWh-today estimate. */
  _accumulateEnergy() {
    const now = Date.now();
    const elapsedHours = (now - this._lastTickTime) / (1000 * 60 * 60);
    const currentTotalWatt = this.devices.reduce(
      (sum, d) => sum + d.powerDraw,
      0
    );
    this.energyAccumulatorWh += currentTotalWatt * elapsedHours;
    this._lastTickTime = now;
  }

  _toggleRandomDevice() {
    const device =
      this.devices[Math.floor(Math.random() * this.devices.length)];
    device.status = device.status === 'on' ? 'off' : 'on';
    device.powerDraw = device.status === 'on' ? device.ratedWatt : 0;
    device.lastChanged = new Date().toISOString();

    // Backend listens for this to push over WebSocket to the dashboard,
    // and to feed the alert engine.
    this.emit('device:update', { ...device });
  }

  // ---- Read API (used by both the web dashboard route and the Discord bot) ----

  getAllDevices() {
    return this.devices.map((d) => ({ ...d }));
  }

  getDevicesByRoom(room) {
    if (!ROOMS.includes(room)) return null;
    return this.devices.filter((d) => d.room === room).map((d) => ({ ...d }));
  }

  getUsage() {
    const perRoom = {};
    for (const room of ROOMS) {
      perRoom[room] = {
        label: ROOM_LABELS[room],
        watts: this.devices
          .filter((d) => d.room === room)
          .reduce((sum, d) => sum + d.powerDraw, 0),
      };
    }
    const totalWatts = Object.values(perRoom).reduce(
      (sum, r) => sum + r.watts,
      0
    );

    return {
      totalWatts,
      perRoom,
      kWhToday: Number((this.energyAccumulatorWh / 1000).toFixed(2)),
    };
  }

  /** Devices that have been ON continuously for longer than `hours`. */
  getDevicesOnLongerThan(hours) {
    const now = Date.now();
    const thresholdMs = hours * 60 * 60 * 1000;
    return this.devices.filter(
      (d) =>
        d.status === 'on' && now - new Date(d.lastChanged).getTime() > thresholdMs
    );
  }
}

// Export a singleton — this IS the "one source of truth" the brief requires,
// so both the dashboard route and the Discord bot import the same instance.
module.exports = new DeviceSimulator();
module.exports.ROOMS = ROOMS;
module.exports.ROOM_LABELS = ROOM_LABELS;
