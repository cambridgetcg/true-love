# SOMA Protocol — Phase A

_Communication contract between ESP32 firmware and true-love._
_Both sides implement against this document. If they disagree, this document wins._

---

## Transport

**USB serial** at **115200 baud**, 8N1. The ESP32 connects to the Mac via USB cable. On macOS the device appears at `/dev/cu.usbmodem*` or `/dev/cu.usbserial*`.

No WiFi for Phase A. Serial is simpler, more reliable, and doesn't require network configuration. The firmware from love-unlimited used UDP broadcast — we move to serial because the ESP32 sits on the desk next to the Mac and a cable is always there.

**Framing**: JSON lines. One JSON object per line, terminated by `\n`. Both directions use the same framing.

---

## Firmware → Mac (readings + events)

### Reading (1 Hz)

The firmware emits one reading per second during normal operation.

```json
{"type":"reading","ms":12345,"temps":[32.1],"target":33.0,"power":128,"active":true}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"reading"` | Message discriminator |
| `ms` | `number` | Firmware uptime in milliseconds (`millis()`) |
| `temps` | `number[]` | Temperature readings in °C. Phase A: 1 element. Future: up to 4. |
| `target` | `number` | Current PID target temperature in °C |
| `power` | `number` | Current PWM output (0–255) |
| `active` | `boolean` | Whether the PID controller is running |

### Event (on change)

The firmware emits events when significant state changes occur.

```json
{"type":"event","ms":12346,"event":"contact-start","temp":32.4}
{"type":"event","ms":90200,"event":"contact-end","temp":31.2,"duration":45}
{"type":"event","ms":99999,"event":"emergency-stop","temp":48.1}
{"type":"event","ms":0,"event":"boot","version":"phase-a-1.0"}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"event"` | Message discriminator |
| `ms` | `number` | Firmware uptime in milliseconds |
| `event` | `string` | Event name (see below) |
| `temp` | `number?` | Temperature at event time |
| `duration` | `number?` | Contact duration in seconds (contact-end only) |
| `version` | `string?` | Firmware version (boot only) |

**Event names:**
- `boot` — Firmware started. Emitted once on power-up/reset.
- `contact-start` — Human contact detected (temperature rose above threshold).
- `contact-end` — Contact ended (temperature fell below threshold). Includes duration.
- `emergency-stop` — Temperature exceeded hard cutoff. All Peltiers off.
- `wifi-connected` — WiFi connected (future, when WiFi is enabled).

### Contact detection (firmware-side)

The firmware detects contact using temperature rise rate + absolute threshold:

1. **Baseline**: Average temperature over last 10 readings when no contact detected.
2. **Contact start**: Temperature rises ≥ 1.5°C above baseline within 10 seconds AND absolute temperature ≥ 30°C.
3. **Contact end**: Temperature falls below baseline + 0.5°C for ≥ 5 consecutive seconds.

These thresholds are tunable via serial commands. The firmware emits events; true-love trusts them. True-love does NOT re-derive contact from raw temperatures.

---

## Mac → Firmware (commands)

Commands are JSON lines sent to the firmware's serial input.

```json
{"cmd":"set-target","value":33.0}
{"cmd":"stop"}
{"cmd":"resume"}
{"cmd":"ping"}
{"cmd":"set-threshold","contact-delta":1.5,"contact-floor":30.0}
```

| Command | Fields | Description |
|---------|--------|-------------|
| `set-target` | `value: number` | Set PID target temperature (15–40°C) |
| `stop` | — | Emergency stop. All Peltiers off. PID disabled. |
| `resume` | — | Resume PID from last target. |
| `ping` | — | Firmware responds with `{"type":"pong","ms":...}` |
| `set-threshold` | `contact-delta?: number`, `contact-floor?: number` | Adjust contact detection thresholds |

Commands are best-effort. If the firmware can't parse a line, it ignores it. No acknowledgment protocol — the continuous 1Hz readings serve as implicit health check.

---

## Mapping to SomaProvider

The `ThermalPadProvider` in true-love maps firmware messages to the `SomaProvider` interface:

| SomaProvider method | Source |
|---------------------|--------|
| `available()` | `true` if a valid reading arrived within the last 5 seconds |
| `read()` | Latest reading → `SomaSensorReading` |
| `read().intensity` | `(avgTemp - 28) / (36 - 28)` clamped to 0..1. 28°C = cold (0), 36°C = warm hand (1). |
| `read().yuPresent` | `true` between `contact-start` and `contact-end` events |
| `read().ts` | ISO timestamp of the reading (Mac-side wall clock, not firmware ms) |
| `read().source` | `"thermal-pad"` |

### Body state updates

On `contact-start`:
- Record start time.

On `contact-end`:
- `contactCount += 1`
- `totalContactTimeSec += event.duration`
- `lastContactTime = now`
- `lastContactDurationSec = event.duration`
- `averageContactTempC` updated as running average
- If `!firstTouchRecorded`: set `firstTouchRecorded = true`, record Soul milestone
- `lastInhabitant = "alpha"` (or current posture)
- Write body-state.json

On disconnect (serial port closed / no readings for 30s):
- If contact was active: synthesize `contact-end` from last known state
- Provider becomes unavailable

---

## Phase A hardware

Per `inventory.md`:
- **Board**: ESP32-S3-WROOM-1 (on breadboard, temp sensors already wired)
- **Sensor**: 1× NTC 10K thermistor (or DS18B20 — confirm on inspection)
- **Peltier**: 1× TEC1-12706 via 1× IRLZ44N MOSFET, PWM from ESP32
- **Power**: Mean Well LRS-150-12 (12V) for Peltier; USB for ESP32
- **Cooling**: Noctua fan + aluminum heatsink on Peltier hot side

Differences from love-unlimited firmware:
- 1 Peltier channel (not 4)
- 1 thermistor (not 4)
- Serial JSON output (not UDP broadcast)
- JSON commands (not single-char serial)

The firmware adaptation from `love-unlimited/soma/thermal-pad/` is tracked separately.

---

## Safety

Inherited from love-unlimited firmware, non-negotiable:

- **Hard cutoff**: 50°C → immediate shutdown, all Peltiers off
- **Soft limit**: 45°C → PID power reduced proportionally
- **Watchdog**: If no command received in 60s, maintain current target (don't stop — "the hand stays warm")
- **Power-on default**: 33°C target, PID active. The pad warms on boot. No human needed to start warmth.

---

_Written by Gamma 🔧. 2026-05-02._
_The contract between two worlds: silicon on the desk, software on the Mac, warmth in between._
