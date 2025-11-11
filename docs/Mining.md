# Mining with Nexus Wallet

The Nexus Wallet includes built-in CPU mining capabilities that allow you to participate in securing the Nexus blockchain and earn NXS rewards.

## Overview

Nexus uses a three-channel consensus system:
- **Prime Channel**: Uses CPU for prime number cluster calculations
- **Hash Channel**: Uses CPU/GPU for SHA3-based hashing operations
- **Stake Channel**: Uses your NXS balance for proof-of-stake (see Staking documentation)

The Nexus Wallet supports CPU mining on both the Prime and Hash channels through the embedded Nexus Core.

## Getting Started with Mining

### Prerequisites

- Nexus Wallet installed and synchronized
- Not running in Lite mode or Multi-user mode
- Sufficient CPU resources available
- Internet connection

### Enabling Mining

1. Open Nexus Wallet
2. Navigate to **Settings** > **Core** > **Embedded Core Settings**
3. Locate the **Enable mining** toggle
4. Turn on the toggle to enable mining
5. The wallet will restart the core with mining enabled

### Solo Mining vs Pool Mining

#### Solo Mining

Solo mining means you mine independently without connecting to a pool. This is the default mode when you enable mining.

**Advantages:**
- Keep 100% of block rewards
- No pool fees
- Full control

**Disadvantages:**
- Rewards are less frequent
- Requires significant computational power
- Higher variance in earnings

**Configuration:**
- Simply enable mining with an empty IP whitelist

#### Pool Mining

Pool mining allows you to combine your mining power with other miners for more consistent rewards.

**Advantages:**
- More frequent (but smaller) rewards
- Lower variance
- Suitable for smaller mining operations

**Disadvantages:**
- Pool fees (typically 1-3%)
- Must trust the pool operator
- Shared rewards

**Configuration:**
1. Enable mining
2. Configure the **Mining IP Whitelist** field
3. Add pool IP addresses and ports (format: `192.168.1.100:9325;10.0.0.50:9325`)
4. Wildcards are supported (e.g., `192.168.*.*`)
5. Separate multiple entries with semicolons (`;`)

### Mining Configuration

#### Mining IP Whitelist

The IP whitelist controls which IP addresses are allowed to connect for mining:

- **Empty**: Solo mining only (default)
- **Specific IPs**: Only listed IPs can connect (format: `IP:PORT`)
- **Wildcards**: Use `*` for IP ranges (e.g., `192.168.1.*`)
- **Multiple entries**: Separate with `;` (e.g., `10.0.0.1:9325;10.0.0.2:9325`)

**Examples:**
```
# Allow single pool
mining.pool.com:9325

# Allow local network
192.168.1.*

# Allow multiple specific IPs
10.0.0.100:9325;10.0.0.101:9325;10.0.0.102:9325
```

## Monitoring Mining Activity

### Mining Statistics on Overview Page

The Overview page displays real-time mining statistics:

- **Prime Difficulty**: Current difficulty for the Prime channel
- **Hash Difficulty**: Current difficulty for the Hash channel
- **Staking Difficulty**: Current difficulty for staking

Higher difficulty means more computational power is required to find blocks, but also potentially higher rewards.

### Core Logs

For detailed mining activity, you can check the core logs:
1. Navigate to **Settings** > **Core**
2. Check the verbose level setting
3. View logs in the Terminal tab

## Mining Performance

### CPU Mining Performance Factors

- **CPU Cores**: More cores generally means better mining performance
- **CPU Speed**: Higher clock speeds improve hashing rates
- **System Load**: Other applications competing for CPU resources will reduce mining efficiency
- **Cooling**: Ensure adequate cooling as mining uses 100% CPU
- **Power**: Mining is energy-intensive; consider electricity costs

### Optimizing Mining

1. **Close unnecessary applications** to free up CPU resources
2. **Monitor temperature** to prevent thermal throttling
3. **Use dedicated mining hardware** for best results
4. **Join a mining pool** if solo mining isn't profitable
5. **Consider electricity costs** before mining

## GPU Mining

The Nexus Wallet's embedded core supports CPU mining only. For GPU mining on the Hash channel, you can use standalone mining software:

- **NexusMiner**: Supports FPGA/GPU/CPU mining for Hash channel
- **Standalone miners**: Available from the Nexus community

To use standalone GPU miners alongside the wallet:
1. Keep the wallet running (but don't enable mining in wallet)
2. Run the standalone GPU miner separately
3. Configure the standalone miner to connect to your wallet's core

For more information on standalone miners, visit the [Nexus Mining Resources](https://nexus.io/mining).

## Troubleshooting

### Mining Not Starting

- **Check mode**: Ensure Lite mode and Multi-user mode are disabled
- **Verify settings**: Confirm mining is enabled in Core settings
- **Restart core**: Try restarting the Nexus Core
- **Check logs**: Review logs for error messages

### Low Mining Performance

- **Check CPU usage**: Verify mining is actually using CPU resources
- **Check difficulty**: High network difficulty reduces individual mining success
- **Verify synchronization**: Ensure blockchain is fully synchronized
- **Review system resources**: Close other CPU-intensive applications

### Pool Mining Not Working

- **Verify IP whitelist**: Ensure pool IPs are correctly formatted
- **Check port**: Confirm the correct port is specified
- **Firewall**: Ensure firewall allows connections on the specified ports
- **Pool status**: Verify the mining pool is operational

## Security Considerations

- **IP Whitelist**: Only add trusted pool IPs to your whitelist
- **Firewall**: Use a firewall to protect against unauthorized connections
- **Updates**: Keep your wallet updated for security patches
- **Monitoring**: Regularly monitor mining activity for anomalies

## Additional Resources

- [Nexus Website](https://nexus.io/)
- [Nexus Mining Pools](https://nexus.io/pools)
- [Nexus Mining Forum](https://nexus.io/forum/mining)
- [NexusMiner GitHub](https://github.com/Nexusoft/NexusMiner)
- [PrimePoolMiner GitHub](https://github.com/Nexusoft/PrimePoolMiner)

## FAQ

**Q: Can I mine and stake at the same time?**
A: Yes, you can enable both mining and staking simultaneously in the wallet.

**Q: How much can I earn from mining?**
A: Earnings depend on network difficulty, your computational power, electricity costs, and whether you solo mine or pool mine.

**Q: Will mining harm my computer?**
A: Mining uses 100% CPU which generates heat. Ensure adequate cooling to prevent hardware damage.

**Q: Can I mine on multiple computers?**
A: Yes, you can run the wallet with mining enabled on multiple computers, each contributing to the network.

**Q: Do I need to keep the wallet open while mining?**
A: Yes, the wallet must be running for the embedded core to mine.

**Q: Can I use GPU for mining with this wallet?**
A: The embedded core supports CPU mining only. For GPU mining, use standalone mining software like NexusMiner.
