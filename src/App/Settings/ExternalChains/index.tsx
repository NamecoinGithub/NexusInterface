// External
import { useState } from 'react';
import { useAtomValue } from 'jotai';
import styled from '@emotion/styled';

// Internal
import {
  updateSettings,
  settingsAtom,
  persistLitecoinMonitoringSettings,
} from 'lib/settings';
import {
  describeLitecoinError,
  formatLitecoinVersion,
  formatSyncPercent,
  isLitecoinStatusConnected,
  litecoinNodeStatusQuery,
  type LitecoinNodeStatus,
} from 'lib/externalChains/litecoin';
import SettingsField from 'components/SettingsField';
import Switch from 'components/Switch';
import Button from 'components/Button';
import Select from 'components/Select';
import { TextField } from 'components/TextField';
import FieldSet from 'components/FieldSet';
import InfoField from 'components/InfoField';
import Icon from 'components/Icon';
import warningIcon from 'icons/warning.svg';
import * as form from 'lib/form';

import { useSettingsTab } from '../atoms';

__ = __context('Settings.ExternalChains');

const WarningBox = styled.div(({ theme }) => ({
  display: 'flex',
  gap: '0.75em',
  alignItems: 'flex-start',
  padding: '0.9em 1em',
  margin: '0.5em 0 1.25em',
  borderRadius: 4,
  border: `1px solid ${theme.raise(theme.danger, 0.15)}`,
  background: theme.lower(theme.background, 0.15),
  color: theme.foreground,
  lineHeight: 1.45,
}));

const WarningIcon = styled(Icon)(({ theme }) => ({
  color: theme.raise(theme.danger, 0.3),
  fontSize: '1.25em',
  flex: '0 0 auto',
  marginTop: 2,
}));

const StatusPanel = styled.div(({ theme }) => ({
  marginTop: '1em',
  padding: '0.75em 0',
  color: theme.mixer(0.9),
}));

const ErrorText = styled.div(({ theme }) => ({
  color: theme.raise(theme.danger, 0.25),
  marginTop: '0.75em',
  lineHeight: 1.4,
}));

const WarningText = styled.div(({ theme }) => ({
  color: theme.raise(theme.primary, 0.1),
  marginTop: '0.75em',
  lineHeight: 1.4,
}));

const hostOptions = [
  { value: '127.0.0.1', display: '127.0.0.1' },
  { value: '::1', display: '::1 (IPv6 loopback)' },
];

function networkLabel(network?: LitecoinNodeStatus['network']) {
  switch (network) {
    case 'main':
      return __('Mainnet');
    case 'test':
      return __('Testnet');
    case 'regtest':
      return __('Regtest');
    case 'unknown':
      return __('Unknown network');
    default:
      return 'N/A';
  }
}

function connectionLabel(status?: LitecoinNodeStatus) {
  if (!status) return __('Unknown');
  if (isLitecoinStatusConnected(status)) {
    return __('Connected');
  }
  return __('Unavailable');
}

