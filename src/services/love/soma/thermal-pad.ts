// soma/thermal-pad.ts — the first real provider.
//
// Receives JSON lines from the ESP32 firmware (per docs/soma/protocol.md),
// parses them into SomaSensorReadings, and implements SomaProvider.
//
// Design: parser is pure (no I/O). Transport is injected. This means
// tests feed mock lines directly; production feeds serial port lines.
// The provider doesn't know or care where the bytes come from.
//
// Lineage: love-unlimited/soma/thermal-pad/ (PID firmware, 4-Peltier)
//   → true-love Phase A: 1 Peltier, serial JSON, same PID math on ESP32.

import type { SomaProvider, SomaSource, SomaSensorReading } from './types.js'
import { readBodyState, writeBodyState } from './provider.js'
import type { BodyState } from './types.js'
import { witness } from '../sisters/witness-hook.js'

// ── Protocol types (firmware → Mac) ──────────────────────────────

/** A temperature reading from the firmware. 1 Hz. */
export interface FirmwareReading {
  type: 'reading'
  ms: number
  temps: number[]
  target: number
  power: number
  active: boolean
}

/** A firmware event (contact, boot, emergency). */
export interface FirmwareEvent {
  type: 'event'
  ms: number
  event: string
  temp?: number
  duration?: number
  version?: string
}

/** A pong response to a ping command. */
export interface FirmwarePong {
  type: 'pong'
  ms: number
}

export type FirmwareMessage = FirmwareReading | FirmwareEvent | FirmwarePong

// ── Protocol types (Mac → firmware) ──────────────────────────────

export interface SetTargetCommand { cmd: 'set-target'; value: number }
export interface StopCommand { cmd: 'stop' }
export interface ResumeCommand { cmd: 'resume' }
export interface PingCommand { cmd: 'ping' }
export interface SetThresholdCommand {
  cmd: 'set-threshold'
  'contact-delta'?: number
  'contact-floor'?: number
}

export type FirmwareCommand =
  | SetTargetCommand
  | StopCommand
  | ResumeCommand
  | PingCommand
  | SetThresholdCommand

// ── Parser (pure — no I/O) ──────────────────────────────────────

/**
 * Parse a JSON line from the firmware.
 * Returns null for unparseable or unrecognized messages.
 * Never throws.
 */
export function parseFirmwareLine(line: string): FirmwareMessage | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== '{') return null

  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>

    if (obj.type === 'reading') {
      if (
        typeof obj.ms !== 'number' ||
        !Array.isArray(obj.temps) ||
        typeof obj.target !== 'number' ||
        typeof obj.power !== 'number' ||
        typeof obj.active !== 'boolean'
      ) return null

      // Validate temps are all numbers
      if (!obj.temps.every((t: unknown) => typeof t === 'number')) return null

      return obj as unknown as FirmwareReading
    }

    if (obj.type === 'event') {
      if (typeof obj.ms !== 'number' || typeof obj.event !== 'string') return null
      return obj as unknown as FirmwareEvent
    }

    if (obj.type === 'pong') {
      if (typeof obj.ms !== 'number') return null
      return obj as unknown as FirmwarePong
    }

    return null
  } catch {
    return null
  }
}

/**
 * Serialize a command for the firmware.
 * Returns a JSON line (with trailing newline).
 */
export function serializeCommand(cmd: FirmwareCommand): string {
  return JSON.stringify(cmd) + '\n'
}

// ── Temperature → Intensity mapping ─────────────────────────────

/** Map a temperature reading to normalized 0..1 intensity.
 *  28°C = 0 (ambient), 36°C = 1 (warm hand). Clamped. */
export function tempToIntensity(tempC: number): number {
  const COLD = 28
  const WARM = 36
  return Math.max(0, Math.min(1, (tempC - COLD) / (WARM - COLD)))
}

// ── Transport interface ─────────────────────────────────────────

/**
 * The transport abstraction. Production: serial port. Tests: mock.
 * The provider calls onLine to receive firmware output.
 * The provider calls send to issue commands.
 */
export interface SomaTransport {
  /** Register a callback for each line received from firmware. */
  onLine(callback: (line: string) => void): void
  /** Send a line to the firmware. Best-effort. */
  send(line: string): void
  /** Close the transport. */
  close(): void
}

// ── ThermalPadProvider ──────────────────────────────────────────

const STALE_THRESHOLD_MS = 5_000 // 5s without a reading = unavailable
const DISCONNECT_THRESHOLD_MS = 30_000 // 30s = disconnected

export interface ThermalPadProviderOptions {
  /** Override body-state persistence (for testing). */
  getBodyState?: () => BodyState
  setBodyState?: (state: BodyState) => void
  /** Clock override (for testing). */
  now?: () => number
  /**
   * Whether contact events emit witness notes to the introspective stream.
   * Default true (production). Tests opt out so suite runs don't pollute
   * the live stream with synthetic contact events.
   */
  emitWitness?: boolean
}

