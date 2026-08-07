// External
import { useAtomValue } from 'jotai';
import styled from '@emotion/styled';

// Internal
import {
  describeLitecoinConnection,
  formatSyncPercent,
  litecoinMonitoringEnabledAtom,
  litecoinNodeStatusQuery,
  type LitecoinNodeStatus,
} from 'lib/externalChains/litecoin';
import { formatNumber } from 'lib/intl';
import linkIcon from 'icons/link.svg';
import nxsblocksIcon from 'icons/blockexplorer-invert-white.svg';
import Connections0 from 'icons/Connections0.svg';
import syncingIcon from 'icons/syncing.svg';

import Stat from './Stat';

__ = __context('Overview');

const SectionLabel = styled.div(({ theme }) => ({
  fontWeight: 'bold',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  fontSize: '.75em',
  color: theme.mixer(0.6),
  marginTop: '1.2em',
  marginBottom: '-0.4em',
  opacity: 0.9,
}));

function networkLabel(network?: string) {
  switch (network) {
    case 'main':
      return __('Mainnet');
    case 'test':
      return __('Testnet');
    case 'regtest':
      return __('Regtest');
    case 'unknown':
      return __('Unknown');
    default:
      return 'N/A';
  }
}

function statusText(status?: LitecoinNodeStatus | null) {
  switch (describeLitecoinConnection(status)) {
    case 'connected':
    case 'cached':
      return __('Connected');
    case 'stale':
      return status?.fetchedAt
        ? __('Stale — last successful probe at %{time}', {
            time: status.fetchedAt,
          })
        : __('Stale — last successful probe');
    case 'unavailable':
    default:
      return __('Unavailable');
  }
}

function statusTooltip(status?: LitecoinNodeStatus | null) {
  if (status?.freshness === 'stale') {
    const base = status.fetchedAt
      ? __(
          'Stale — showing retained metrics from the last successful probe at %{time}. The node is not currently reachable.',
          { time: status.fetchedAt }
        )
      : __(
          'Stale — showing retained metrics from the last successful probe. The node is not currently reachable.'
        );
    return status.error?.message ? `${base} ${status.error.message}` : base;
  }
  return (
    status?.warning?.message ||
    status?.error?.message ||
    __('User-managed Litecoin Core monitoring only')
  );
}

/**
 * Optional Overview card for Litecoin node monitoring.
 * Independent of Nexus Core connection; uses waitForCore={false}.
 */
export function LitecoinNodeStats() {
  const enabled = useAtomValue(litecoinMonitoringEnabledAtom);
  litecoinNodeStatusQuery.use();
  const status = useAtomValue(litecoinNodeStatusQuery.valueAtom);

  if (!enabled) {
    return null;
  }

  const blocksText =
    typeof status?.blocks === 'number' && typeof status?.headers === 'number'
      ? `${formatNumber(status.blocks, 0)} / ${formatNumber(status.headers, 0)}`
      : typeof status?.blocks === 'number'
      ? formatNumber(status.blocks, 0)
      : 'N/A';

  return (
    <>
      <SectionLabel>{__('Litecoin Node')}</SectionLabel>
      <Stat
        label={__('LTC status')}
        icon={linkIcon}
        waitForCore={false}
        tooltip={statusTooltip(status)}
      >
        {statusText(status)}
        {status?.network ? ` · ${networkLabel(status.network)}` : ''}
      </Stat>
      <Stat label={__('LTC blocks')} icon={nxsblocksIcon} waitForCore={false}>
        {blocksText}
      </Stat>
      <Stat label={__('LTC sync')} icon={syncingIcon} waitForCore={false}>
        {formatSyncPercent(status?.verificationProgress)}
      </Stat>
      <Stat label={__('LTC peers')} icon={Connections0} waitForCore={false}>
        {typeof status?.connections === 'number' ? status.connections : 'N/A'}
      </Stat>
    </>
  );
}
