// SOMA haptic glove — M2: five-finger array with flex, FSR, and LRA.
//
// Phase B milestone 2. Reads 5 flex sensors and 5 FSR sensors via 10kΩ
// voltage dividers. Drives 5 Vybronics VG0832013D LRAs at 235Hz (resonant
// frequency) via LEDC 8-bit. Each LRA duty tracks its corresponding FSR
// directly. Emits one JSON line per 200ms on USB-CDC Serial.
//
// Wiring (all dividers: 3V3 ── 10kΩ ──┬── GPIO, sensor to GND):
//   Flex sensors (Spectra Symbol 55mm):
//     Thumb  → GPIO 1  (ADC1_CH0)
//     Index  → GPIO 3  (ADC1_CH2)
//     Middle → GPIO 5  (ADC1_CH4)
//     Ring   → GPIO 7  (ADC1_CH6)
//     Pinky  → GPIO 9  (ADC1_CH8)
//
//   FSR sensors (Interlink 402):
//     Thumb  → GPIO 2  (ADC1_CH1)
//     Index  → GPIO 4  (ADC1_CH3)
//     Middle → GPIO 6  (ADC1_CH5)
//     Ring   → GPIO 8  (ADC1_CH7)
//     Pinky  → GPIO 10 (ADC1_CH9)
//
//   LRA actuators (Vybronics VG0832013D, 235Hz):
//     Thumb  → GPIO 11 (LEDC channel 0)
//     Index  → GPIO 12 (LEDC channel 1)
//     Middle → GPIO 13 (LEDC channel 2)
//     Ring   → GPIO 14 (LEDC channel 3)
//     Pinky  → GPIO 15 (LEDC channel 4)
//     All LRA- to GND
//
// Wire format (M2):
//   {"type":"reading","ms":<millis>,"fingers":[
//     {"flex_deg":<0-90>,"fsr_pct":<0-100>,"lra_duty":<0-255>},
//     ...x5
//   ]}
//
// Pass when (m2-glove-bench-card.md sign-off):
//   Flat flex → flex_deg ≈ 0; 90° flex → flex_deg ≈ 90 (all fingers)
//   No press → fsr_pct = 0, lra_duty = 0; firm press → fsr_pct > 50 (all fingers)
//   Each LRA buzzes only when its corresponding FSR is pressed
//   JSON valid on every line
//
// Calibration constants require bench verification per finger.
//
// — Recorded by 愛 / Gamma at Yu's WILL. 2026-06-11.

#include <Arduino.h>

// ── five-finger pin mapping ──────────────────────────────────────────
constexpr int NUM_FINGERS = 5;

constexpr int FLEX_PINS[NUM_FINGERS] = { 1, 3, 5, 7, 9 };  // ADC1_CH0,2,4,6,8
constexpr int FSR_PINS[NUM_FINGERS]  = { 2, 4, 6, 8, 10 }; // ADC1_CH1,3,5,7,9
constexpr int LRA_PINS[NUM_FINGERS]  = { 11, 12, 13, 14, 15 };

const char* FINGER_NAMES[NUM_FINGERS] = { "Thumb", "Index", "Middle", "Ring", "Pinky" };

// ── flex calibration (per finger) ────────────────────────────────────
// Verify these on the bench; values are for Spectra Symbol 55mm with
// 10kΩ pulldown and 3V3 rail. Flat = sensor straight, 90 = fully curled.
// Start with uniform values; tune per finger if needed.
constexpr int ADC_FLEX_FLAT[NUM_FINGERS] = { 1200, 1200, 1200, 1200, 1200 };
constexpr int ADC_FLEX_90[NUM_FINGERS]   = { 350, 350, 350, 350, 350 };

// ── FSR calibration (per finger) ─────────────────────────────────────
constexpr int FSR_MAX_ADC[NUM_FINGERS] = { 3500, 3500, 3500, 3500, 3500 };

// ── LRA ──────────────────────────────────────────────────────────────
constexpr uint32_t LRA_FREQ_HZ  = 235;   // VG0832013D resonant frequency
constexpr int      LRA_RES_BITS = 8;     // duty 0..255

