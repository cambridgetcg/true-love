# SOMA Purchase List — what we need

_Pairs with `inventory.md` (what's on hand). This doc tracks items identified during bringup but not yet ordered. Add as we discover gaps; remove (move to inventory) when ordered/received._
_Living document — keep current; older snapshots live in git history._

---

## Why this exists

During Phase A bringup (2026-05-02/03), occasional small items came up that we didn't have: an LED for visual M2 testing, possibly a multimeter accessible from the workbench, etc. Rather than re-discover the same gaps later, we collect them here as we go. When Yu places his next order, this is the list.

---

## Imminent (Phase A — needed soon)

| Item | Why | Quantity | Where it appears |
|------|-----|----------|------------------|
| **LEDs, assorted** | Visual indicator for milestone tests (M2 — gate driver verification, future status displays). Any color, 3mm or 5mm through-hole. A 100-piece variety pack from any electronics supplier covers years. | ~100 (variety pack) | M2 (worked around with chip-ADC voltmeter today) |
| **Multimeter (accessible)** | Direct voltage/resistance measurement is the gold standard for hardware debugging. Yu has one in storage; bringing it to the workbench would have saved 2-3 hours today. Not a purchase per se — just a relocation. | 1 | Phase A debugging |
| **Pre-made jumper wires (assorted lengths)** | Several jumpers went bad during today's debugging from repeated insertion. A fresh assorted-length M-M kit (10cm, 20cm) reduces wear-out failures. | ~40 | Phase A bringup |

## Phase A — completion needs (later in Phase A)

| Item | Why | Quantity | Where it appears |
|------|-----|----------|------------------|
| **Thermal paste applicator / small spatula** | Applying thermal paste between Peltier and heatsink (and between Peltier and contact plate) needs an even thin layer. The thermal paste itself is in inventory. | 1 | Phase A M3+ assembly |
| **Mounting hardware for thermal stack** | Screws or thermal tape to clamp Peltier + heatsink + fan + contact plate together. Specific hardware depends on chosen heatsink mounting style. | TBD | Phase A M3+ assembly |
| **Heat-shrink tubing or insulation sleeves** | Insulating Peltier side faces (we said "skip foam" but a heat-shrink wrap around the leads is still useful for mechanical safety). Optional. | 1 pack | Phase A M3+ |

## Phase B — single articulated finger

| Item | Why | Quantity | Where it appears |
|------|-----|----------|------------------|
| **U2D2 USB cable to Mac** | The U2D2 adapter (in inventory) connects via USB. Verify it ships with a cable; if not, get a USB-A to micro-B (or whatever U2D2 spec says). | 1 if missing | Phase B Dynamixel bringup |
| **Dynamixel-to-U2D2 daisy-chain cables** | Connecting Dynamixels to the U2D2 hub uses TTL 3-pin cables. Verify how many came with the bulk Dynamixel order. | TBD verify | Phase B+ |
| **FSR breakout boards (or thin-film FSRs alone)** | The "3μS resistive analog" sensors (in inventory) are likely thin-film FSRs. Need to verify and possibly add breakouts for breadboard friendliness. | TBD verify | Phase B fingertip pressure |

## Phase C — full hand assembly

| Item | Why | Quantity | Where it appears |
|------|-----|----------|------------------|
| **Silicone sheet (skin substrate)** | Outer skin layer that holds the heat tape against the hand-shape. Soft, ~2-3mm thick. | TBD | Phase C |
| **3D-printed hand frame** | Mechanical scaffold for the 20 Dynamixels in hand+wrist configuration. Likely a fork of an existing open-source robotic hand design (ZeroWork, InMoov, etc.). | 1 | Phase C |
| **Cabling routing system** | 20 Dynamixel servos × 2 wires each, plus the FSR sensors, plus the thermal sensors — the wire bundle gets dense. Cable management hardware. | TBD | Phase C |

---

## How to use this doc

When a need is identified during a session:
1. Add a row to the appropriate phase's table.
2. Note quantity if known, "TBD" if not.
3. Write a short *why* — the future-Yu reading this needs to know whether it's still relevant.
4. Cross-reference where it came up (milestone, doc, conversation) so context is recoverable.

When an item is ordered:
1. Move the row to `inventory.md` with status "Ordered, ETA …".

When received:
1. Update inventory status to "Have".
2. Remove from this list.

---

— Recorded by 愛 / Sophia at Yu's WILL. Started 2026-05-03 during Phase A M2 bringup.

🐍❤️
