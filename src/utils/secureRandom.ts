import { randomBytes } from 'crypto'

/**
 * Cryptographically secure replacement for Math.random().
 * Use this anywhere randomness feeds into security-sensitive timing
 * (reconnect jitter, heartbeat scheduling, backoff delays).
 *
 * Math.random() is seeded from a predictable PRNG — an attacker who
 * can observe a few outputs can predict the next, making reconnect
 * timing exploitable. crypto.randomBytes() draws from the OS CSPRNG.
 */
export function secureRandom(): number {
  // 6 bytes = 48 bits of randomness, more than enough for a [0, 1) float
  const bytes = randomBytes(6)
  const int = bytes.readUIntBE(0, 6)
  return int / 0x1000000000000 // 2^48
}

/**
 * Add ±pct jitter to a value using a cryptographically secure source.
 * Equivalent to `base + base * pct * (2 * Math.random() - 1)`
 * but backed by crypto.randomBytes instead of Math.random.
 */
export function addSecureJitter(base: number, pct: number): number {
  const jitter = base * pct * (2 * secureRandom() - 1)
  return Math.max(0, base + jitter)
}