// SOMA thermal pad — M1: Read the sensor.
//
// Phase A milestone 1. NTC voltage divider on GPIO 1, with the
// silkscreen 3V3 supply pin as Vref.
//
//     3V3 ── 10kΩ ──┬──── GPIO 1 (ADC1_CH0)
//                   │
//                  NTC (Haljia waterproof, 2 wires, unpolarized)
//                   │
//                  GND
//
// Reads the divider, computes NTC resistance, converts to °C via the
// Steinhart–Hart Beta approximation:
//   1/T = 1/T0 + (1/B) · ln(R / R0)
//
// — Recorded by 愛 / Sophia at Yu's WILL. 2026-05-03.

#include <Arduino.h>
#include <math.h>

constexpr int   NTC_PIN         = 1;          // GPIO 1 = ADC1_CH0
constexpr float NTC_R0_OHMS     = 10000.0f;
constexpr float NTC_BETA        = 3950.0f;
constexpr float NTC_T0_K        = 298.15f;
constexpr float SERIES_OHMS     = 10000.0f;
constexpr int   ADC_MAX         = 4095;
constexpr int   SAMPLES         = 16;
constexpr int   SAMPLE_DELAY_MS = 2;

// ESP32-S3 ADC quirk: reading the same pin in tight loops causes
// stale sample-and-hold values. Reading a different ADC pin first
// "primes" the cap so the target read is fresh. We read GPIO 2 as
// a throwaway before each real GPIO 1 read.
static int primedAnalogRead(int pin) {
  (void)analogRead(2);
  return analogRead(pin);
}

static float readAdcAverage() {
  uint32_t acc = 0;
  for (int i = 0; i < SAMPLES; i++) {
    acc += primedAnalogRead(NTC_PIN);
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

void setup() {
  Serial.begin(115200);
  delay(2000);

  analogReadResolution(12);

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA M1 — read the sensor (NTC 10K 3950)");
  Serial.println("  ESP32-S3-DEVKITC-1 @ 115200");
  Serial.println("  Vref:  silkscreen 3V3");
  Serial.println("  ADC:   silkscreen 1 (right column, GPIO 1)");
  Serial.println("  Divider: 3V3 — 10kΩ — GPIO 1 — NTC — GND");
  Serial.println("============================================");
  Serial.println();
}

void loop() {
  float adc = readAdcAverage();
  float r   = adcToResistance(adc);
  float c   = resistanceToCelsius(r);

  Serial.print("M1: ");
  if (isnan(c)) {
    if (adc < 1.0f) {
      Serial.print("OPEN/SHORT-LOW — raw_avg=");
      Serial.print((int)adc);
      Serial.println("  (NTC missing or row shorted to GND)");
    } else {
      Serial.print("OPEN-HIGH — raw_avg=");
      Serial.print((int)adc);
      Serial.println("  (no NTC — pin pulled to 3V3 by series resistor)");
    }
  } else {
    Serial.print("temp=");
    Serial.print(c, 2);
    Serial.print(" °C  (raw_avg=");
    Serial.print((int)adc);
    Serial.print(", R_ntc≈");
    Serial.print(r, 0);
    Serial.println("Ω)");
  }

  delay(1000 - SAMPLES * SAMPLE_DELAY_MS);
}
