<div align="center">

<img src="public/logo.png" alt="Manfaz VPN" width="112" height="112">

# Manfaz VPN

### A Windows client that refuses to claim a connection it has not proven.

[![Version](https://img.shields.io/badge/version-2.27.0-087f72?style=flat-square)](../../releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?style=flat-square&logo=windows&logoColor=white)](https://microsoft.com/windows)
[![Engines](https://img.shields.io/badge/engines-Xray%20%2B%20sing--box-1f2937?style=flat-square)](https://github.com/SagerNet/sing-box)
[![License](https://img.shields.io/badge/license-MIT-f2c055?style=flat-square)](LICENSE)

### [⬇ Download the installer for Windows](https://github.com/hrschemiker/ManfazVpn-Windows/releases/latest/download/Manfaz-VPN-Setup-x64.exe)

That link always serves the newest build. Every version is listed on the
[releases page](https://github.com/hrschemiker/ManfazVpn-Windows/releases/latest), where each
release names the file to download at the top of its notes.

</div>

---

Manfaz is a VPN client for Windows built around a single rule: what the interface says has to
match what the network is actually doing. A green indicator means traffic was observed leaving
this machine through the tunnel and coming back. It never means that a process started and a
port opened.

That rule shapes everything else. Connections are applied as transactions that roll back.
State that Windows keeps, such as proxy settings and per-adapter DNS, is captured before it is
touched and restored afterwards. Failures are reported with the reason rather than a generic
message.

The interface is available in Persian and English, in a dark and a light theme, and follows
the writing direction of the language you pick.

## What ships in the installer

Nothing is downloaded on first launch. Both engines are included:

| Component | Role |
|---|---|
| Xray | Default engine, covering VLESS, VMess, Trojan and Shadowsocks |
| sing-box 1.13.12 | Second engine, and the only one that can drive TUN, Hysteria2, TUIC and AnyTLS |
| wintun | Virtual network adapter used by TUN mode |

Xray is selected on a fresh install. Choosing TUN mode, or a protocol only sing-box speaks,
prompts to switch engines for that connection rather than failing quietly. An installation that
already had an engine chosen keeps it when it updates.

## Connection modes

| Mode | What it does to the machine | Administrator |
|---|---|---:|
| **Auto** | Tries TUN and falls back to System Proxy when that is not possible | Optional |
| **TUN** | Routes all device traffic through a virtual adapter | Required |
| **System Proxy** | Routes proxy-aware applications through a local endpoint | Not needed |
| **DNS only** | Changes resolvers on active adapters and starts no tunnel | Required |

Fallback behaviour is yours to choose. TUN only means exactly that, and the app will report a
failure rather than quietly connecting a different way.

## How a connection is verified

1. The chosen node is compiled into an engine configuration and validated by the engine itself
   before anything on the system changes.
2. Windows state that is about to be modified is recorded first.
3. The engine starts, and routing, proxy or DNS configuration is applied.
4. A public address service is queried through the tunnel. Reaching it proves traffic makes a
   full round trip. Where the address can also be read outside the tunnel, the two are
   compared and have to differ.
5. Any failure at any step rolls the machine back to the recorded state.

While connected, a health check keeps watching. It tolerates a run of failed probes before
acting, because the services used for verification are regularly unreachable for a few seconds
at a time and a single timeout says nothing about the tunnel. A dead engine or a system proxy
switched off underneath the app is acted on immediately, since those are certain.

When a connection attempt is running you get a progress panel: the current step, its number,
the server being tried, which attempt it is when several servers are being worked through, and
a seconds counter so a slow step is visibly still moving.

## AI Settings

Most of the protective options in this app are useful and few people assemble them by hand.
The first section in Settings applies them together, in an order that does not fight itself,
and reports the outcome of each step separately:

- The internet kill switch
- System DNS on Cloudflare Smart
- Encrypted DNS inside the tunnel
- Advanced TLS, meaning a Chrome fingerprint, ECH, and handshake fragmentation

If a step cannot be applied, for instance because arming the kill switch needs Administrator
rights the app does not have, that step is marked failed with the reason. Nothing is reported
as done that was not done.

## TUN mode

TUN is the closest thing to a system wide VPN this app offers. sing-box creates a virtual
adapter, claims the default route, and every application on the machine follows it whether or
not it knows what a proxy is.

Getting that right on Windows takes more than turning it on. Sniffing runs before any rule
that matches on protocol, so DNS is recognised and handed to the resolver stack instead of
leaking out as plain UDP. Queries needed to bring the tunnel up are pinned to the direct
outbound, because a bootstrap lookup that goes through the tunnel is waiting on the very thing
it is supposed to establish. Traffic is carried on the mixed stack, which pairs gVisor's TCP
implementation with the system UDP path and is the combination that actually moves packets on
Windows. Private address ranges stay on the local network, so printers and routers keep
working.

The app will not report TUN as connected until it has read a public address through the tunnel
and seen that it differs from the one you had before connecting.

## Kill Switch

The kill switch arms only after a session has been verified. It does not arm during startup,
during a mode change, or after an attempt that never succeeded, so a failed attempt can never
leave the machine cut off.

If a tunnel drops without being asked to, all outbound traffic is blocked with a Windows
Firewall rule. The app then raises its window, posts a notification, and adds an entry to its
tray menu, because the one thing you cannot do at that moment is look something up online. You
are offered two clear choices: reconnect through the VPN, or lift the block and go back online
without it. The rule is verified as actually removed before the app says the internet is back.

## DNS

DNS works on its own or alongside a tunnel, and the two behave differently on purpose.

**DNS only** changes resolvers on every active Windows adapter. The resolver is queried for
real before anything is applied. Each adapter's previous configuration is recorded once and
restored when the DNS session ends, when a VPN starts, or when the app exits. If the app finds
at startup that a saved configuration is no longer applied everywhere, it restores the
recorded baseline instead of leaving adapters pointed at a resolver nothing will clean up.

**DNS with a tunnel** resolves names inside the engine, so lookups never reach the local
network's resolver. Encrypted transports are used where the resolver supports them, and the
server name and path come from the resolver you actually selected.

Built-in profiles cover Cloudflare, Cloudflare Family, Google, AdGuard, Shecan, Radar and
Electro. Custom IPv4 pairs are validated before they are saved, can be named, and take
priority over the built-in list.

Cloudflare Smart is the default. It scans Cloudflare's edge for an address that answers well
from your network and accepts one only after a real encrypted query succeeds, with 1.1.1.1 as
the fallback.

## Cloudflare clean addresses

Plenty of configurations point at a hostname that resolves into Cloudflare's network, where
some edge addresses perform far better than others depending on your operator. Manfaz scans
that space on a schedule you control, keeps the best result, and substitutes it for the
address in the configuration when the hostname really does resolve into Cloudflare.

The substitution preserves everything the edge needs in order to route the request. The
original hostname stays as the TLS server name, and as the Host header for WebSocket and HTTP
transports. This applies in both System Proxy and TUN.

## Servers and subscriptions

- Subscription links, added by URL and refreshed on demand or after the first tunnel comes up
- Single configurations pasted by hand, stored alongside subscription nodes
- Latency testing across every node, with sorting by ping, name, protocol or REALITY
- A race dial that re-tests the three most promising servers in parallel and takes the winner
- Automatic failover through the candidate list when a server does not pass real traffic
- Subscription inspection showing traffic used, remaining quota and expiry where the provider
  reports them
- QR export for moving a configuration to a phone
- Hiding nodes you never want offered
- Conversion between subscription formats

## Routing

- Direct domains, compiled into engine routing rules so chosen sites bypass the tunnel
- Split tunnelling by application, for banking apps and local services, in TUN mode
- A protected list of domains that are never routed direct, so a bypass rule cannot
  accidentally expose the services people most need the tunnel for

## Working around interference

- TLS record and handshake fragmentation
- A controlled DPI bypass retry when a first attempt passes no traffic
- Provider supplied SNI override
- Global uTLS fingerprint selection and ECH
- SOCKS5 and HTTP upstream proxy chaining

## When something goes wrong

Windows keeps state that a crashed VPN client leaves behind, so the app cleans up after itself
and after previous runs. A stuck local proxy setting, orphaned engine processes holding the
ports, a leftover firewall block and modified adapter DNS are all detected and cleared, and
there is a one click repair that runs the lot on demand.

The Activity page keeps the record: totals for successful connections, failed attempts, time
connected and TUN sessions, then a switch between per-session history and the event log. A
technical report can be copied to the clipboard in one press, which is usually the fastest way
to explain a problem to someone else.

## Updates

Version checks run in the background and retry once connectivity returns. Nothing is
downloaded without your consent, and installing is a deliberate restart rather than something
that happens underneath you. Automatic checking can be turned off entirely.

## Convenience

- Ctrl+Enter to connect or disconnect from anywhere in the app
- Minimise to the system tray instead of quitting
- Start with Windows
- Backup and restore of every setting, subscription and profile as a single file

## Getting started

1. Download and run the installer on Windows 10 or 11, 64 bit.
2. Start the app as Administrator for TUN, the kill switch, or system DNS changes. Without
   elevation everything else still works over System Proxy.
3. Add a subscription link, paste a single configuration, or pick a DNS profile.
4. Open Settings and turn on AI Settings if you want the hardened defaults in one step.
5. Press connect.

## Building from source

```powershell
npm ci
npm run lint
npm run build
npm run dist:win
```

The installer is written to `release/`. Note that `resources/sing-box/sing-box.exe` is not kept
in this repository. Put the official Windows build there before packaging, or let the release
workflow fetch it for you.

Releases are built by GitHub Actions on a Windows runner. Pushing a `v*` tag, pushing a
`release/v*` branch, or running the Release workflow by hand with a tag name all produce the
installer and publish it.

## Requirements

- Windows 10 or Windows 11, x64
- Administrator access for TUN, the kill switch, and system DNS changes
- A subscription or configuration of your own

## License

Released under the [MIT License](LICENSE).