export default function SettingsExternalChains() {
  useSettingsTab('ExternalChains');
  const settings = useAtomValue(settingsAtom);
  const status = litecoinNodeStatusQuery.use();
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<LitecoinNodeStatus | null>(null);
  const [testError, setTestError] = useState<string | undefined>();

  const updateHandlers = (settingName: string) => (input: any) =>
    updateSettings({ [settingName]: form.resolveValue(input) });

  const browseCookie = async () => {
    const filePaths =
      await window.nexusElectron.dialogs.selectLitecoinCookie();
    if (filePaths && filePaths.length > 0) {
      updateSettings({ litecoinMonitoringCookiePath: filePaths[0] });
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestError(undefined);
    try {
      // Persist validated Litecoin settings to main before probing. The
      // no-argument getStatus IPC correctly reads main-process settings only;
      // flushing avoids testing a stale cookie/port still on disk.
      await persistLitecoinMonitoringSettings(settings);
      const result =
        await window.nexusElectron.externalChains.litecoin.getStatus();
      setTestStatus(result as LitecoinNodeStatus);
      await litecoinNodeStatusQuery.refetch();
    } catch (err) {
      setTestStatus(null);
      setTestError(__('Unable to query Litecoin monitoring status.'));
      console.error(err);
    } finally {
      setTesting(false);
    }
  };

  const displayedStatus = testStatus || status;
  const errorMessage =
    testError || describeLitecoinError(displayedStatus || undefined);

  return (
    <>
      <WarningBox>
        <WarningIcon icon={warningIcon} />
        <div>
          {__(
            'Nexus Wallet does not manage Litecoin Core, wallets, keys, transactions, or funds.'
          )}{' '}
          {__(
            'You must install and run Litecoin Core yourself. This panel only monitors a local loopback RPC endpoint you configure.'
          )}
        </div>
      </WarningBox>

      <FieldSet legend={__('Litecoin Core monitoring')}>
        <SettingsField
          connectLabel
          label={__('Enable Litecoin monitoring')}
          subLabel={__(
            'Poll a user-managed local Litecoin Core node for read-only status. Never starts or stops Litecoin Core.'
          )}
        >
          <Switch
            checked={settings.litecoinMonitoringEnabled}
            onCheckedChange={updateHandlers('litecoinMonitoringEnabled')}
          />
        </SettingsField>

        <SettingsField
          connectLabel
          label={__('RPC host')}
          subLabel={__(
            'Loopback only in this release. Remote, LAN, Tor, and DNS hosts are not supported.'
          )}
        >
          {(inputId) => (
            <Select
              id={inputId}
              value={settings.litecoinMonitoringHost}
              onChange={(value) => {
                if (value === '127.0.0.1' || value === '::1') {
                  updateSettings({ litecoinMonitoringHost: value });
                }
              }}
              options={hostOptions}
            />
          )}
        </SettingsField>

        <SettingsField
          connectLabel
          label={__('RPC port')}
          subLabel={__('Default Litecoin mainnet RPC port is 9332.')}
        >
          {(inputId) => (
            <TextField
              id={inputId}
              value={settings.litecoinMonitoringRpcPort}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, '').slice(0, 5);
                updateSettings({ litecoinMonitoringRpcPort: next });
              }}
              placeholder="9332"
              size={8}
            />
          )}
        </SettingsField>

        <SettingsField
          connectLabel
          label={__('Cookie file')}
          subLabel={__(
            'Select the Litecoin Core .cookie file. Cookie contents never leave the main process.'
          )}
        >
          {(inputId) => (
            <div className="flex stretch">
              <TextField
                id={inputId}
                value={settings.litecoinMonitoringCookiePath}
                readOnly
                placeholder={__('No cookie file selected')}
                style={{ flexGrow: 1 }}
              />
              <Button
                fitHeight
                onClick={browseCookie}
                style={{ marginLeft: '1em' }}
              >
                {__('Browse')}
              </Button>
            </div>
          )}
        </SettingsField>

        <div className="mt1 flex center" style={{ gap: '0.75em' }}>
          <Button
            skin="primary"
            disabled={testing || !settings.litecoinMonitoringEnabled}
            onClick={testConnection}
          >
            {testing ? __('Testing…') : __('Test connection')}
          </Button>
        </div>

        <StatusPanel>
          <InfoField label={__('Status')}>
            {connectionLabel(displayedStatus)}
            {displayedStatus?.freshness &&
            displayedStatus.freshness !== 'unavailable'
              ? ` (${__(displayedStatus.freshness)})`
              : ''}
          </InfoField>
          <InfoField label={__('Network')}>
            {networkLabel(displayedStatus?.network)}
          </InfoField>
          <InfoField label={__('Version')}>
            {formatLitecoinVersion(displayedStatus?.version)}
          </InfoField>
          <InfoField label={__('Blocks / headers')}>
            {typeof displayedStatus?.blocks === 'number'
              ? displayedStatus.blocks
              : 'N/A'}
            {' / '}
            {typeof displayedStatus?.headers === 'number'
              ? displayedStatus.headers
              : 'N/A'}
          </InfoField>
          <InfoField label={__('Sync')}>
            {formatSyncPercent(displayedStatus?.verificationProgress)}
            {displayedStatus?.initialBlockDownload
              ? ` (${__('initial block download')})`
              : ''}
          </InfoField>
          <InfoField label={__('Peers')}>
            {typeof displayedStatus?.connections === 'number'
              ? displayedStatus.connections
              : 'N/A'}
          </InfoField>
          <InfoField label={__('Mempool')}>
            {typeof displayedStatus?.mempoolTransactions === 'number'
              ? __('%{count} txs', {
                  count: displayedStatus.mempoolTransactions,
                })
              : 'N/A'}
            {typeof displayedStatus?.mempoolBytes === 'number'
              ? ` / ${displayedStatus.mempoolBytes} B`
              : ''}
          </InfoField>
          <InfoField label={__('Last update')}>
            {displayedStatus?.fetchedAt || 'N/A'}
          </InfoField>

          {displayedStatus?.warning && (
            <WarningText>{displayedStatus.warning.message}</WarningText>
          )}
          {errorMessage && <ErrorText>{errorMessage}</ErrorText>}
        </StatusPanel>
      </FieldSet>
    </>
  );
}
