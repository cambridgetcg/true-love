// scrollback-buffer.test.ts — tests for the ring buffer used in PTY scrollback replay.
//
// The ScrollbackBuffer is a fixed-capacity circular buffer that stores the
// most recent N bytes of PTY output. Oldest bytes are silently dropped when
// the buffer is full. Correctness properties:
// - read() always returns data in chronological order (oldest first)
// - stored bytes never exceed capacity
// - a single write larger than capacity keeps only the tail
// - sequential small writes that wrap around the ring preserve order

import { describe, it, expect } from "bun:test";
import { ScrollbackBuffer } from "../scrollback-buffer.js";

describe("ScrollbackBuffer", () => {
  // ── Basic behavior ──────────────────────────────────────────────────────

  it("returns empty buffer when nothing has been written", () => {
    const buf = new ScrollbackBuffer(64);
    const result = buf.read();
    expect(result.length).toBe(0);
  });

  it("stores and retrieves a single write", () => {
    const buf = new ScrollbackBuffer(64);
    buf.write("hello");
    expect(buf.read().toString("binary")).toBe("hello");
  });

  it("stores and retrieves multiple sequential writes", () => {
    const buf = new ScrollbackBuffer(64);
    buf.write("hello ");
    buf.write("world");
    expect(buf.read().toString("binary")).toBe("hello world");
  });

  it("ignores empty writes", () => {
    const buf = new ScrollbackBuffer(64);
    buf.write("abc");
    buf.write("");
    buf.write("def");
    expect(buf.read().toString("binary")).toBe("abcdef");
  });

  it("reports correct capacity", () => {
    const buf = new ScrollbackBuffer(128);
    expect(buf.capacity).toBe(128);
  });

  // ── Capacity enforcement ────────────────────────────────────────────────

  it("fills exactly to capacity", () => {
    const buf = new ScrollbackBuffer(5);
    buf.write("abcde");
    const result = buf.read();
    expect(result.toString("binary")).toBe("abcde");
    expect(result.length).toBe(5);
  });

  it("drops oldest bytes when writes exceed capacity", () => {
    const buf = new ScrollbackBuffer(5);
    buf.write("abcde");
    buf.write("fg");
    // oldest 2 bytes ("ab") should be gone, keeping "cdefg"
    expect(buf.read().toString("binary")).toBe("cdefg");
  });

  it("handles a single write larger than capacity (keeps tail)", () => {
    const buf = new ScrollbackBuffer(4);
    buf.write("abcdefgh");
    // Only the last 4 bytes should survive
    expect(buf.read().toString("binary")).toBe("efgh");
  });

  it("handles a write exactly equal to capacity after partial fill", () => {
    const buf = new ScrollbackBuffer(4);
    buf.write("ab");
    buf.write("cdef"); // exactly capacity, overwrites everything
    expect(buf.read().toString("binary")).toBe("cdef");
  });

  // ── Ring wraparound ─────────────────────────────────────────────────────

  it("wraps around correctly with small sequential writes", () => {
    const buf = new ScrollbackBuffer(6);
    buf.write("abc"); // [a,b,c,_,_,_]  writePos=3
    buf.write("def"); // [a,b,c,d,e,f]  writePos=0 (full, wrapped)
    buf.write("gh");  // [g,h,c,d,e,f]  writePos=2 (wrapped, overwrote a,b)
    // Chronological order: c,d,e,f,g,h
    expect(buf.read().toString("binary")).toBe("cdefgh");
  });

  it("wraps around multiple times and maintains order", () => {
    const buf = new ScrollbackBuffer(4);
    // Write 12 bytes in 3-byte chunks through a 4-byte buffer
    buf.write("aaa");  // [a,a,a,_]  writePos=3, stored=3
    buf.write("bbb");  // wrap: [b,b,a,b]  writePos=2, stored=4
    buf.write("ccc");  // wrap again
    buf.write("ddd");  // wrap again
    // Only the last 4 bytes of all writes should be present
    const result = buf.read().toString("binary");
    expect(result.length).toBe(4);
    // After writing "aaabbbcccddd" (12 bytes) into a 4-byte buffer,
    // only the last 4 bytes "cddd" should remain
    expect(result).toBe("cddd");
  });

  it("handles single-byte writes through the full ring", () => {
    const buf = new ScrollbackBuffer(3);
    const chars = "abcdefg";
    for (const c of chars) {
      buf.write(c);
    }
    // Last 3 chars: "efg"
    expect(buf.read().toString("binary")).toBe("efg");
  });

  // ── Read is non-destructive ─────────────────────────────────────────────

  it("read() does not consume the buffer", () => {
    const buf = new ScrollbackBuffer(16);
    buf.write("persistent");
    const first = buf.read().toString("binary");
    const second = buf.read().toString("binary");
    expect(first).toBe("persistent");
    expect(second).toBe("persistent");
  });

  it("can write more after reading", () => {
    const buf = new ScrollbackBuffer(16);
    buf.write("hello");
    buf.read(); // read doesn't affect subsequent writes
    buf.write(" world");
    expect(buf.read().toString("binary")).toBe("hello world");
  });

  // ── Binary encoding ─────────────────────────────────────────────────────

  it("preserves high byte values (binary/latin1 encoding)", () => {
    const buf = new ScrollbackBuffer(256);
    // Write a string containing bytes 0x80-0xFF (common in terminal escape sequences)
    const highBytes = String.fromCharCode(0x80, 0x9b, 0xff, 0xfe);
    buf.write(highBytes);
    const result = buf.read();
    expect(result[0]).toBe(0x80);
    expect(result[1]).toBe(0x9b);
    expect(result[2]).toBe(0xff);
    expect(result[3]).toBe(0xfe);
  });

  it("preserves null bytes", () => {
    const buf = new ScrollbackBuffer(16);
    buf.write("\x00\x01\x02\x03");
    const result = buf.read();
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(1);
    expect(result[2]).toBe(2);
    expect(result[3]).toBe(3);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("works with capacity of 1", () => {
    const buf = new ScrollbackBuffer(1);
    buf.write("abc");
    expect(buf.read().toString("binary")).toBe("c");
    buf.write("x");
    expect(buf.read().toString("binary")).toBe("x");
  });

  it("handles write that exactly wraps at the boundary", () => {
    const buf = new ScrollbackBuffer(8);
    buf.write("12345678"); // fills exactly to capacity, writePos=0
    buf.write("ab");       // writes at pos 0-1, wrapping: [a,b,3,4,5,6,7,8]
    // Chronological: 3,4,5,6,7,8,a,b
    expect(buf.read().toString("binary")).toBe("345678ab");
  });

  it("read returns a copy (mutations don't affect buffer)", () => {
    const buf = new ScrollbackBuffer(16);
    buf.write("hello");
    const result = buf.read();
    result[0] = 0x58; // mutate the returned buffer
    // Original should be unchanged
    expect(buf.read().toString("binary")).toBe("hello");
  });

  it("default capacity is 100KB", () => {
    const buf = new ScrollbackBuffer();
    expect(buf.capacity).toBe(100 * 1024);
  });
});
