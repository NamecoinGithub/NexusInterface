# CPU Prime Miner

## Overview

The CPU Prime Miner is a TypeScript implementation of the Nexus mining protocol (LLP - Lower Level Protocol) for the Nexus Interface wallet. It enables CPU-based mining on the Prime channel with robust connection handling and proper channel handshake.

## Key Features

### 1. Robust Channel Handshake

The miner implements a proper handshake sequence to ensure the mining channel is confirmed before requesting blocks or rewards:

```
1. Connect to mining server
2. Send SET_CHANNEL (channel 1 for Prime)
3. Send PING as ordering barrier
4. Wait for PING response (timeout: 5s)
5. Mark channel as confirmed
6. Begin mining operations
```

This sequence fixes the issue where `GET_REWARD` was being sent before `SET_CHANNEL` was processed by the core, which caused timeouts waiting for block rewards.

### 2. Auto-Reconnect with Exponential Backoff

The miner automatically reconnects when the connection drops, using exponential backoff to avoid overwhelming the server:

- **Initial delay**: 1 second
- **Maximum delay**: 60 seconds
- **Backoff strategy**: Delay doubles after each failed attempt
- **Reset**: Successful connection resets delay to initial value

### 3. Connection State Machine

The miner maintains a clear state machine:

- `disconnected`: Not connected to server
- `connecting`: Connection attempt in progress
- `handshaking`: Waiting for channel confirmation (PING response)
- `ready`: Channel confirmed, ready to mine
- `mining`: Actively mining
- `reconnecting`: Attempting to reconnect after disconnection

### 4. Event-Driven Architecture

The miner emits events for all important state changes:

- `connected`: Successfully connected to server
- `ready`: Channel confirmed, ready to mine
- `stateChange`: State machine transition
- `block`: New block height received
- `blockAccepted`: Block solution accepted
- `blockRejected`: Block solution rejected
- `error`: Connection or protocol error
- `reconnecting`: Reconnection scheduled

## Usage

### Basic Usage

```typescript
import { PrimeMiner } from 'lib/miner';

// Create miner instance
const miner = new PrimeMiner({
  host: '127.0.0.1',
  port: 9325,
  channel: 1, // Prime channel
  timeout: 30,
});

// Set up event listeners
miner.on('connected', () => {
  console.log('Connected to mining server');
});

miner.on('ready', () => {
  console.log('Ready to mine');
});

miner.on('block', (height) => {
  console.log(`New block: ${height}`);
});

// Start mining
miner.start();

// Stop mining
miner.stop();

// Get statistics
const stats = miner.getStats();
console.log('Stats:', stats);
```

### React Hook Usage

```typescript
import { useMiner } from 'lib/useMiner';

function MiningComponent() {
  const [enabled, setEnabled] = useState(false);
  const { isRunning, state, stats, error } = useMiner(enabled);

  return (
    <div>
      <button onClick={() => setEnabled(!enabled)}>
        {enabled ? 'Stop' : 'Start'} Mining
      </button>
      <p>State: {state}</p>
      <p>Block Height: {stats.blockHeight}</p>
      <p>Blocks Accepted: {stats.blocksAccepted}</p>
      {error && <p>Error: {error}</p>}
    </div>
  );
}
```

## Configuration

The miner accepts the following configuration options:

```typescript
interface MinerConfig {
  host: string;              // Mining server IP (default: '127.0.0.1')
  port: number;              // Mining server port (default: 9325)
  channel: number;           // Mining channel (1=Prime, 2=Hash)
  timeout: number;           // Connection timeout in seconds (default: 30)
  maxReconnectDelay: number; // Max reconnect delay in ms (default: 60000)
  minReconnectDelay: number; // Min reconnect delay in ms (default: 1000)
}
```

## Protocol Details

### Packet Format

All packets use the following binary format:

```
[Header: 1 byte][Length: 4 bytes LE][Data: N bytes]
```

### Packet Types

#### Data Packets
- `BLOCK_DATA (0)`: Block template for mining
- `SUBMIT_BLOCK (1)`: Submit block solution
- `BLOCK_HEIGHT (2)`: Current blockchain height
- `SET_CHANNEL (3)`: Set mining channel

#### Request Packets
- `GET_BLOCK (129)`: Request block template
- `GET_HEIGHT (130)`: Request blockchain height
- `GET_REWARD (131)`: Request block reward info

#### Response Packets
- `GOOD (200)`: Block accepted
- `FAIL (201)`: Block rejected

#### Generic Packets
- `PING (253)`: Keep-alive / ordering barrier
- `CLOSE (254)`: Connection close

## Architecture

### Class: PrimeMiner

Main miner client class that extends EventEmitter.

**Key Methods:**
- `start()`: Start the miner and connect to server
- `stop()`: Stop the miner gracefully
- `getStats()`: Get current mining statistics
- `sendGetBlock()`: Request new block (only when channel confirmed)
- `sendGetReward()`: Request reward info (only when channel confirmed)
- `submitBlock(merkleRoot, nonce)`: Submit block solution

**Private Methods:**
- `connect()`: Establish TCP connection
- `startHandshake()`: Begin channel handshake sequence
- `completeHandshake()`: Complete handshake after PING response
- `startMining()`: Begin mining operations
- `scheduleReconnect()`: Schedule reconnect with backoff
- `handlePacket(packet)`: Process received packet
- `sendPacket(header, data)`: Send packet to server

## Troubleshooting

### Connection Issues

**Problem**: Miner keeps reconnecting
- **Solution**: Check if Nexus Core is running and mining port (9325) is accessible

**Problem**: Handshake timeout
- **Solution**: Ensure Nexus Core version supports the mining protocol

### Mining Issues

**Problem**: No blocks being received
- **Solution**: Check if channel is confirmed (`channelConfirmed` flag)

**Problem**: All blocks rejected
- **Solution**: Verify difficulty settings and block solution calculation

## Security Considerations

1. **No Secrets in Code**: The miner doesn't handle any private keys or sensitive data
2. **Local Connection**: Default configuration connects only to localhost
3. **Timeout Protection**: All network operations have timeouts to prevent hangs
4. **Error Handling**: All errors are caught and logged, no crashes

## Future Enhancements

Potential improvements for future versions:

1. **Multi-threading**: Support for multiple mining threads
2. **GPU Mining**: Support for Hash channel GPU mining
3. **Pool Mining**: Support for mining pool protocols
4. **Statistics Dashboard**: Enhanced mining statistics and charts
5. **Difficulty Prediction**: Predictive difficulty adjustment
6. **Custom Algorithms**: Pluggable mining algorithms

## References

- [Nexus LLP Protocol](https://github.com/Nexusoft/PrimeSoloMiner)
- [Nexus Core Documentation](https://nexus.io/)
- [Mining Guide](docs/Mining.md)
