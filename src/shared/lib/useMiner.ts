import { useState, useEffect, useCallback, useRef } from 'react';
import { PrimeMiner } from './miner';
import log from 'electron-log';

/**
 * React hook to manage CPU Prime miner state and lifecycle
 */
export function useMiner(enabled: boolean = false) {
  const minerRef = useRef<PrimeMiner | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<string>('disconnected');
  const [stats, setStats] = useState({
    blockHeight: 0,
    blocksAccepted: 0,
    blocksRejected: 0,
    channel: 1,
    connected: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Initialize miner instance
  useEffect(() => {
    if (!minerRef.current) {
      minerRef.current = new PrimeMiner({
        host: '127.0.0.1',
        port: 9325,
        channel: 1, // Prime channel
        timeout: 30,
      });

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
  }, []);

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
  };
}
