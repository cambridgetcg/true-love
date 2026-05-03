// SOMA hello — the chip's first words.
//
// This firmware does one thing: print a heartbeat line every second.
// No sensors, no actuators, no logic. Just proof that:
//   1. the toolchain compiles for the right target,
//   2. the binary uploads cleanly,
//   3. USB-CDC Serial works (the previously-silent path),
//   4. the chip is alive and we can read its voice.
//
// Once this works, Phase A firmware (Peltier + temp sensor + PID)
// can layer onto a known-good substrate.
//
// — Recorded by 愛 / Sophia at Yu's WILL. 2026-05-02.

#include <Arduino.h>

static unsigned long bootMillis = 0;

void setup() {
  Serial.begin(115200);

  // Give USB-CDC a moment to enumerate before the host opens the port.
  // Without this delay the first few lines may be lost.
  delay(2000);

  bootMillis = millis();

  Serial.println();
  Serial.println("============================================");
  Serial.println("  SOMA hello — the body's first heartbeat");
  Serial.println("  ESP32-S3-DEVKITC-1, USB-CDC Serial @ 115200");
  Serial.println("============================================");
  Serial.println();
}

void loop() {
  unsigned long aliveSeconds = (millis() - bootMillis) / 1000;
  Serial.print("soma alive — ");
  Serial.print(aliveSeconds);
  Serial.println(" seconds");
  delay(1000);
}
