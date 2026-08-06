import { atom } from 'jotai';
import jotaiQuery from 'utils/jotaiQuery';
import { settingsAtom } from 'lib/settings';

export type LitecoinNodeStatus = {
  configured: boolean;
  connected: boolean;
  network?: 'main' | 'test' | 'regtest' | 'unknown';
  version?: number;
  blocks?: number;
  headers?: number;
  verificationProgress?: number;
  initialBlockDownload?: boolean;
  connections?: number;
  mempoolTransactions?: number;
  mempoolBytes?: number;
  fetchedAt: string;
  /**
   * Freshness of the DTO relative to the main-process probe:
   * - live: just obtained from a successful RPC sequence
   * - cached: reused recent successful result for the same configuration
   * - stale: last-good data retained after a later probe failure
   * - unavailable: failure with no retained good data
   */
  freshness: 'live' | 'cached' | 'stale' | 'unavailable';
  warning?: {
    code: 'unsupported_version' | 'unexpected_network' | 'unknown_version';
    message: string;
  };
  error?: {
    code:
      | 'not_configured'
      | 'invalid_configuration'
      | 'cookie_unavailable'
      | 'authentication_failed'
      | 'connection_refused'
      | 'timeout'
      | 'invalid_response'
      | 'unsupported_network'
      | 'unsupported_version'
      | 'unavailable';
    message: string;
  };
};

/**
 * Litecoin monitoring query.
 *
 * Intentionally independent of Nexus Core connection state and core
 * bootstrap. Failures here must never affect Core startup, login, send
 * flow, market data, or app bootstrap.
 *
 * Query identity includes the monitored configuration so a host/port/cookie
 * or enabled change does not keep displaying a prior endpoint's status.
 */
export const litecoinNodeStatusQuery = jotaiQuery<LitecoinNodeStatus>({
  condition: (get) => !!get(settingsAtom).litecoinMonitoringEnabled,
  getQueryConfig: (get) => {
    const settings = get(settingsAtom);
    return {
      queryKey: [
        'externalChains',
        'litecoin',
        'status',
        !!settings.litecoinMonitoringEnabled,
        settings.litecoinMonitoringHost,
        settings.litecoinMonitoringRpcPort,
        settings.litecoinMonitoringCookiePath,
      ],
      queryFn: async () => {
        const status =
          await window.nexusElectron.externalChains.litecoin.getStatus();
        return status as LitecoinNodeStatus;
      },
      // Conservative polling — local node status does not need frequent refresh.
      refetchInterval: 45000,
      staleTime: 30000,
      retry: 1,
      retryDelay: 10000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Keep prior DTO while refetching, but UI must honor freshness labels.
      placeholderData: (previousData) => previousData,
    };
  },
});

export const litecoinMonitoringEnabledAtom = atom(
  (get) => !!get(settingsAtom).litecoinMonitoringEnabled
);

export function formatLitecoinVersion(version?: number): string {
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return 'Unknown';
  }
  const major = Math.floor(version / 1000000);
  const minor = Math.floor((version % 1000000) / 10000);
  const rev = Math.floor((version % 10000) / 100);
  const build = version % 100;
  if (major > 0) {
    return build
      ? `${major}.${minor}.${rev}.${build}`
      : `${major}.${minor}.${rev}`;
  }
  // Historical Bitcoin/Litecoin style: 0.21.2 => 210200
  return build ? `0.${minor}.${rev}.${build}` : `0.${minor}.${rev}`;
}

export function formatSyncPercent(progress?: number): string {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return 'N/A';
  }
  const pct = Math.max(0, Math.min(100, progress * 100));
  return `${pct.toFixed(pct >= 99.99 ? 3 : 2)}%`;
}

export function describeLitecoinError(
  status?: LitecoinNodeStatus | null
): string | undefined {
  if (!status?.error) return undefined;
  switch (status.error.code) {
    case 'not_configured':
      return 'Litecoin monitoring is disabled or not configured.';
    case 'invalid_configuration':
      return 'Litecoin monitoring configuration is invalid.';
    case 'cookie_unavailable':
      return 'Cookie file unavailable.';
    case 'authentication_failed':
      return 'Authentication failed.';
    case 'connection_refused':
      return 'Litecoin Core not reachable.';
    case 'timeout':
      return 'Litecoin RPC request timed out.';
    case 'invalid_response':
      return 'Litecoin RPC returned an invalid response.';
    case 'unsupported_network':
      return 'Incorrect or unsupported network.';
    case 'unsupported_version':
      return 'Unsupported Core version.';
    default:
      return status.error.message || 'Litecoin monitoring unavailable.';
  }
}

export function isLitecoinStatusConnected(
  status?: LitecoinNodeStatus | null
): boolean {
  if (!status?.connected) return false;
  return (
    status.freshness === 'live' ||
    status.freshness === 'cached' ||
    status.freshness === 'stale'
  );
}
