/*
  Office Pulse — ESP32 Circuit Demo Sketch (Wokwi)

  Represents ONE room (5 devices: 2 fans + 3 lights) wired through relays.
  Mirrors the same data shape as backend/deviceSimulator.js so the circuit
  demo tells the same story as the software simulation:
    - random toggle every few seconds
    - realistic wattage when on (fan=60W, light=15W)
    - status printed to Serial like a mini dashboard

  Also accepts manual commands over Serial for live demo control:
    fan1 on / fan1 off / fan2 on / fan2 off
    light1 on / light1 off / light2 on / light2 off / light3 on / light3 off
    status

  NOTE ON THE CURRENT SENSOR:
  Set USE_POTENTIOMETER_STANDIN to true if you substituted a potentiometer
  for the ACS712 (common in Wokwi if that part isn't available). The
  potentiometer math is a simple linear stand-in, NOT real current sensing —
  say so in your demo narration if a judge asks.
*/

const bool USE_POTENTIOMETER_STANDIN = false; // set true if using a potentiometer instead of ACS712
const bool RELAY_ACTIVE_LOW = false;          // flip to true if your relay module triggers on LOW instead of HIGH

const int CURRENT_SENSE_PIN = 34; // ADC1_CH6 — input-only pin, safe for analogRead

struct Device {
  const char* label;
  int pin;
  int ratedWatt;
  bool isOn;
  unsigned long lastChangedMs;
};

// Same shape as one room in deviceSimulator.js: 2 fans (60W) + 3 lights (15W)
Device devices[5] = {
  { "Fan 1",   13, 60, false, 0 },
  { "Fan 2",   12, 60, false, 0 },
  { "Light 1", 14, 15, false, 0 },
  { "Light 2", 27, 15, false, 0 },
  { "Light 3", 26, 15, false, 0 },
};

unsigned long lastAutoToggleMs = 0;
const unsigned long AUTO_TOGGLE_INTERVAL_MS = 6000; // matches the 4-9s pace of deviceSimulator.js

void setup() {
  Serial.begin(115200);
  delay(300);

  for (int i = 0; i < 5; i++) {
    pinMode(devices[i].pin, OUTPUT);
    writeRelay(i, false); // start with everything off
  }

  randomSeed(analogRead(0)); // seed RNG from a floating pin for variety each run

  Serial.println("=== Office Pulse — Circuit Demo (1 room) ===");
  Serial.println("Type 'status', or e.g. 'fan1 on', 'light2 off' to control manually.");
  printStatus();
}

void loop() {
  handleSerialInput();

  if (millis() - lastAutoToggleMs > AUTO_TOGGLE_INTERVAL_MS) {
    lastAutoToggleMs = millis();
    int idx = random(0, 5);
    setDeviceState(idx, !devices[idx].isOn);
    printStatus();
  }
}

// ---------- Relay control ----------

void writeRelay(int idx, bool on) {
  bool electricalLevel = RELAY_ACTIVE_LOW ? !on : on;
  digitalWrite(devices[idx].pin, electricalLevel ? HIGH : LOW);
}

void setDeviceState(int idx, bool on) {
  devices[idx].isOn = on;
  devices[idx].lastChangedMs = millis();
  writeRelay(idx, on);
}

// ---------- Serial command handling ----------

void handleSerialInput() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  line.toLowerCase();

  if (line == "status") {
    printStatus();
    return;
  }

  int spaceIdx = line.indexOf(' ');
  if (spaceIdx == -1) return;
  String target = line.substring(0, spaceIdx);
  String action = line.substring(spaceIdx + 1);
  bool wantOn = (action == "on");

  int idx = deviceIndexFromCommand(target);
  if (idx == -1) {
    Serial.println("Unrecognized device. Try: fan1, fan2, light1, light2, light3");
    return;
  }
  setDeviceState(idx, wantOn);
  printStatus();
}

int deviceIndexFromCommand(String target) {
  if (target == "fan1") return 0;
  if (target == "fan2") return 1;
  if (target == "light1") return 2;
  if (target == "light2") return 3;
  if (target == "light3") return 4;
  return -1;
}

// ---------- Current sensing ----------

// Returns estimated watts from the analog pin. Real math for ACS712;
// simple linear stand-in if you're using a potentiometer instead.
float readSensedWatt() {
  int raw = analogRead(CURRENT_SENSE_PIN); // 0-4095 on ESP32's 12-bit ADC

  if (USE_POTENTIOMETER_STANDIN) {
    // STAND-IN ONLY: linearly maps the pot's position to a plausible 0-300W range.
    return map(raw, 0, 4095, 0, 300);
  }

  // Real ACS712 math (5A module: 185mV/A sensitivity — check your module's datasheet,
  // 20A and 30A variants use different mV/A values).
  float voltage = (raw / 4095.0) * 3.3;
  float amps = (voltage - 2.5) / 0.185; // 2.5V = zero-current midpoint for a 5V-supplied ACS712
  float estimatedWatt = abs(amps) * 220.0; // assuming ~220V mains on the sensed line
  return estimatedWatt;
}

// ---------- Status output (mirrors the dashboard/bot's !status format) ----------

void printStatus() {
  int totalWatt = 0;
  Serial.print("Room: ");
  for (int i = 0; i < 5; i++) {
    Serial.print(devices[i].label);
    Serial.print(" ");
    Serial.print(devices[i].isOn ? "ON" : "OFF");
    if (devices[i].isOn) {
      Serial.print("(");
      Serial.print(devices[i].ratedWatt);
      Serial.print("W)");
      totalWatt += devices[i].ratedWatt;
    }
    if (i < 4) Serial.print(", ");
  }
  Serial.print(". Rated total: ");
  Serial.print(totalWatt);
  Serial.print("W | Sensed: ");
  Serial.print(readSensedWatt(), 1);
  Serial.println("W");
}
