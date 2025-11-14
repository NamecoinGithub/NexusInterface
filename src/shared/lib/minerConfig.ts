import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';

/**
 * NexusMiner Configuration
 *
 * This module loads and validates miner.conf configuration file.
 * It provides default values for all settings to ensure backward compatibility.
 */

export interface MinerConfiguration {
  // Mining settings
  channel: number;
  workerThreads: number;

  // Network synchronization
  walletIp: string;
  localIp: string;
  port: number;
  fallbackPort: number;
  timeout: number;

  // Genesis hash / payout
  genesisHash: string;
  validateGenesis: boolean;

  // Mining task assignment
  primeHashing: boolean;
  miningMode: 'solo' | 'pool';
  autoReconnect: boolean;
  minReconnectDelay: number;
  maxReconnectDelay: number;

  // Stats and debugging
  verboseStats: boolean;
  statsInterval: number;
  logHashrate: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Performance optimization
  cpuAffinity: string;
  threadPriority: 'low' | 'normal' | 'high';
  cpuOptimizations: boolean;
}

/**
 * Default configuration values
 * Ensures the miner works even without a config file
 */
const DEFAULT_CONFIG: MinerConfiguration = {
  channel: 1, // Prime channel
  workerThreads: 1,
  walletIp: '127.0.0.1',
  localIp: '127.0.0.1',
  port: 9325,
  fallbackPort: 0,
  timeout: 30,
  genesisHash: '',
  validateGenesis: true,
  primeHashing: true,
  miningMode: 'solo',
  autoReconnect: true,
  minReconnectDelay: 1000,
  maxReconnectDelay: 60000,
  verboseStats: true,
  statsInterval: 10,
  logHashrate: true,
  logLevel: 'info',
  cpuAffinity: '',
  threadPriority: 'normal',
  cpuOptimizations: true,
};

/**
 * Parse a configuration file in .conf format
 * Supports comments (#) and key=value pairs
 */
function parseConfFile(content: string): Record<string, string> {
  const config: Record<string, string> = {};

  const lines = content.split('\n');
  for (const line of lines) {
    // Remove comments
    const cleanLine = line.split('#')[0].trim();
    if (!cleanLine) continue;

    // Parse key=value
    const match = cleanLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      config[key] = value;
    }
  }

  return config;
}

/**
 * Convert string value to appropriate type
 */
function parseValue(value: string, defaultValue: any): any {
  if (typeof defaultValue === 'boolean') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  if (typeof defaultValue === 'number') {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }
  return value;
}

/**
 * Load miner configuration from file
 * Falls back to default configuration if file doesn't exist
 */
export function loadMinerConfig(configPath?: string): MinerConfiguration {
  let config = { ...DEFAULT_CONFIG };

  try {
    // Determine config file path
    let confPath: string;
    if (configPath) {
      confPath = configPath;
    } else {
      // Look for miner.conf in configs directory
      confPath = path.join(__dirname, '../../..', 'configs', 'miner.conf');

      // In production build, adjust path
      if (!fs.existsSync(confPath)) {
        confPath = path.join(process.cwd(), 'configs', 'miner.conf');
      }
    }

    // Check if config file exists
    if (!fs.existsSync(confPath)) {
      log.info(
        `[MinerConfig] Config file not found at ${confPath}, using defaults`
      );
      return config;
    }

    // Read and parse config file
    const content = fs.readFileSync(confPath, 'utf-8');
    const parsed = parseConfFile(content);

    log.info(`[MinerConfig] Loading configuration from ${confPath}`);

    // Map configuration keys to camelCase properties
    const keyMap: Record<string, keyof MinerConfiguration> = {
      channel: 'channel',
      worker_threads: 'workerThreads',
      wallet_ip: 'walletIp',
      local_ip: 'localIp',
      port: 'port',
      fallback_port: 'fallbackPort',
      timeout: 'timeout',
      genesis_hash: 'genesisHash',
      validate_genesis: 'validateGenesis',
      prime_hashing: 'primeHashing',
      mining_mode: 'miningMode',
      auto_reconnect: 'autoReconnect',
      min_reconnect_delay: 'minReconnectDelay',
      max_reconnect_delay: 'maxReconnectDelay',
      verbose_stats: 'verboseStats',
      stats_interval: 'statsInterval',
      log_hashrate: 'logHashrate',
      log_level: 'logLevel',
      cpu_affinity: 'cpuAffinity',
      thread_priority: 'threadPriority',
      cpu_optimizations: 'cpuOptimizations',
    };

    // Apply parsed values
    for (const [confKey, propKey] of Object.entries(keyMap)) {
      if (parsed[confKey] !== undefined) {
        const value = parseValue(parsed[confKey], DEFAULT_CONFIG[propKey]);
        (config as any)[propKey] = value;
      }
    }

    // Validate configuration
    validateConfig(config);

    log.info('[MinerConfig] Configuration loaded successfully:', {
      channel: config.channel,
      workerThreads: config.workerThreads,
      host: `${config.walletIp}:${config.port}`,
      miningMode: config.miningMode,
    });

    return config;
  } catch (error: any) {
    log.error('[MinerConfig] Error loading config file:', error.message);
    log.info('[MinerConfig] Using default configuration');
    return config;
  }
}

/**
 * Validate configuration values
 * Throws error for invalid values
 */
function validateConfig(config: MinerConfiguration): void {
  if (config.channel !== 1 && config.channel !== 2) {
    throw new Error(
      `Invalid channel: ${config.channel}. Must be 1 (Prime) or 2 (Hash)`
    );
  }

  if (config.workerThreads < 1) {
    throw new Error(
      `Invalid worker_threads: ${config.workerThreads}. Must be >= 1`
    );
  }

  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}. Must be 1-65535`);
  }

  if (config.timeout < 1) {
    throw new Error(`Invalid timeout: ${config.timeout}. Must be >= 1`);
  }

  if (config.miningMode !== 'solo' && config.miningMode !== 'pool') {
    throw new Error(
      `Invalid mining_mode: ${config.miningMode}. Must be 'solo' or 'pool'`
    );
  }

  if (
    config.threadPriority !== 'low' &&
    config.threadPriority !== 'normal' &&
    config.threadPriority !== 'high'
  ) {
    throw new Error(
      `Invalid thread_priority: ${config.threadPriority}. Must be 'low', 'normal', or 'high'`
    );
  }

  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(config.logLevel)) {
    throw new Error(
      `Invalid log_level: ${config.logLevel}. Must be one of: ${validLogLevels.join(', ')}`
    );
  }
}

/**
 * Get a singleton instance of the miner configuration
 */
let cachedConfig: MinerConfiguration | null = null;

export function getMinerConfig(force = false): MinerConfiguration {
  if (!cachedConfig || force) {
    cachedConfig = loadMinerConfig();
  }
  return cachedConfig;
}

/**
 * Reload configuration from file
 */
export function reloadMinerConfig(): MinerConfiguration {
  return getMinerConfig(true);
}

/**
 * Export default config for testing
 */
export { DEFAULT_CONFIG };