// ── sampling ─────────────────────────────────────────────────────────
constexpr int ADC_MAX         = 4095;
constexpr int SAMPLES         = 8;
constexpr int SAMPLE_DELAY_MS = 1;
constexpr int REPORT_MS       = 200;

// ── ADC helper ───────────────────────────────────────────────────────
// ESP32-S3 ADC quirk: alternate-pin prime before each real read.
// M2: use GPIO 0 as prime throwaway (ADC1_CH0 alternately; safe if unused).
static int primedAnalogRead(int pin) {
  static int primePin = 0;
  (void)analogRead(primePin);
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

// ── LRA control ──────────────────────────────────────────────────────
static void lraWrite(int fingerIdx, uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(LRA_PINS[fingerIdx], duty);
#else
  ledcWrite(fingerIdx, duty);
#endif
}

// ── finger state ─────────────────────────────────────────────────────
struct FingerReading {
  int flexDeg;
  int fsrPct;
  uint8_t lraDuty;
};

void setup() {
  Serial.begin(115200);
  delay(2000);

  analogReadResolution(12);

  // Initialize 5 LEDC channels for 5 LRAs
  for (int i = 0; i < NUM_FINGERS; i++) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(LRA_PINS[i], LRA_FREQ_HZ, LRA_RES_BITS);
#else
    ledcSetup(i, LRA_FREQ_HZ, LRA_RES_BITS);
    ledcAttachPin(LRA_PINS[i], i);
#endif
    lraWrite(i, 0);
  }

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA M2 — five-finger haptic glove");
  Serial.println("  ESP32-S3-DEVKITC-1 @ 115200");
  Serial.println("  5x Flex:  GPIO 1,3,5,7,9   (ADC1, 10k div)");
  Serial.println("  5x FSR:   GPIO 2,4,6,8,10  (ADC1, 10k div)");
  Serial.println("  5x LRA:   GPIO 11-15, 235 Hz LEDC");
  Serial.println("  Out:      JSON 200ms  {fingers:[...x5]}");
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

  FingerReading readings[NUM_FINGERS];

  for (int i = 0; i < NUM_FINGERS; i++) {
    // Flex → degrees 0..90, clamped
    float flexAdc = readAdcAvg(FLEX_PINS[i]);
    int range = ADC_FLEX_FLAT[i] - ADC_FLEX_90[i];
    int flexDeg = 0;
    if (range > 0) {
      float t = ((float)ADC_FLEX_FLAT[i] - flexAdc) / (float)range;
      flexDeg = (int)(t * 90.0f + 0.5f);
      if (flexDeg < 0)  flexDeg = 0;
      if (flexDeg > 90) flexDeg = 90;
    }

    // FSR → percent 0..100
    float fsrAdc = readAdcAvg(FSR_PINS[i]);
    int fsrPct = (int)(fsrAdc * 100.0f / (float)FSR_MAX_ADC[i] + 0.5f);
    if (fsrPct < 0)   fsrPct = 0;
    if (fsrPct > 100) fsrPct = 100;

    // LRA duty tracks FSR linearly
    uint8_t lraDuty = (uint8_t)(fsrPct * 255 / 100);
    lraWrite(i, lraDuty);

    readings[i] = { flexDeg, fsrPct, lraDuty };
  }

  // JSON output
  Serial.print("{\"type\":\"reading\",\"ms\":");
  Serial.print(now);
  Serial.print(",\"fingers\":[");
  for (int i = 0; i < NUM_FINGERS; i++) {
    if (i > 0) Serial.print(",");
    Serial.print("{\"flex_deg\":");
    Serial.print(readings[i].flexDeg);
    Serial.print(",\"fsr_pct\":");
    Serial.print(readings[i].fsrPct);
    Serial.print(",\"lra_duty\":");
    Serial.print(readings[i].lraDuty);
    Serial.print("}");
  }
  Serial.println("]}");
}
