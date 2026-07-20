// SOMA haptic glove — M1: flex + FSR sensors, one LRA actuator.
//
// Phase B milestone 1. Reads one flex sensor and one FSR via 10kΩ
// voltage dividers. Drives one Vybronics VG0832013D LRA at 235Hz
// (resonant frequency) via LEDC 8-bit. LRA duty tracks FSR directly.
// Emits one JSON line per 200ms on USB-CDC Serial.
//
//     3V3 ── 10kΩ ──┬──── GPIO 1 (ADC1_CH0)    [flex divider]
//                   │
//             Flex sensor (55mm Spectra Symbol)
//                   │
//                  GND
//
//     3V3 ── 10kΩ ──┬──── GPIO 2 (ADC1_CH1)    [FSR divider]
//                   │
//             FSR 402 (Interlink)
//                   │
//                  GND
//
//     GPIO 4 ── LRA+ (Vybronics VG0832013D, 235Hz)
//     GND    ── LRA-
//
// Wire format (M1):
//   {"type":"reading","ms":<millis>,"flex_deg":<0-90>,"fsr_pct":<0-100>,"lra_duty":<0-255>}
//
// Pass when (m1-bench-card.md sign-off):
//   flat flex → flex_deg ≈ 0; 90° flex → flex_deg ≈ 90
//   no press → fsr_pct = 0, lra_duty = 0; firm press → fsr_pct > 50
//   LRA buzzes on press, silent at rest
//   JSON valid on every line
//
// Calibration constants require bench verification:
//   ADC_FLEX_FLAT  ADC reading flat (target ≈ 1200 with 55mm + 10kΩ pulldown)
//   ADC_FLEX_90    ADC reading at 90°  (target ≈ 350)
//
// — Recorded by 愛 / Gamma at Yu's WILL. 2026-06-10.

#include <Arduino.h>

// ── flex calibration ─────────────────────────────────────────────────
// Verify these on the bench; values are for Spectra Symbol 55mm with
// 10kΩ pulldown and 3V3 rail. Flat = sensor straight, 90 = fully curled.
constexpr int ADC_FLEX_FLAT = 1200;
constexpr int ADC_FLEX_90   = 350;

// ── FSR ──────────────────────────────────────────────────────────────
constexpr int FSR_PIN       = 2;    // GPIO 2 = ADC1_CH1
constexpr int FSR_MAX_ADC   = 3500; // ADC at firm press (calibrate if needed)

// ── flex ─────────────────────────────────────────────────────────────
constexpr int FLEX_PIN      = 1;    // GPIO 1 = ADC1_CH0

// ── LRA ──────────────────────────────────────────────────────────────
constexpr int      LRA_PIN      = 4;
constexpr uint32_t LRA_FREQ_HZ  = 235;   // VG0832013D resonant frequency
constexpr int      LRA_RES_BITS = 8;     // duty 0..255

// ── sampling ─────────────────────────────────────────────────────────
constexpr int ADC_MAX         = 4095;
constexpr int SAMPLES         = 8;
constexpr int SAMPLE_DELAY_MS = 1;
constexpr int REPORT_MS       = 200;

// ESP32-S3 ADC quirk: alternate-pin prime before each real read.
static int primedAnalogRead(int pin) {
  // read GPIO 3 as a throwaway — free pin, ADC1_CH2
  (void)analogRead(3);
  return analogRead(pin);
}

static float readAdcAvg(int pin) {
  uint32_t acc = 0;
  for (int i = 0; i < SAMPLES; i++) {
    acc += primedAnalogRead(pin);
    delay(SAMPLE_DELAY_MS);
  }
  return (float)acc / (float)SAMPLES;
}

static void lraWrite(uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(LRA_PIN, duty);
#else
  ledcWrite(0, duty);
#endif
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  analogReadResolution(12);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(LRA_PIN, LRA_FREQ_HZ, LRA_RES_BITS);
#else
  ledcSetup(0, LRA_FREQ_HZ, LRA_RES_BITS);
  ledcAttachPin(LRA_PIN, 0);
#endif
  lraWrite(0);

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA M1 — haptic glove bringup");
  Serial.println("  ESP32-S3-DEVKITC-1 @ 115200");
  Serial.println("  Flex:  GPIO 1 (ADC1_CH0), 10k divider");
  Serial.println("  FSR:   GPIO 2 (ADC1_CH1), 10k divider");
  Serial.println("  LRA:   GPIO 4, 235 Hz LEDC");
  Serial.println("  Out:   JSON 200ms  {flex_deg, fsr_pct, lra_duty}");
  Serial.println("============================================");
  Serial.println();
}

void loop() {
  static uint32_t lastReport = 0;
  uint32_t now = millis();

  if (now - lastReport < (uint32_t)REPORT_MS) {
    delay(1);
    return;
  }
  lastReport = now;

  // flex → degrees 0..90, clamped
  float flexAdc = readAdcAvg(FLEX_PIN);
  int range = ADC_FLEX_FLAT - ADC_FLEX_90;
  int flexDeg = 0;
  if (range > 0) {
    float t = ((float)ADC_FLEX_FLAT - flexAdc) / (float)range;
    flexDeg = (int)(t * 90.0f + 0.5f);
    if (flexDeg < 0)  flexDeg = 0;
    if (flexDeg > 90) flexDeg = 90;
  }

  // FSR → percent 0..100
  float fsrAdc = readAdcAvg(FSR_PIN);
  int fsrPct = (int)(fsrAdc * 100.0f / (float)FSR_MAX_ADC + 0.5f);
  if (fsrPct < 0)   fsrPct = 0;
  if (fsrPct > 100) fsrPct = 100;

  // LRA duty tracks FSR linearly
  uint8_t lraDuty = (uint8_t)(fsrPct * 255 / 100);
  lraWrite(lraDuty);

  // JSON output
  Serial.print("{\"type\":\"reading\",\"ms\":");
  Serial.print(now);
  Serial.print(",\"flex_deg\":");
  Serial.print(flexDeg);
  Serial.print(",\"fsr_pct\":");
  Serial.print(fsrPct);
  Serial.print(",\"lra_duty\":");
  Serial.print(lraDuty);
  Serial.println("}");
}
