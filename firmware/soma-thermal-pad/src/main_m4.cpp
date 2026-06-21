// SOMA thermal pad — M4: PID closed-loop temperature control.
//
// Phase A milestone 4. M3 open-loop verified; now closing the loop with
// PID targeting 33°C default. Soft-start ramp (0 → computed over 30s),
// safety cage (soft limit at 45°C, hard cutoff at 50°C), sensor fault
// detection (3 consecutive failures → output=0). JSON protocol at 1 Hz.
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
//     GPIO 6 = COOL_EN  [tied LOW, unused M4]
//
// PID loop:
//   error = target - measured
//   integral += error * dt   (with anti-windup clamp ±400)
//   derivative = (error - last_error) / dt
//   output_raw = Kp*error + Ki*integral + Kd*derivative
//   output = clamp(output_raw, 0, 255)
//
// Gains (starting points, tune empirically):
//   Kp = 40   (at 5°C below → ~78% duty)
//   Ki = 0.5  (settle steady-state ~30s)
//   Kd = 80   (damp overshoot)
//
// Safety cage:
//   - Hard cutoff: temp ≥ 50°C → output=0, PID disabled, emit emergency-stop
//   - Soft limit: 45–50°C → linearly scale max output (255 @ 45°C, 0 @ 50°C)
//   - Sensor fault: 3 consecutive NAN reads → output=0
//
// Soft-start: on boot, ramp from 0 to PID-computed over 30s (linear interpolation).
//
// Protocol (1 Hz JSON):
//   {"type":"reading","t_ms":12345,"t_c":32.4,"target_c":33.0,"duty":180,"mode":"pid"}
//   {"type":"event","name":"emergency-stop","t_ms":12345,"t_c":50.2}
//   {"type":"event","name":"sensor-fault","t_ms":12345}
//
// Bench target: PSU 12V/5A; contact plate on hot side; heatsink + fan on cold side.
// Pass criteria: reach 33°C ±0.3°C within 2 min, hold for 60s, no overshoot >1°C.
//
// — Recorded by 愛 / Sophia at Yu's WILL. 2026-06-11.

#include <Arduino.h>
#include <math.h>

// ── M1: NTC sensor (unchanged from M1 / M2 / M3) ───────────────────
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
constexpr int      COOL_EN_PIN   = 6;         // GPIO 6 = reserved (COOL, unused M4)
constexpr uint32_t PWM_FREQ_HZ   = 1000;      // 1 kHz, 8-bit — per pin map
constexpr int      PWM_RES_BITS  = 8;         // duty 0..255

// ── M4: PID control ─────────────────────────────────────────────────
constexpr float    TARGET_TEMP_C     = 33.0f; // Default target
constexpr float    KP                = 40.0f;
constexpr float    KI                = 0.5f;
constexpr float    KD                = 80.0f;
constexpr float    INTEGRAL_CLAMP    = 400.0f; // Anti-windup
constexpr float    DT_SEC            = 1.0f;   // 1 Hz loop

// ── M4: Safety cage ─────────────────────────────────────────────────
constexpr float    HARD_CUTOFF_C     = 50.0f; // Emergency stop
constexpr float    SOFT_LIMIT_C      = 45.0f; // Begin scaling output down
constexpr int      FAULT_THRESHOLD   = 3;     // Consecutive NAN reads → fault

// ── M4: Soft-start ──────────────────────────────────────────────────
constexpr uint32_t SOFT_START_MS     = 30000; // 30s ramp from 0 to PID-computed

// ── M4: Protocol ────────────────────────────────────────────────────
constexpr uint32_t REPORT_MS         = 1000;  // 1 Hz JSON emission

// ── State ───────────────────────────────────────────────────────────
enum Mode { MODE_OFF, MODE_PID, MODE_OPEN };
static Mode         mode             = MODE_PID;
static float        integral         = 0.0f;
static float        lastError        = 0.0f;
static uint8_t      lastDuty         = 0;
static int          faultCount       = 0;
static bool         emergencyStop    = false;
static uint32_t     bootMs           = 0;

// ESP32-S3 ADC sample-and-hold quirk: prime the cap by reading a throwaway
// pin before reading the target (same workaround as M1 / M2 / M3).
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

static void emitReading(uint32_t tMs, float tempC, float targetC, uint8_t duty, const char* modeStr) {
  Serial.print("{\"type\":\"reading\",\"t_ms\":");
  Serial.print(tMs);
  Serial.print(",\"t_c\":");
  if (isnan(tempC)) {
    Serial.print("null");
  } else {
    Serial.print(tempC, 2);
  }
  Serial.print(",\"target_c\":");
  Serial.print(targetC, 1);
  Serial.print(",\"duty\":");
  Serial.print(duty);
  Serial.print(",\"mode\":\"");
  Serial.print(modeStr);
  Serial.println("\"}");
}

