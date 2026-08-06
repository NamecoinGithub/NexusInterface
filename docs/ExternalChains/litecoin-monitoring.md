# Litecoin Core monitoring (user guide)

Nexus Wallet can show **read-only** status from a Litecoin Core node that **you** install and run. Nexus Wallet does **not** manage Litecoin Core, wallets, keys, transactions, or funds.

Security detail: [docs/security/litecoin-core-monitoring.md](../security/litecoin-core-monitoring.md)

## What this feature does

When enabled, Settings → **External Chains** can display:

- Connectivity state (connected / unavailable)
- Litecoin Core version
- Network name (mainnet / testnet / regtest / unknown)
- Block height and header height
- Initial block download flag and verification progress
- Peer count
- Mempool transaction count and memory usage (when available)
- Timestamp of the last successful probe
- Safe error reasons (unreachable, bad cookie, auth failure, timeout, etc.)

Optional Overview stats mirror a subset of that status when monitoring is enabled.

## What this feature does **not** do

- Start, stop, restart, download, or package Litecoin Core
- Create or open Litecoin wallets
- Show Litecoin balances, addresses, or transaction history
- Sign, broadcast, or build Litecoin transactions
- Place exchange orders, run swaps, watch deposits/withdrawals, or automate settlement
- Accept remote (non-loopback) RPC endpoints in this release

## Prerequisites

1. Install [Litecoin Core](https://litecoin.org/) yourself.
2. Run `litecoind` (or Litecoin-Qt with server/RPC enabled) under **your** user account.
3. Note that Litecoin uses a **separate** process, data directory, P2P port, RPC port, cookie file, logs, and wallet material from Nexus Core.
4. Default mainnet RPC port is commonly **9332** (you may choose another valid port).
5. Ensure RPC cookie authentication is enabled (Litecoin Core default cookie file in the Litecoin data directory).

## Configure monitoring

1. Open **Settings → External Chains**.
2. Read the warning: Nexus does not manage Litecoin funds or daemons.
3. Enable **Litecoin monitoring**.
4. Choose host **`127.0.0.1`** or **`::1`** only.
5. Set the RPC port (default suggestion `9332`).
6. **Browse** to select the Litecoin Core `.cookie` file.
7. Click **Test connection**.

If the node is down, misconfigured, or the cookie is wrong, the wallet stays fully usable for Nexus operations. Litecoin errors are isolated.

## Networks

- **Mainnet** is the default expected network for ordinary monitoring.
- **Testnet**, **regtest**, and unrecognized chains are labeled clearly and are **not** shown as mainnet.

## Supported Litecoin Core versions

Nexus reviews this monitoring path against Litecoin Core **0.18.0 and newer** (version integer `>= 180000` as reported by `getnetworkinfo`). Older versions may connect but will surface an **unsupported version** warning. Keep your node updated independently; the wallet will not upgrade Litecoin Core for you.

## Polling and performance

The UI polls on a conservative interval (about 30–60 seconds) and the main process applies a short in-memory cache/backoff so a downed node is not hammered. Requests use short timeouts so a stuck RPC cannot freeze the wallet UI.

## Future exchange research (not implemented here)

Litecoin’s ~2.5-minute block interval is one reason it may be preferred over Bitcoin for some exchange-adjacent research. **Confirmation counts are estimates, not guarantees.** Any future settlement policy must be risk-based and venue-specific. This release does **not** hard-code confirmation thresholds or perform settlement.
