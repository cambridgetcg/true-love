// SOMA thermal pad — M2: Wiggle the MOSFET (dry).
//
// Phase A milestone 2. M1's sensor stays live; GPIO 4 now PWMs the
// IRLZ44N gate with an LED-with-resistor as the load (NOT the Peltier).
// Duty ramps 0→255→0 over 4 seconds, continuously.
//
//     3V3 ── 10kΩ ──┬──── GPIO 1 (ADC1_CH0)          [M1 divider, unchanged]
//                   │
//                  NTC (Haljia waterproof, 2 wires, unpolarized)
//                   │
//                  GND
//
//     GPIO 4 ──┬──────────── IRLZ44N gate
//              │                  drain ── LED ── 330Ω ── 5V (or 3V3)
//             10kΩ                source ── GND
//              │
//             GND               [pulldown: gate LOW on reset → LED dark]
//
//     GPIO 3 ── jumper to gate  [optional: chip-ADC voltmeter — the
//                                2026-05-02 bench workaround for no LED.
//                                Averaged ADC ≈ duty × 3.3V]
//
// Verifies (phase-a-thermal-pad.md § M2): PWM works; GPIO 4 configured;
// gate pulldown correct (LED off on reset); IRLZ44N switches at logic
// levels. Done when: LED visibly ramps, reset → dark, no smoke.
//
// — Recorded by 愛 / Sophia at Yu's WILL. 2026-06-09.

#include <Arduino.h>
#include <math.h>

// ── M1: sensor (unchanged) ──────────────────────────────────────────
constexpr int   NTC_PIN         = 1;          // GPIO 1 = ADC1_CH0
constexpr float NTC_R0_OHMS     = 10000.0f;
constexpr float NTC_BETA        = 3950.0f;
constexpr float NTC_T0_K        = 298.15f;
constexpr float SERIES_OHMS     = 10000.0f;
constexpr int   ADC_MAX         = 4095;
constexpr int   SAMPLES         = 16;
constexpr int   SAMPLE_DELAY_MS = 2;

// ── M2: gate PWM ────────────────────────────────────────────────────
constexpr int      GATE_PIN        = 4;       // IRLZ44N gate via LEDC PWM
constexpr int      GATE_SENSE_PIN  = 3;       // optional jumper to gate (ADC1_CH2)
constexpr uint32_t PWM_FREQ_HZ     = 5000;    // well above LED flicker; gate-friendly
constexpr int      PWM_RES_BITS    = 8;       // duty 0..255
constexpr uint32_t RAMP_PERIOD_MS  = 4000;    // 0→255→0 over 4 s
constexpr uint32_t REPORT_EVERY_MS = 1000;    // M1 temp + M2 duty line, 1 Hz

// ESP32-S3 ADC quirk: reading the same pin in tight loops causes
// stale sample-and-hold values. Reading a different ADC pin first
// "primes" the cap so the target read is fresh. We read GPIO 2 as
// a throwaway before each real read.
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

// Triangle wave: 0→255 over the first half of the period, 255→0 over
// the second. Pure function of uptime, so the ramp never drifts.
static uint8_t rampDuty(uint32_t ms) {
  uint32_t t = ms % RAMP_PERIOD_MS;
  uint32_t half = RAMP_PERIOD_MS / 2;
  if (t < half) return (uint8_t)(t * 255 / half);
  return (uint8_t)((RAMP_PERIOD_MS - t) * 255 / half);
}

static void gatePwmWrite(uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(GATE_PIN, duty);             // core 3.x: channel is keyed by pin
#else
  ledcWrite(0, duty);                    // core 2.x: channel 0
#endif
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  analogReadResolution(12);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(GATE_PIN, PWM_FREQ_HZ, PWM_RES_BITS);
#else
  ledcSetup(0, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(GATE_PIN, 0);
#endif
  gatePwmWrite(0);                       // explicit: start dark, like reset

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA M2 — wiggle the MOSFET (dry)");
  Serial.println("  ESP32-S3-DEVKITC-1 @ 115200");
  Serial.println("  Gate:  silkscreen 4 (GPIO 4), 5 kHz PWM");
  Serial.println("  Load:  LED + 330R on IRLZ44N drain (NOT Peltier)");
  Serial.println("  Ramp:  duty 0->255->0 over 4 s, continuous");
  Serial.println("  Sense: jumper gate->GPIO 3 for chip-ADC voltmeter");
  Serial.println("  Pass:  LED ramps | reset -> dark | no smoke");
  Serial.println("============================================");
  Serial.println();
}

void loop() {
  static uint32_t lastReport = 0;
  uint32_t now = millis();

  uint8_t duty = rampDuty(now);
  gatePwmWrite(duty);

  if (now - lastReport >= REPORT_EVERY_MS) {
    lastReport = now;

    // M1 line — the sensor stays live through every milestone.
    float adc = readAdcAverage(NTC_PIN);
    float r   = adcToResistance(adc);
    float c   = resistanceToCelsius(r);

    Serial.print("M1: ");
    if (isnan(c)) {
      Serial.print(adc < 1.0f ? "OPEN/SHORT-LOW" : "OPEN-HIGH");
      Serial.print("  raw_avg=");
      Serial.print((int)adc);
    } else {
      Serial.print("temp=");
      Serial.print(c, 2);
      Serial.print(" °C");
    }

    // M2 line — duty plus the gate as the chip's own ADC sees it.
    // PWM samples land ~0 or ~3V3; a 16-sample average ≈ duty × 3.3 V.
    float gateAdc   = readAdcAverage(GATE_SENSE_PIN);
    float gateVolts = gateAdc * 3.3f / (float)ADC_MAX;
    float expectVolts = duty * 3.3f / 255.0f;

    Serial.print("   |   M2: duty=");
    Serial.print(duty);
    Serial.print("/255  gate~");
    Serial.print(gateVolts, 2);
    Serial.print(" V (expect ~");
    Serial.print(expectVolts, 2);
    Serial.println(" V if jumpered, ~0.00 V if not)");
  }

  delay(5);  // ~200 Hz ramp updates; smooth to the eye
}