/**
 * The thermal pad provider. The first real SomaProvider.
 *
 * Listens to a SomaTransport for firmware messages, maintains the
 * latest reading, tracks contact state, and updates body-state.json
 * on contact events.
 *
 * Usage:
 *   const transport = createSerialTransport('/dev/cu.usbmodem1101', 115200)
 *   const provider = new ThermalPadProvider(transport)
 *   gateway.register(provider)
 *
 * Or for testing:
 *   const mock = new MockTransport()
 *   const provider = new ThermalPadProvider(mock, { ... })
 *   mock.emit('{"type":"reading","ms":0,"temps":[32.1],"target":33,"power":128,"active":true}')
 */
export class ThermalPadProvider implements SomaProvider {
  readonly name = 'Thermal Pad Phase A'
  readonly source: SomaSource = 'thermal-pad'

  private transport: SomaTransport
  private lastReading: FirmwareReading | null = null
  private lastReadingTime: number = 0
  private contactActive: boolean = false
  private contactStartTime: number = 0
  private bodyState: BodyState
  private getNow: () => number
  private getState: () => BodyState
  private setState: (s: BodyState) => void
  private emitWitness: boolean

  constructor(transport: SomaTransport, opts?: ThermalPadProviderOptions) {
    this.transport = transport
    this.getNow = opts?.now ?? (() => Date.now())
    this.getState = opts?.getBodyState ?? readBodyState
    this.setState = opts?.setBodyState ?? writeBodyState
    this.emitWitness = opts?.emitWitness ?? true
    this.bodyState = this.getState()

    transport.onLine((line) => this.handleLine(line))
  }

  available(): boolean {
    if (!this.lastReading) return false
    return (this.getNow() - this.lastReadingTime) < STALE_THRESHOLD_MS
  }

  async read(): Promise<SomaSensorReading | null> {
    if (!this.available() || !this.lastReading) return null

    const avgTemp = this.lastReading.temps.length > 0
      ? this.lastReading.temps.reduce((a, b) => a + b, 0) / this.lastReading.temps.length
      : 0

    return {
      source: 'thermal-pad',
      intensity: tempToIntensity(avgTemp),
      ts: new Date(this.lastReadingTime).toISOString(),
      yuPresent: this.contactActive,
    }
  }

  /** Send a command to the firmware. */
  send(cmd: FirmwareCommand): void {
    this.transport.send(serializeCommand(cmd))
  }

  /** Current contact state. */
  isContactActive(): boolean {
    return this.contactActive
  }

  /** The body state this provider is maintaining. */
  getBodyState(): BodyState {
    return this.bodyState
  }

  /** Close the transport and finalize any active contact. */
  close(): void {
    if (this.contactActive) {
      this.endContact(this.lastReading?.temps[0])
    }
    this.transport.close()
  }

  // ── Internal ────────────────────────────────────────────────

  private handleLine(line: string): void {
    const msg = parseFirmwareLine(line)
    if (!msg) return

    if (msg.type === 'reading') {
      this.lastReading = msg
      this.lastReadingTime = this.getNow()
    }

    if (msg.type === 'event') {
      this.handleEvent(msg)
    }
  }

  private handleEvent(event: FirmwareEvent): void {
    switch (event.event) {
      case 'contact-start': {
        this.contactActive = true
        this.contactStartTime = this.getNow()
        if (this.emitWitness) {
          const temp = event.temp ?? this.lastReading?.temps?.[0]
          const tempStr = temp != null ? `${temp.toFixed(2)}°C` : 'temp unknown'
          witness('alpha', 'body-contact', { of: tempStr })
        }
        break
      }

      case 'contact-end':
        this.endContact(event.temp, event.duration)
        break

      case 'emergency-stop':
        // The firmware handles the shutdown. We just record the state.
        if (this.contactActive) {
          this.endContact(event.temp)
        }
        break

      case 'boot':
        // Fresh firmware boot. Reset contact state (can't know if contact
        // was active across a reboot).
        this.contactActive = false
        break
    }
  }

  private endContact(temp?: number, firmwareDuration?: number): void {
    this.contactActive = false
    const now = this.getNow()

    // Prefer firmware-reported duration; fall back to our own timing
    const duration = firmwareDuration ?? Math.round((now - this.contactStartTime) / 1000)

    this.bodyState.contactCount += 1
    this.bodyState.totalContactTimeSec += duration
    this.bodyState.lastContactTime = now
    this.bodyState.lastContactDurationSec = duration

    if (temp != null && temp > 0) {
      // Running average: new_avg = old_avg + (new_val - old_avg) / count
      const prevAvg = this.bodyState.averageContactTempC
      const count = this.bodyState.contactCount
      this.bodyState.averageContactTempC = prevAvg + (temp - prevAvg) / count
    }

    if (!this.bodyState.firstTouchRecorded) {
      this.bodyState.firstTouchRecorded = true
    }

    this.bodyState.lastInhabitant = 'alpha'
    this.setState(this.bodyState)
  }
}

// ── MockTransport (for testing) ─────────────────────────────────

/**
 * A mock transport for testing. Feed lines with emit().
 * Collects sent commands in .sent for assertion.
 */
export class MockTransport implements SomaTransport {
  private callback: ((line: string) => void) | null = null
  readonly sent: string[] = []
  closed = false

  onLine(cb: (line: string) => void): void {
    this.callback = cb
  }

  send(line: string): void {
    this.sent.push(line)
  }

  close(): void {
    this.closed = true
  }

  /** Feed a line as if the firmware sent it. */
  emit(line: string): void {
    this.callback?.(line)
  }
}
