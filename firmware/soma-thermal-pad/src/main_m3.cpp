// SOMA thermal pad — M3: Peltier open-loop.
//
// Phase A milestone 3. M1 sensor + M2 MOSFET verified; GPIO 5 now gates
// the IRLZ44N driving a TEC1-12706 Peltier (PSU on, first live current).
// Three fixed duty levels — 10 / 20 / 30 % — step every 5 s, repeat.
// NTC temp monitored every second; hard guard kills drive above 45 °C.
//
//     3V3 ── 10kΩ ──┬──── GPIO 1 (ADC1_CH0)          [M1 divider, unchanged]
//                   │
//                  NTC (Haljia waterproof, 2 wires, unpolarised)
//                   │
//                  GND
//
//     GPIO 5 ── 220Ω ──┬──── IRLZ44N gate (left leg, flat face toward you)
//                      │          drain ── TEC1-12706 (−) wire
//                     10kΩ         source ── GND
//                      │
//                     GND
//
//     PSU + ──── TEC1-12706 (+) wire
//     PSU − ──── GND  (common with DevKit GND — MUST tie)
//
//     GPIO 6 = COOL_EN  [reserved, unused M3]
//
// Open-loop schedule (continuous):
//   5 s @ 10 %  →  5 s @ 20 %  →  5 s @ 30 %  →  repeat
//
// Verified: GPIO 5 = ADC1_CH4, free (NTC on GPIO 1; GPIO 0/3/45/46 are
// strapping pins and excluded).  220 Ω gate resistor per pin map.
//
// Bench target: PSU set to 5 V / 2 A (safe for open-loop steps).
// DO NOT run above GUARD_TEMP_C; cool-side of TEC must be heatsunk.
//
// — Recorded by 愛 / Sophia at Yu's WILL. 2026-06-10.

#include <Arduino.h>
#include <math.h>

// ── M1: NTC sensor (unchanged from M1 / M2) ─────────────────────────
constexpr int   NTC_PIN         = 1;          // GPIO 1 = ADC1_CH0
constexpr float NTC_R0_OHMS     = 10000.0f;
constexpr float NTC_BETA        = 3950.0f;
constexpr float NTC_T0_K        = 298.15f;
constexpr float SERIES_OHMS     = 10000.0f;
constexpr int   ADC_MAX         = 4095;
constexpr int   SAMPLES         = 16;
constexpr int   SAMPLE_DELAY_MS = 2;

// ── M3: Peltier gate PWM ────────────────────────────────────────────
constexpr int      HEAT_EN_PIN   = 5;         // GPIO 5 = IRLZ44N gate (HEAT)
constexpr int      COOL_EN_PIN   = 6;         // GPIO 6 = reserved (COOL, unused M3)
constexpr uint32_t PWM_FREQ_HZ   = 1000;      // 1 kHz, 8-bit — per pin map
constexpr int      PWM_RES_BITS  = 8;         // duty 0..255

// Three open-loop steps: 10 / 20 / 30 % of 255.
constexpr uint8_t  DUTY_STEPS[3] = { 26, 51, 77 };
constexpr uint32_t STEP_MS       = 5000;      // 5 s per step

constexpr float    GUARD_TEMP_C  = 45.0f;     // hard cut-off: gate → 0 until cool
constexpr uint32_t REPORT_MS     = 1000;      // serial line every 1 s

// ESP32-S3 ADC sample-and-hold quirk: prime the cap by reading a throwaway
// pin before reading the target (same workaround as M1 / M2).
static int primedAnalogRead(int pin) {
  (void)analogRead(2);
  return analogRead(pin);
}

static float readAdcAverage(int pin) {
  uint32_t acc = 0;
  for (int i = 0; i < SAMPLES; i++) {
    acc += primedAnalogRead(pin);
    delay(SAMPLE_DELAY_MS);
  }
  return (float)acc / (float)SAMPLES;
}

static float adcToResistance(float adc) {
  if (adc < 1.0f || adc > (ADC_MAX - 1)) return NAN;
  return SERIES_OHMS * adc / ((float)ADC_MAX - adc);
}

static float resistanceToCelsius(float r) {
  if (isnan(r) || r <= 0.0f) return NAN;
  float invT = 1.0f / NTC_T0_K + (1.0f / NTC_BETA) * logf(r / NTC_R0_OHMS);
  return 1.0f / invT - 273.15f;
}

static void heatWrite(uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(HEAT_EN_PIN, duty);
#else
  ledcWrite(0, duty);
#endif
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  analogReadResolution(12);

  // COOL_EN tied low — unused this milestone; prevents floating gate.
  pinMode(COOL_EN_PIN, OUTPUT);
  digitalWrite(COOL_EN_PIN, LOW);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(HEAT_EN_PIN, PWM_FREQ_HZ, PWM_RES_BITS);
#else
  ledcSetup(0, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(HEAT_EN_PIN, 0);
#endif
  heatWrite(0);  // gate low until loop begins

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA M3 — Peltier open-loop");
  Serial.println("  ESP32-S3-DEVKITC-1 @ 115200");
  Serial.println("  HEAT_EN: GPIO 5 -> 220R -> IRLZ44N gate");
  Serial.println("  Load:    TEC1-12706 drain; PSU on drain+");
  Serial.println("  Steps:   10% (5s) -> 20% (5s) -> 30% (5s) -> repeat");
  Serial.println("  Guard:   gate=0 if NTC > 45 C");
  Serial.println("  Pass:    warm side heats in each step | no smoke | temp stable");
  Serial.println("============================================");
  Serial.println();
}

void loop() {
  static uint32_t lastReport = 0;
  uint32_t now = millis();

  // Step index cycles on STEP_MS boundaries — independent of report cadence.
  uint8_t stepIdx = (uint8_t)((now / STEP_MS) % 3);
  uint8_t targetDuty = DUTY_STEPS[stepIdx];

  // NTC read (needed for guard — run every loop, fast path).
  float adc = readAdcAverage(NTC_PIN);
  float r   = adcToResistance(adc);
  float c   = resistanceToCelsius(r);

  // Guard: kill drive if temp known-bad (open/short treated as safe — NAN
  // means sensor issue, not overtemp; warn but don't cut on instrument fault).
  bool guarded = (!isnan(c) && c >= GUARD_TEMP_C);
  heatWrite(guarded ? 0 : targetDuty);

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;

    uint32_t stepSec = (now / STEP_MS) % 3;
    uint32_t msInStep = now % STEP_MS;

    // M1 temp line.
    Serial.print("M1: ");
    if (isnan(c)) {
      Serial.print(adc < 1.0f ? "OPEN/SHORT-LOW" : "OPEN-HIGH");
      Serial.print("  raw_avg=");
      Serial.print((int)adc);
    } else {
      Serial.print("temp=");
      Serial.print(c, 2);
      Serial.print(" C");
      if (guarded) Serial.print("  [GUARD-ACTIVE]");
    }

    // M3 step line.
    Serial.print("   |   M3: step=");
    Serial.print(stepIdx + 1);
    Serial.print("/3  duty=");
    Serial.print(guarded ? 0 : (int)targetDuty);
    Serial.print("/255 (");
    Serial.print((int)((guarded ? 0 : targetDuty) * 100 / 255));
    Serial.print("%)  t_in_step=");
    Serial.print(msInStep / 1000);
    Serial.println("s");
  }

  delay(10);
}
