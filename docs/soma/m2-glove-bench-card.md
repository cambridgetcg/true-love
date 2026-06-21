# SOMA M2 — five-finger haptic glove bench card

**Milestone:** Phase B M2
**Hardware:** ESP32-S3-DevKitC-1-N8R8
**Firmware:** `firmware/soma-haptic-glove/src/main_m2.cpp`
**Date:** 2026-06-11
**Status:** STAGED (hardware on hand, firmware written, not yet verified)

---

## Objective

Expand M1 single-finger prototype to full five-finger array. Verify independent sensor reading and haptic feedback for each finger.

---

## Hardware inventory

- 1× ESP32-S3-DevKitC-1-N8R8
- 5× Spectra Symbol flex sensor (55mm)
- 10× FSR 402 (Interlink) — 5 deployed
- 10× Vybronics VG0832013D LRA (235Hz resonant) — 5 deployed
- 10× 10kΩ resistor (for voltage dividers)
- Breadboard + jumper wires

---

## Wiring diagram

### Flex sensors (all via 10kΩ voltage divider)
```
3V3 ── 10kΩ ──┬──── GPIO 1 (Thumb)  [ADC1_CH0]
              │
         Flex sensor
              │
             GND

(repeat pattern for Index/Middle/Ring/Pinky on GPIO 3,5,7,9)
```

| Finger | GPIO | ADC1 Channel |
|--------|------|--------------|
| Thumb  | 1    | CH0          |
| Index  | 3    | CH2          |
| Middle | 5    | CH4          |
| Ring   | 7    | CH6          |
| Pinky  | 9    | CH8          |

### FSR sensors (all via 10kΩ voltage divider)
```
3V3 ── 10kΩ ──┬──── GPIO 2 (Thumb)  [ADC1_CH1]
              │
          FSR 402
              │
             GND

(repeat pattern for Index/Middle/Ring/Pinky on GPIO 4,6,8,10)
```

| Finger | GPIO | ADC1 Channel |
|--------|------|--------------|
| Thumb  | 2    | CH1          |
| Index  | 4    | CH3          |
| Middle | 6    | CH5          |
| Ring   | 8    | CH7          |
| Pinky  | 10   | CH9          |

### LRA actuators (235Hz LEDC PWM)
```
GPIO 11 (Thumb)  ── LRA+
                    LRA- ── GND

(repeat for Index/Middle/Ring/Pinky on GPIO 12,13,14,15)
```

| Finger | GPIO | LEDC Channel |
|--------|------|--------------|
| Thumb  | 11   | 0            |
| Index  | 12   | 1            |
| Middle | 13   | 2            |
| Ring   | 14   | 3            |
| Pinky  | 15   | 4            |

---

## Flash and monitor

```bash
cd firmware/soma-haptic-glove
pio run -e m2 --target upload
pio device monitor -e m2
```

Expected boot banner:
```
============================================
  SOMA M2 — five-finger haptic glove
  ESP32-S3-DEVKITC-1 @ 115200
  5x Flex:  GPIO 1,3,5,7,9   (ADC1, 10k div)
  5x FSR:   GPIO 2,4,6,8,10  (ADC1, 10k div)
  5x LRA:   GPIO 11-15, 235 Hz LEDC
  Out:      JSON 200ms  {fingers:[...x5]}
============================================
```

---

## Pass criteria

### 1. Flex sensor range (per finger)
- Flat (straight finger) → `flex_deg ≈ 0` (±10°)
- 90° curl (fully curled) → `flex_deg ≈ 90` (±10°)
- Smooth interpolation between extremes

### 2. FSR pressure (per finger)
- No contact → `fsr_pct = 0`
- Firm press → `fsr_pct > 50`
- Light touch → `0 < fsr_pct < 30`

### 3. LRA haptic feedback (per finger)
- No press → `lra_duty = 0`, LRA silent
- Firm press → `lra_duty > 127`, LRA buzzing audibly
- Each LRA responds **only** to its corresponding FSR (no crosstalk)

### 4. JSON wire format
Every 200ms, one line:
```json
{"type":"reading","ms":12345,"fingers":[
  {"flex_deg":0,"fsr_pct":0,"lra_duty":0},
  {"flex_deg":15,"fsr_pct":42,"lra_duty":107},
  {"flex_deg":90,"fsr_pct":85,"lra_duty":217},
  {"flex_deg":45,"fsr_pct":0,"lra_duty":0},
  {"flex_deg":0,"fsr_pct":0,"lra_duty":0}
]}
```
Order: Thumb, Index, Middle, Ring, Pinky.

---

## Calibration notes

Default calibration constants (uniform across fingers):
```cpp
ADC_FLEX_FLAT[i] = 1200  // all fingers
ADC_FLEX_90[i]   = 350   // all fingers
FSR_MAX_ADC[i]   = 3500  // all fingers
```

If per-finger tuning is needed:
1. Run serial monitor, note actual ADC values for flat/90° flex
2. Note ADC at firm FSR press
3. Edit arrays in `main_m2.cpp` accordingly
4. Reflash

---

## Test procedure

1. **Power-on check:**
   - Flash M2 firmware
   - Verify boot banner appears
   - Verify JSON lines streaming at 200ms intervals

2. **Flex test (per finger):**
   - Leave all fingers flat → verify `flex_deg ≈ 0` for all
   - Curl Thumb to 90° → verify Thumb `flex_deg ≈ 90`, others unchanged
   - Repeat for Index, Middle, Ring, Pinky

3. **FSR + LRA test (per finger):**
   - Press Thumb FSR firmly → verify Thumb `fsr_pct > 50`, `lra_duty > 127`, Thumb LRA buzzes
   - Verify **no other LRAs activate** (no crosstalk)
   - Release → verify Thumb `fsr_pct = 0`, `lra_duty = 0`, LRA silent
   - Repeat for Index, Middle, Ring, Pinky

4. **Multi-finger simultaneous test:**
   - Curl Index + Ring, press Middle FSR
   - Verify Index/Ring show flex, Middle shows FSR + LRA, others idle

---

## Sign-off

| Test | Status | Notes | Tester | Date |
|------|--------|-------|--------|------|
| Flex range (all fingers) | ☐ PASS ☐ FAIL | | | |
| FSR pressure (all fingers) | ☐ PASS ☐ FAIL | | | |
| LRA feedback + isolation | ☐ PASS ☐ FAIL | | | |
| JSON wire format | ☐ PASS ☐ FAIL | | | |
| Multi-finger simultaneous | ☐ PASS ☐ FAIL | | | |

**M2 accepted:** ☐ YES ☐ NO
**Signed:** ________________
**Date:** ________________

---

## Next milestone

**M3:** Add host-driven command protocol for selective LRA control (decouple LRA from FSR, enable remote haptic patterns).

---

— Recorded by 愛 / Gamma at Yu's WILL. 2026-06-11.
