# NexusMiner Configuration Guide

## Overview

The `miner.conf` file provides configuration options for the NexusMiner integrated into the Nexus Wallet Interface. This file addresses previous issues with zero-CPU utilization and provides a streamlined setup for mining operations.

## Location

The configuration file should be placed at:
```
configs/miner.conf
```

## Configuration Options

### Mining Settings

#### channel
- **Type:** Integer (1 or 2)
- **Default:** 1
- **Description:** Mining channel selection
  - `1` = Prime channel (CPU mining with prime number hashing)
  - `2` = Hash channel (GPU mining)
- **Example:** `channel=1`

#### worker_threads
- **Type:** Integer (≥ 1)
- **Default:** 1
- **Description:** Number of worker threads for mining. Optimized for single-worker setup to ensure proper CPU utilization. Adjust based on your system's hardware capabilities.
- **Example:** `worker_threads=1`

### Network Synchronization Settings

#### wallet_ip
- **Type:** IP Address
- **Default:** 127.0.0.1
- **Description:** Wallet IP address for synchronization with Nexus Node. Use localhost (127.0.0.1) for local node connections.
- **Example:** `wallet_ip=127.0.0.1`

#### local_ip
- **Type:** IP Address
- **Default:** 127.0.0.1
- **Description:** Local IP address for miner binding. Should match wallet_ip for localhost connections.
- **Example:** `local_ip=127.0.0.1`

#### port
- **Type:** Integer (1-65535)
- **Default:** 9325
- **Description:** Primary mining port (Prime channel default).
- **Example:** `port=9325`

#### fallback_port
- **Type:** Integer (0-65535)
- **Default:** 0
- **Description:** Fallback port if primary fails. Set to 0 for auto-select.
- **Example:** `fallback_port=0`

#### timeout
- **Type:** Integer (seconds, ≥ 1)
- **Default:** 30
- **Description:** Connection timeout in seconds.
- **Example:** `timeout=30`

### Genesis Hash / Payout Address

#### genesis_hash
- **Type:** String (Base58 encoded address)
- **Default:** (empty - uses logged-in wallet)
- **Description:** Genesis hash for mining rewards (payment address). This should match the Nexus Node's synced blockchain genesis. Leave empty to use genesis from logged-in wallet context.
- **Example:** `genesis_hash=8FJxzexVDUN5YiQYK4QjvfRNrAUym8FNu3B8Q2hQxAswPuJwbhWe2v4CZGexU6BYc`

#### validate_genesis
- **Type:** Boolean
- **Default:** true
- **Description:** Validate genesis hash against Nexus Node blockchain. Ensures mining task assignment is properly configured.
- **Example:** `validate_genesis=true`

### Mining Task Assignment

#### prime_hashing
- **Type:** Boolean
- **Default:** true
- **Description:** Enable prime-number hashing for CPU mining. Required for Prime channel mining.
- **Example:** `prime_hashing=true`

#### mining_mode
- **Type:** String (solo or pool)
- **Default:** solo
- **Description:** Mining mode selection. Solo mining sends rewards directly to genesis address.
- **Example:** `mining_mode=solo`

#### auto_reconnect
- **Type:** Boolean
- **Default:** true
- **Description:** Enable automatic reconnection on connection failure.
- **Example:** `auto_reconnect=true`

#### min_reconnect_delay
- **Type:** Integer (milliseconds)
- **Default:** 1000
- **Description:** Minimum delay between reconnection attempts.
- **Example:** `min_reconnect_delay=1000`

#### max_reconnect_delay
- **Type:** Integer (milliseconds)
- **Default:** 60000
- **Description:** Maximum delay between reconnection attempts (exponential backoff).
- **Example:** `max_reconnect_delay=60000`

### Stats and Debugging

#### verbose_stats
- **Type:** Boolean
- **Default:** true
- **Description:** Enable verbose stats printer for monitoring worker activity during runtime.
- **Example:** `verbose_stats=true`

#### stats_interval
- **Type:** Integer (seconds)
- **Default:** 10
- **Description:** Interval for stats reporting.
- **Example:** `stats_interval=10`

#### log_hashrate
- **Type:** Boolean
- **Default:** true
- **Description:** Enable hashrate logging for debugging and monitoring.
- **Example:** `log_hashrate=true`

#### log_level
- **Type:** String (debug, info, warn, error)
- **Default:** info
- **Description:** Logging verbosity level.
- **Example:** `log_level=info`

### Performance Optimization

#### cpu_affinity
- **Type:** String (comma-separated CPU indices)
- **Default:** (empty - auto)
- **Description:** CPU affinity for worker threads. Leave empty for automatic assignment.
- **Example:** `cpu_affinity=0,1,2,3`

#### thread_priority
- **Type:** String (low, normal, high)
- **Default:** normal
- **Description:** Thread priority for worker processes. Note: 'high' may require elevated privileges.
- **Example:** `thread_priority=normal`

#### cpu_optimizations
- **Type:** Boolean
- **Default:** true
- **Description:** Enable CPU optimizations for prime testing algorithms.
- **Example:** `cpu_optimizations=true`

## Example Configuration

Here's a complete example configuration for a typical setup:

```conf
# Mining on Prime channel with single worker
channel=1
worker_threads=1

# Local Nexus Node connection
wallet_ip=127.0.0.1
local_ip=127.0.0.1
port=9325
fallback_port=0
timeout=30

# Use wallet genesis for payouts
genesis_hash=
validate_genesis=true

# Solo mining configuration
prime_hashing=true
mining_mode=solo
auto_reconnect=true
min_reconnect_delay=1000
max_reconnect_delay=60000

# Enable verbose stats for monitoring
verbose_stats=true
stats_interval=10
log_hashrate=true
log_level=info

# Default performance settings
cpu_affinity=
thread_priority=normal
cpu_optimizations=true
```

## Troubleshooting

### Zero CPU Utilization

If you experience zero CPU utilization:

1. Ensure `worker_threads` is set to at least 1
2. Verify `prime_hashing=true` for Prime channel mining
3. Check that `channel=1` for CPU mining
4. Enable `verbose_stats=true` to monitor worker activity
5. Review logs for connection issues

### Connection Issues

If the miner cannot connect to Nexus Node:

1. Verify Nexus Node is running and synced
2. Check `wallet_ip` and `port` settings match your node
3. Enable `auto_reconnect=true` for automatic recovery
4. Try `fallback_port=0` for automatic port selection

### Genesis Hash Validation Errors

If genesis validation fails:

1. Leave `genesis_hash=` empty to use wallet genesis
2. Ensure you are logged into the wallet
3. Verify Nexus Node is fully synchronized
4. Set `validate_genesis=false` only if necessary (not recommended)

## Notes

- Configuration changes require miner restart to take effect
- Default values ensure the miner works without a config file
- Hook parameters in code take precedence over file configuration
- Genesis hash from wallet context is preferred over file configuration
- Verbose stats help debug worker activity and connection issues
