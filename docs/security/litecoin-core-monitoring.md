# Litecoin Core monitoring — security boundary

> Related product docs: [docs/ExternalChains/litecoin-monitoring.md](../ExternalChains/litecoin-monitoring.md)
> Tracking context: isolated local read-only monitoring only (no exchange settlement).

## 1. Purpose

Nexus Interface can optionally show **read-only status** from a **user-managed** Litecoin Core node running on the same machine. This surface exists for operator visibility and future research. It is **not** custody, wallet management, deposit detection, withdrawal, swap execution, or settlement automation.

## 2. Non-negotiable invariants

1. **Monitoring only.** The wallet never starts, stops, restarts, downloads, packages, or reconfigures Litecoin Core.
2. **No Litecoin wallet surface.** No balances, addresses, UTXOs, keys, descriptors, PSBTs, signing, broadcasting, `send*`, `wallet*`, `listwallets`, `dump*`, or `import*` RPCs.
3. **No generic RPC.** The renderer cannot supply a method string, URL, or arbitrary JSON-RPC body. The main process owns a fixed allowlisted sequence.
4. **No generic network/filesystem bridge.** Cookie selection is a named open-file dialog. Cookie **contents** are read only in the main process and never returned to the renderer, logs, analytics, or error payloads.
5. **Loopback only (L1).** Accepted hosts are the literal strings `127.0.0.1` and `::1`. No DNS resolution, LAN, public IP, Tor, or remote RPC in this phase.
6. **Isolation from Nexus Core.** Enabling, disabling, or failing Litecoin monitoring must not restart, pause, reconfigure, or change Nexus Core connection/login/send/market-data behavior.

## 3. Trust boundary diagram

```text
Renderer (Settings / Overview)
  |  named bridge only:
  |  - dialogs.selectLitecoinCookie() -> path | undefined
  |  - externalChains.litecoin.getStatus() -> LitecoinNodeStatus
  |  - settings.update({ litecoinMonitoring* })
  v
Preload (named IPC channels)
  v
Main process
  |  validate host/port again
  |  read .cookie from disk (never log contents)
  |  HTTP Basic auth built in-process
  |  allowlisted JSON-RPC only
  |  normalize + redact -> DTO
  v
User-managed litecoind (loopback RPC)
```

## 4. Endpoint policy

| Rule | Policy |
|------|--------|
| Host | Literal `127.0.0.1` or `::1` only |
| Port | Single explicit decimal integer `1..65535` (default suggestion `9332`) |
| Transport | Local HTTP JSON-RPC only; no TLS claim for this loopback path |
| Scanning | No port scanning |
| Remote | Not supported in L1 |

## 5. Authentication policy

- Cookie authentication only in this milestone (no username/password settings UI).
- Persist the **path** to the cookie file if needed; never persist or relay cookie contents.
- Read cookie bytes immediately before a probe; discard after building the Authorization header.
- Forbidden in logs/errors/analytics/renderer: cookie path **contents**, Authorization headers, username, password, raw JSON-RPC bodies, raw responses.

## 6. RPC allowlist

Fixed methods (main process sequence; renderer cannot choose):

```text
getblockchaininfo
getnetworkinfo
getmempoolinfo
getconnectioncount   # optional fallback for peer total
```

Any other method is unreachable through this feature.

## 7. Supported version policy

| Item | Value |
|------|--------|
| Minimum reviewed Litecoin Core version integer | `180000` (0.18.0) |
| Below minimum | DTO includes `warning.code = unsupported_version` with a safe upgrade message |
| Network | Mainnet is the default expected network; test/regtest/unknown are labeled and never presented as mainnet |

Operators should keep Litecoin Core updated independently. Nexus Interface does not auto-update Litecoin Core.

## 8. Safe DTO / error codes

The renderer receives only a `LitecoinNodeStatus` object. Error codes are closed:

- `not_configured`
- `invalid_configuration`
- `cookie_unavailable`
- `authentication_failed`
- `connection_refused`
- `timeout`
- `invalid_response`
- `unsupported_network`
- `unsupported_version`
- `unavailable`

Messages are generic. They must not include secrets, file contents, Authorization material, or raw RPC payloads.

## 9. Explicit non-goals

- Exchange order placement, swaps, deposits, withdrawals, custody
- Confirmation-triggered settlement automation
- Hard-coded “N confirmations = settled” rules for venue risk
- Generic HTTP proxying or module access to Litecoin RPC

## 10. Confirmation-time framing (research only)

Litecoin produces blocks on the order of **~2.5 minutes** on average. Any future exchange settlement policy must be **risk-based and venue-specific**. This milestone does **not** encode “5” or “7” confirmations (or any other fixed count) as a completed settlement condition.
