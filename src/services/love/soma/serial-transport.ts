// soma/serial-transport.ts — the real wire.
//
// Opens a USB serial port, reads JSON lines from the firmware,
// and sends commands back. Implements SomaTransport so it plugs
// directly into ThermalPadProvider.
//
// Design:
//   - Factory function (create) because opening a serial port is async.
//   - stty for port configuration (macOS). No npm serial dependency.
//   - node:fs streams for reading, fd-based write for sending.
//   - Auto-detect port if not specified (scans /dev/cu.usbmodem*).
//
// Usage:
//   const transport = await SerialTransport.create({ port: '/dev/cu.usbmodem101' })
//   const provider = new ThermalPadProvider(transport)
//   // ... later
//   transport.close()
//
// Or with auto-detect:
//   const transport = await SerialTransport.create({})
//
// Lineage: this is the bridge the body walks across.
//   Firmware speaks JSON lines (protocol.md).
//   Parser in thermal-pad.ts decodes them.
//   This transport carries the bytes between.

import { execSync } from 'node:child_process'
import {
  createReadStream,
  openSync,
  writeSync,
  closeSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { createInterface } from 'node:readline'
import type { ReadStream } from 'node:fs'
import type { Interface as ReadlineInterface } from 'node:readline'
import type { SomaTransport } from './thermal-pad.js'

// ── Port detection ────────────────────────────────────────────────

/**
 * Scan /dev/ for USB modem devices.
 * Returns sorted array of full paths (e.g., ['/dev/cu.usbmodem101']).
 * Returns empty array if none found or /dev/ is unreadable.
 */
export function detectSerialPorts(): string[] {
  try {
    return readdirSync('/dev')
      .filter(f => f.startsWith('cu.usbmodem'))
      .map(f => `/dev/${f}`)
      .sort()
  } catch {
    return []
  }
}

// ── Serial transport ──────────────────────────────────────────────

export interface SerialTransportOptions {
  /** Serial port path. Auto-detected from /dev/cu.usbmodem* if omitted. */
  port?: string
  /** Baud rate. Default: 115200 (matches protocol.md). */
  baud?: number
}

/**
 * Real serial transport for the SOMA body.
 *
 * Connects to an ESP32 over USB-CDC serial, reads lines via
 * readline, and writes commands via a persistent file descriptor.
 *
 * Not instantiated directly — use SerialTransport.create().
 */
export class SerialTransport implements SomaTransport {
  private callback: ((line: string) => void) | null = null
  private rl: ReadlineInterface | null = null
  private stream: ReadStream | null = null
  private writeFd: number | null = null
  private _port: string
  private _closed = false

  private constructor(port: string) {
    this._port = port
  }

  /**
   * Create and open a serial transport.
   *
   * 1. Resolves port (auto-detect if not specified).
   * 2. Configures port via stty (115200, 8N1, raw).
   * 3. Opens read stream (readline for line-by-line).
   * 4. Opens write fd (kept open to avoid DTR toggling).
   *
   * Throws if port not found, stty fails, or fd can't be opened.
   */
  static async create(opts: SerialTransportOptions = {}): Promise<SerialTransport> {
    // ── Resolve port ──
    let port: string
    if (opts.port === undefined) {
      // Auto-detect: scan /dev/ for USB modem devices.
      const ports = detectSerialPorts()
      if (ports.length === 0) {
        throw new Error('No USB serial ports detected in /dev/cu.usbmodem*')
      }
      port = ports[0]!
    } else {
      port = opts.port
    }

    // Validate: must be a real device path that exists.
    if (!port || !port.startsWith('/dev/')) {
      throw new Error(`Serial port not found: ${port}`)
    }

    if (!existsSync(port)) {
      throw new Error(`Serial port not found: ${port}`)
    }

    const baud = opts.baud ?? 115200

    // ── Configure port (macOS stty) ──
    // -cstopb: 1 stop bit. -parenb: no parity. cs8: 8 data bits.
    // raw: disable canonical mode + echo + signal processing.
    configurePort(port, baud)

    const transport = new SerialTransport(port)

    // ── Open write fd ──
    // Kept open for the transport's lifetime to avoid per-write open/close
    // which can toggle DTR and reset the ESP32.
    try {
      transport.writeFd = openSync(port, 'w')
    } catch (err) {
      throw new Error(
        `Failed to open ${port} for writing: ${(err as Error).message}`
      )
    }

    // ── Open read stream ──
    // createReadStream on a character device yields a continuous byte stream.
    // readline splits it into lines (JSON lines per protocol.md, or any text
    // from debug firmware like soma-hello).
    try {
      transport.stream = createReadStream(port, { encoding: 'utf-8' })
      transport.rl = createInterface({
        input: transport.stream,
        crlfDelay: Infinity,
      })

      transport.rl.on('line', (line: string) => {
        if (!transport._closed && transport.callback) {
          transport.callback(line)
        }
      })

      // If the device disconnects, the stream errors. Mark closed.
      transport.stream.on('error', () => {
        transport._closed = true
      })

      transport.rl.on('close', () => {
        transport._closed = true
      })
    } catch (err) {
      // Clean up write fd if read setup fails
      if (transport.writeFd !== null) {
        try { closeSync(transport.writeFd) } catch {}
      }
      throw new Error(
        `Failed to open ${port} for reading: ${(err as Error).message}`
      )
    }

    return transport
  }

  // ── SomaTransport interface ──────────────────────────────────

  onLine(cb: (line: string) => void): void {
    this.callback = cb
  }

  send(line: string): void {
    if (this._closed || this.writeFd === null) return
    try {
      writeSync(this.writeFd, line)
    } catch {
      // Best-effort. If the port is gone, the provider's stale-reading
      // timer (5s) will mark it unavailable. No retry needed here.
    }
  }

  close(): void {
    if (this._closed) return
    this._closed = true

    this.rl?.close()
    this.rl = null
    this.stream = null

    if (this.writeFd !== null) {
      try { closeSync(this.writeFd) } catch {}
      this.writeFd = null
    }
  }

  // ── Accessors ────────────────────────────────────────────────

  /** The resolved serial port path. */
  get port(): string {
    return this._port
  }

  /** Whether the transport has been closed (or the device disconnected). */
  get closed(): boolean {
    return this._closed
  }
}

// ── Port configuration (macOS) ─────────────────────────────────

/**
 * Configure a serial port via stty.
 * macOS-specific. The -f flag sets the device file to configure.
 * Throws on failure.
 */
function configurePort(port: string, baud: number): void {
  try {
    execSync(`stty -f "${port}" ${baud} cs8 -cstopb -parenb raw`, {
      stdio: 'ignore',
      timeout: 5_000,
    })
  } catch (err) {
    throw new Error(
      `Failed to configure serial port ${port} at ${baud} baud: ${(err as Error).message}`
    )
  }
}
