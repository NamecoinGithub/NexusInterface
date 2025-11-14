import { useState, useEffect, useCallback, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { PrimeMiner } from './miner';
import { MiningWorkerPool } from './MiningWorker';
import { userGenesisAtom } from './session';
import { getMinerConfig } from './minerConfig';
import log from 'electron-log';

/**
 * Configuration for CPU Prime mining
 * Parameters can be overridden from miner.conf file
 */
interface MinerHookConfig {
  genesisHash?: string; // Mining payment address (from wallet)
  host?: string; // Mining server host
  port?: number; // Primary mining port
  fallbackPort?: number; // Fallback port (0 = auto)
  channel?: number; // Mining channel (1 = Prime, 2 = Hash)
  numThreads?: number; // Number of worker threads
}

/**
 * React hook to manage CPU Prime miner state and lifecycle
 * Features:
 * - Configuration from miner.conf file with fallback to defaults
 * - Genesis hash from wallet context or config file
 * - Auto port selection (primary → fallback)
 * - Configurable channel (Prime/Hash)
 * - Event-driven architecture
 * - No PIN flow required for start/stop
 * - Worker pool management for actual CPU mining
 */
export function useMiner(
  enabled: boolean = false,
  config: MinerHookConfig = {}
) {
  const minerRef = useRef<PrimeMiner | null>(null);
  const workerPoolRef = useRef<MiningWorkerPool | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<string>('disconnected');
  const [stats, setStats] = useState({
    blockHeight: 0,
    blocksAccepted: 0,
    blocksRejected: 0,
    channel: 1,
    connected: false,
    port: 9325,
    hashrate: 0,
    numWorkers: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Get genesis hash from wallet context or config file
  const walletGenesis = useAtomValue(userGenesisAtom);

  // Load miner configuration from file
  const fileConfig = getMinerConfig();

  // Priority: hook config > file config > wallet genesis
  const genesisHash =
    config.genesisHash || fileConfig.genesisHash || walletGenesis;

  // Initialize miner instance and worker pool
  useEffect(() => {
    if (!minerRef.current) {
      // Merge configuration from file and hook parameters
      // Hook parameters take precedence over file config
      const minerConfig = {
        host: config.host || fileConfig.walletIp,
        port: config.port || fileConfig.port,
        fallbackPort: config.fallbackPort ?? fileConfig.fallbackPort,
        channel: config.channel || fileConfig.channel,
        timeout: fileConfig.timeout,
        maxReconnectDelay: fileConfig.maxReconnectDelay,
        minReconnectDelay: fileConfig.minReconnectDelay,
      };

      log.info('[useMiner] Initializing miner with config from miner.conf:', {
        ...minerConfig,
        genesisHash: genesisHash
          ? `${genesisHash.substring(0, 16)}...`
          : 'not set',
        validateGenesis: fileConfig.validateGenesis,
        miningMode: fileConfig.miningMode,
      });

      minerRef.current = new PrimeMiner(minerConfig);

      // Initialize worker pool with config from file
      const numThreads = config.numThreads || fileConfig.workerThreads;
      workerPoolRef.current = new MiningWorkerPool({
        numThreads,
        logHashrate: fileConfig.logHashrate,
      });

      // Set up miner event listeners
      minerRef.current.on('connected', () => {
        log.info('[useMiner] Miner connected');
        setError(null);
      });

      minerRef.current.on('ready', () => {
        log.info('[useMiner] Miner ready to mine');
        setError(null);
      });

      minerRef.current.on('stateChange', (newState: string) => {
        setState(newState);
      });

      minerRef.current.on('block', (height: number) => {
        log.info(`[useMiner] New block: ${height}`);
        updateStats();
      });

      // Listen for block templates and dispatch to workers
      minerRef.current.on('blockTemplate', (templateData: Buffer) => {
        log.info('[useMiner] Received block template, dispatching to workers');
        if (workerPoolRef.current) {
          workerPoolRef.current.processTemplate(templateData);
        }
      });

      minerRef.current.on('blockAccepted', () => {
        log.info('[useMiner] Block accepted!');
        updateStats();
      });

      minerRef.current.on('blockRejected', () => {
        log.warn('[useMiner] Block rejected');
        updateStats();
      });

      minerRef.current.on('error', (err: Error) => {
        log.error('[useMiner] Miner error:', err.message);
        setError(err.message);
      });

      minerRef.current.on('reconnecting', (delay: number) => {
        log.info(`[useMiner] Reconnecting in ${delay}ms`);
        setError(`Connection lost. Reconnecting...`);
      });

      // Set up worker pool event listeners
      if (workerPoolRef.current) {
        workerPoolRef.current.on(
          'solution',
          (solution: { merkleRoot: Buffer; nonce: bigint }) => {
            log.info('[useMiner] Worker found solution, submitting to core');
            if (minerRef.current) {
              minerRef.current.submitBlock(solution.merkleRoot, solution.nonce);
            }
          }
        );

        workerPoolRef.current.on('hashrate', (hashrateData: any) => {
          setStats((prev) => ({
            ...prev,
            hashrate: hashrateData.current,
          }));
        });

        workerPoolRef.current.on('error', (err: Error) => {
          log.error('[useMiner] Worker error:', err.message);
        });
      }
    }

    return () => {
      if (workerPoolRef.current) {
        workerPoolRef.current.stop();
        workerPoolRef.current.removeAllListeners();
        workerPoolRef.current = null;
      }
      if (minerRef.current) {
        minerRef.current.stop();
        minerRef.current.removeAllListeners();
        minerRef.current = null;
      }
    };
  }, [
    config.host,
    config.port,
    config.fallbackPort,
    config.channel,
    config.numThreads,
    genesisHash,
  ]);

  // Update stats from miner and worker pool
  const updateStats = useCallback(() => {
    if (minerRef.current) {
      const minerStats = minerRef.current.getStats();
      const workerStats = workerPoolRef.current?.getStats() || {
        hashrate: 0,
        numWorkers: 0,
      };

      setStats({
        blockHeight: minerStats.blockHeight,
        blocksAccepted: minerStats.blocksAccepted,
        blocksRejected: minerStats.blocksRejected,
        channel: minerStats.channel,
        connected: minerStats.connected,
        port: minerStats.port,
        hashrate: workerStats.hashrate || 0,
        numWorkers: workerStats.numWorkers || 0,
      });
    }
  }, []);

  // Start/stop miner and workers based on enabled flag
  useEffect(() => {
    if (!minerRef.current || !workerPoolRef.current) return;

    const startMining = async () => {
      if (enabled && !isRunning) {
        log.info('[useMiner] Starting miner and workers...');

        // Start worker pool first
        await workerPoolRef.current!.start();

        // Then start LLP connection
        minerRef.current!.start();

        setIsRunning(true);
        updateStats();
      }
    };

    const stopMining = async () => {
      if (!enabled && isRunning) {
        log.info('[useMiner] Stopping miner and workers...');

        // Stop LLP connection first
        minerRef.current!.stop();

        // Then stop workers
        await workerPoolRef.current!.stop();

        setIsRunning(false);
        updateStats();
      }
    };

    startMining().catch((err) => {
      log.error('[useMiner] Failed to start mining:', err);
      setError(err.message);
    });

    stopMining().catch((err) => {
      log.error('[useMiner] Failed to stop mining:', err);
      setError(err.message);
    });
  }, [enabled, isRunning, updateStats]);

  // Periodically update stats while running
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(updateStats, 1000);
    return () => clearInterval(interval);
  }, [isRunning, updateStats]);

  return {
    isRunning,
    state,
    stats,
    error,
    genesisHash, // Expose genesis hash for UI display
  };
}
