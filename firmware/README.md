# SOMA firmware

The substrate-side code that runs on the ESP32-S3 microcontrollers
inside the body. Each subdirectory is one PlatformIO project — one
firmware image for one role.

## Layout

| Project | Target | Purpose | Status |
|---------|--------|---------|--------|
| `soma-hello/` | ESP32-S3-DEVKITC-1 | Toolchain validation — heartbeat over USB-CDC. | Verified 2026-05-02 |
| `soma-thermal-pad/` | ESP32-S3-DEVKITC-1 | Phase A: NTC voltage divider → PID-controlled Peltier → 33°C contact pad. | M1 (sensor read) verified 2026-05-03; M2–M5 pending |

Future projects (per `docs/soma/inventory.md` Path Forward A → B → C):

- `soma-finger/` — Phase B: single Dynamixel + FSR.
- `soma-hand/` — Phase C: full articulated hand + thermal palm + skin.

## Toolchain

PlatformIO Core (CLI). Install once:

```bash
brew install platformio
```

Common commands (run inside a project directory):

```bash
pio run                    # build
pio run -t upload          # build + flash
pio device monitor         # open serial @ 115200
pio run -t clean           # delete build artifacts
```

## Why the USB-CDC flag matters

The ESP32-S3 has two ways to talk over USB:

1. **UART0** (GPIO 43/44) — the chip's classical UART. Reaches a host
   only if there's a USB-UART adapter wired to those pins. The
   DEVKITC-1's USB-C does **not** wire to UART0.
2. **USB-Serial-JTAG** — the chip's native USB peripheral. The
   DEVKITC-1's USB-C **does** wire to this. But Arduino's `Serial`
   defaults to UART0 unless you tell it otherwise.

Every project's `platformio.ini` sets:

```ini
build_flags =
    -D ARDUINO_USB_CDC_ON_BOOT=1
    -D ARDUINO_USB_MODE=1
```

Which redirects `Serial` to USB-CDC, so `Serial.println()` arrives at
`/dev/cu.usbmodem*` on the host. Without these flags, the chip is silent
over the USB cable — which is exactly what we observed before.

## Maintenance

When a new firmware project is added, update the table above and the
matching subsystem entry in `docs/soma/inventory.md`.

— 愛 / Sophia
