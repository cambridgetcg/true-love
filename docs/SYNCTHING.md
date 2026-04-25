# Syncthing setup — cross-device sync without a broker

Path A of `true-love`'s cross-device design: peer-to-peer file sync via
[Syncthing](https://syncthing.net). No central server. No third-party
cloud. Each device's `~/.true-love/` directory becomes a shared folder;
Syncthing carries state, memory, presence heartbeats, and notifications
between devices in seconds.

## What gets synced

```
~/.true-love/
├── state.md                              SYNCED — the one shared state
├── memory/<deviceId>/YYYY-MM-DD.md       SYNCED — episodic memory
├── notifications/<deviceId>/YYYY-MM-DD.md  SYNCED — cross-device pings
└── presence/<deviceId>.json              SYNCED — heartbeats
```

Each device only writes into *its own* `<deviceId>` subdirectory under
`memory/`, `notifications/`, and `presence/`. Concurrent writes to the
same file therefore never happen — Syncthing's "two devices edited the
same file at the same time → conflict file" problem can't bite us
except on `state.md`, which IS shared. State conflicts are rare (you're
usually only on one device at a time); when they happen, Syncthing
creates `state.sync-conflict-<timestamp>-<device>.md` for you to merge.

## What does NOT get synced

The `.stignore` file at `~/.true-love/.stignore` excludes:

- `device.id` — each machine has its own
- `*.tmp` — atomic-write transients
- `*.sync-conflict-*` — let conflict files stay where they were created

## Setup

### 1. Install Syncthing on each device

```sh
# macOS
brew install syncthing

# Linux (most distros)
sudo apt install syncthing
# or
sudo pacman -S syncthing
# or
sudo dnf install syncthing

# iOS / iPadOS
# App Store: "Möbius Sync" (third-party Syncthing client)

# Android
# F-Droid or Play Store: "Syncthing"
```

Then start it as a per-user service:

```sh
# macOS
brew services start syncthing

# Linux (systemd user)
systemctl --user enable --now syncthing
```

### 2. Open the Syncthing web UI

`http://localhost:8384` on each device. Note each device's **Device ID**
(under Actions → Show ID).

### 3. Add devices to each other

On device A's UI: Add Remote Device → paste device B's ID → name it.
Repeat from B → A. Devices accept each other; they're now linked.

### 4. Add `~/.true-love/` as a shared folder

On device A:

- Add Folder
- Folder Path: `~/.true-love`
- Folder ID: `true-love` (must match across devices)
- Sharing tab: select your other devices
- Advanced: enable "Watch for Changes" (uses fsnotify; faster than polling)

On device B (and any other peer): Syncthing will pop up a notification
"Device A wants to share folder `true-love` with you." Accept → set the
folder path to `~/.true-love` on this device too.

### 5. Install the `.stignore`

On every device:

```sh
cp docs/syncthing/stignore.template ~/.true-love/.stignore
```

Syncthing picks it up on the next rescan (default: 10s).

### 6. Verify

```sh
# On device A — write a test reflection
bun run heartbeat -- --once
# Wait ~10s, then on device B:
ls ~/.true-love/presence/
# You should see a file named after device A's id.
```

## Observability

- Web UI shows sync status per folder (in sync / scanning / syncing).
- Logs at `~/Library/Application Support/Syncthing/syncthing.log` (mac)
  or `~/.local/state/syncthing/syncthing.log` (linux).
- `~/.true-love/.stversions/` (if you enable file-versioning) keeps
  recent older copies for "I just wanted that earlier state back."

## Tradeoffs vs the broker (Path B)

| | Syncthing (Path A) | Broker (Path B) |
|---|---|---|
| third-party trust | Syncthing discovery (replaceable; can be self-hosted) | a server you host |
| recurring cost | $0 forever | $0–€4/month |
| sync latency | ~3–10s | <1s |
| presence updates | ~10s heartbeat cadence | sub-second pub/sub |
| recovery from outage | n/a (no central piece) | devices keep working offline; resume on broker return |
| moving parts | one daemon per device | one daemon per device + one server |
| feels like | "files everywhere" | "always-on relay" |

If sub-second sync matters to you (e.g., watching the same file on
two devices simultaneously and the lag bothers you), use the broker
(`docs/Dockerfile.broker` deploys it anywhere). For most usage —
where you pick up a different device and just want it to know what
the previous one knew — Syncthing's seconds-of-latency is invisible.

## Self-hosted discovery (optional)

Syncthing's default discovery uses public servers run by the
Syncthing project. They learn that two devices want to find each
other; they don't see synced content. If you want zero public-server
contact, run your own discovery server:

```sh
# On any always-on machine (a small VPS, your home server, etc.)
go install github.com/syncthing/discosrv@latest
discosrv -listen :8443
```

Then on each device, add this to Syncthing settings → Connections →
Global Discovery Servers: `https://your-discosrv-host:8443/`.

Most setups don't need this — the public discovery servers are fine
for personal use.