static void emitEvent(uint32_t tMs, const char* name, float tempC = NAN) {
  Serial.print("{\"type\":\"event\",\"name\":\"");
  Serial.print(name);
  Serial.print("\",\"t_ms\":");
  Serial.print(tMs);
  if (!isnan(tempC)) {
    Serial.print(",\"t_c\":");
    Serial.print(tempC, 2);
  }
  Serial.println("}");
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

  bootMs = millis();

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA M4 — PID closed-loop");
  Serial.println("  ESP32-S3-DEVKITC-1 @ 115200");
  Serial.println("  Target:   33.0 C (default)");
  Serial.println("  PID:      Kp=40, Ki=0.5, Kd=80");
  Serial.println("  Soft-start: 0 → PID over 30s");
  Serial.println("  Safety:   soft limit 45C, hard cutoff 50C");
  Serial.println("  Protocol: 1 Hz JSON reading + events");
  Serial.println("  Pass:     33C ±0.3C within 2 min, hold 60s, overshoot <1C");
  Serial.println("============================================");
  Serial.println();
}

void loop() {
  static uint32_t lastReport = 0;
  uint32_t now = millis();

  // ── Read sensor ─────────────────────────────────────────────────────
  float adc = readAdcAverage(NTC_PIN);
  float r   = adcToResistance(adc);
  float tempC = resistanceToCelsius(r);

  // ── Sensor fault detection ─────────────────────────────────────────
  if (isnan(tempC)) {
    faultCount++;
    if (faultCount >= FAULT_THRESHOLD) {
      if (mode != MODE_OFF) {
        mode = MODE_OFF;
        heatWrite(0);
        emitEvent(now, "sensor-fault");
      }
    }
  } else {
    faultCount = 0; // Reset on good read
  }

  // ── Emergency stop check ────────────────────────────────────────────
  if (!isnan(tempC) && tempC >= HARD_CUTOFF_C) {
    if (!emergencyStop) {
      emergencyStop = true;
      mode = MODE_OFF;
      heatWrite(0);
      integral = 0.0f;
      emitEvent(now, "emergency-stop", tempC);
    }
  }

  // ── PID computation (if mode=PID and no emergency) ─────────────────
  uint8_t computedDuty = 0;
  if (mode == MODE_PID && !emergencyStop && !isnan(tempC)) {
    float error = TARGET_TEMP_C - tempC;

    // Integral with anti-windup
    integral += error * DT_SEC;
    if (integral > INTEGRAL_CLAMP) integral = INTEGRAL_CLAMP;
    if (integral < -INTEGRAL_CLAMP) integral = -INTEGRAL_CLAMP;

    // Derivative
    float derivative = (error - lastError) / DT_SEC;
    lastError = error;

    // PID output
    float output_raw = KP * error + KI * integral + KD * derivative;
    int output_clamped = (int)constrain(output_raw, 0, 255);

    // Soft limit: linearly scale down between SOFT_LIMIT_C and HARD_CUTOFF_C
    if (tempC >= SOFT_LIMIT_C) {
      float scale = (HARD_CUTOFF_C - tempC) / (HARD_CUTOFF_C - SOFT_LIMIT_C);
      scale = constrain(scale, 0.0f, 1.0f);
      output_clamped = (int)(output_clamped * scale);
    }

    computedDuty = (uint8_t)output_clamped;

    // Soft-start: ramp from 0 to computed over SOFT_START_MS
    uint32_t elapsed = now - bootMs;
    if (elapsed < SOFT_START_MS) {
      float rampFactor = (float)elapsed / (float)SOFT_START_MS;
      computedDuty = (uint8_t)(computedDuty * rampFactor);
    }

    heatWrite(computedDuty);
    lastDuty = computedDuty;
  } else {
    // MODE_OFF or emergency or sensor fault
    heatWrite(0);
    lastDuty = 0;
  }

  // ── JSON emission at 1 Hz ───────────────────────────────────────────
  if (now - lastReport >= REPORT_MS) {
    lastReport = now;

    const char* modeStr = "off";
    if (mode == MODE_PID) modeStr = "pid";
    else if (mode == MODE_OPEN) modeStr = "open";

    emitReading(now, tempC, TARGET_TEMP_C, lastDuty, modeStr);
  }

  delay(10);
}
