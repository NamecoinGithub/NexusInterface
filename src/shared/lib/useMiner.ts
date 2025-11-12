import { useState, useEffect, useCallback, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { PrimeMiner } from './miner';
import { userGenesisAtom } from './session';
import log from 'electron-log';

/**
 * Configuration for CPU Prime mining
 * All parameters are hardcoded - no external config files needed
 */
interface MinerHookConfig {
  genesisHash?: string; // Mining payment address (from wallet)
  host?: string; // Mining server host
  port?: number; // Primary mining port
  fallbackPort?: number; // Fallback port (0 = auto)
  channel?: number; // Mining channel (1 = Prime, 2 = Hash)
}

/**
 * React hook to manage CPU Prime miner state and lifecycle
 * Features:
 * - Hardcoded configuration from wallet atoms (genesis hash)
 * - Auto port selection (primary → fallback port 0)
 * - Hardcoded channel (Prime = 1)
 * - Event-driven architecture
 * - No PIN flow required for start/stop
 */
export function useMiner(enabled: boolean = false, config: MinerHookConfig = {}) {
  const minerRef = useRef<PrimeMiner | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<string>('disconnected');
  const [stats, setStats] = useState({
    blockHeight: 0,
    blocksAccepted: 0,
    blocksRejected: 0,
    channel: 1,
    connected: false,
    port: 9325,
  });
  const [error, setError] = useState<string | null>(null);
  
  // Get genesis hash from wallet context (hardcoded payment address)
  const walletGenesis = useAtomValue(userGenesisAtom);
  const genesisHash = config.genesisHash || walletGenesis;

  // Initialize miner instance
  useEffect(() => {
    if (!minerRef.current) {
      // Hardcoded configuration - no external config files needed
      const minerConfig = {
        host: config.host || '127.0.0.1',
        port: config.port || 9325, // Primary port
        fallbackPort: config.fallbackPort ?? 0, // Auto fallback port
        channel: config.channel || 1, // Prime channel (hardcoded)
        timeout: 30,
      };
      
      log.info('[useMiner] Initializing miner with hardcoded config:', {
        ...minerConfig,
        genesisHash: genesisHash ? `${genesisHash.substring(0, 16)}...` : 'not set',
      });
      
      minerRef.current = new PrimeMiner(minerConfig);

      // Set up event listeners
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
    }

    return () => {
      if (minerRef.current) {
        minerRef.current.stop();
        minerRef.current.removeAllListeners();
        minerRef.current = null;
      }
    };
  }, [config.host, config.port, config.fallbackPort, config.channel, genesisHash]);

  // Update stats from miner
  const updateStats = useCallback(() => {
    if (minerRef.current) {
      setStats(minerRef.current.getStats());
    }
  }, []);

  // Start/stop miner based on enabled flag
  useEffect(() => {
    if (!minerRef.current) return;

    if (enabled && !isRunning) {
      log.info('[useMiner] Starting miner...');
      minerRef.current.start();
      setIsRunning(true);
      updateStats();
    } else if (!enabled && isRunning) {
      log.info('[useMiner] Stopping miner...');
      minerRef.current.stop();
      setIsRunning(false);
      updateStats();
    }
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
