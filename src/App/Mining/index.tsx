import { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { useAtomValue } from 'jotai';

import Panel from 'components/Panel';
import Button from 'components/Button';
import Slider from 'components/Slider';
import Icon from 'components/Icon';
import { callAPI } from 'lib/api';
import { showNotification } from 'lib/ui';
import { openErrorDialog } from 'lib/dialog';
import { ledgerInfoQuery } from 'lib/ledger';
import { loggedInAtom } from 'lib/session';
import { useMiner } from 'lib/useMiner';
import UT from 'lib/usageTracking';

import workIcon from 'icons/work.svg';
import hashIcon from 'icons/hash.svg';
import mathIcon from 'icons/math.svg';

__ = __context('Mining');

const MiningPage = styled.div({
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  padding: '2em',
  overflowY: 'auto',
});

const MiningHeader = styled.div(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  marginBottom: '2em',
  fontSize: '1.5em',
  color: theme.mixer(0.875),
}));

const MiningIcon = styled(Icon)({
  marginRight: '0.5em',
});

const ControlPanel = styled(Panel)(({ theme }) => ({
  marginBottom: '1.5em',
  padding: '1.5em',
}));

const ControlRow = styled.div({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '1.5em',
  '&:last-child': {
    marginBottom: 0,
  },
});

const Label = styled.div(({ theme }) => ({
  fontSize: '1em',
  color: theme.mixer(0.75),
  display: 'flex',
  flexDirection: 'column',
}));

const SubLabel = styled.div(({ theme }) => ({
  fontSize: '0.85em',
  color: theme.mixer(0.5),
  marginTop: '0.3em',
}));

const StatsPanel = styled(Panel)(({ theme }) => ({
  padding: '1.5em',
}));

const StatsGrid = styled.div({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '1em',
  marginTop: '1em',
});

const StatCard = styled.div(({ theme }) => ({
  padding: '1em',
  background: theme.mixer(0.125),
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
}));

const StatIcon = styled(Icon)({
  marginRight: '1em',
  opacity: 0.7,
});

const StatContent = styled.div({
  flex: 1,
});

const StatLabel = styled.div(({ theme }) => ({
  fontSize: '0.85em',
  color: theme.mixer(0.5),
  marginBottom: '0.3em',
}));

const StatValue = styled.div(({ theme }) => ({
  fontSize: '1.2em',
  color: theme.mixer(0.875),
  fontWeight: 'bold',
}));

const SliderContainer = styled.div({
  width: '250px',
  display: 'flex',
  alignItems: 'center',
  gap: '1em',
});

const CoreCount = styled.div(({ theme }) => ({
  fontSize: '1.2em',
  color: theme.primary,
  fontWeight: 'bold',
  minWidth: '40px',
  textAlign: 'center',
}));

const ButtonGroup = styled.div({
  display: 'flex',
  gap: '1em',
});

const StatusIndicator = styled.div<{
  status: 'connected' | 'disconnected' | 'error';
}>(({ theme, status }) => ({
  display: 'inline-block',
  width: '12px',
  height: '12px',
  borderRadius: '50%',
  marginRight: '0.5em',
  backgroundColor:
    status === 'connected'
      ? theme.success
      : status === 'error'
        ? theme.danger
        : theme.mixer(0.3),
}));

const ConnectionStatus = styled.div(({ theme }) => ({
  fontSize: '0.9em',
  color: theme.mixer(0.6),
  marginTop: '0.5em',
  display: 'flex',
  alignItems: 'center',
}));

const PaymentAddressPanel = styled(Panel)(({ theme }) => ({
  marginBottom: '1.5em',
  padding: '1.5em',
  background: theme.mixer(0.1),
}));

const GenesisHash = styled.div(({ theme }) => ({
  fontFamily: 'monospace',
  fontSize: '0.95em',
  color: theme.primary,
  padding: '0.75em',
  background: theme.mixer(0.05),
  borderRadius: '4px',
  wordBreak: 'break-all',
  marginTop: '0.75em',
  border: `1px solid ${theme.mixer(0.2)}`,
}));

const InfoText = styled.div(({ theme }) => ({
  fontSize: '0.9em',
  color: theme.mixer(0.6),
  lineHeight: '1.5',
  marginTop: '0.75em',
}));

const ConfigInfo = styled.div(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '0.5em 1em',
  fontSize: '0.9em',
  marginTop: '0.75em',
  padding: '0.75em',
  background: theme.mixer(0.05),
  borderRadius: '4px',
}));

const ConfigLabel = styled.div(({ theme }) => ({
  color: theme.mixer(0.5),
  fontWeight: 'bold',
}));

const ConfigValue = styled.div(({ theme }) => ({
  color: theme.mixer(0.75),
  fontFamily: 'monospace',
}));

export default function Mining() {
  const [isMining, setIsMining] = useState(false);
  const [cores, setCores] = useState(1);
  const [maxCores, setMaxCores] = useState(1);

  const ledgerInfo = ledgerInfoQuery.use();
  const isLoggedIn = useAtomValue(loggedInAtom);

  // Use the miner hook to manage CPU mining with hardcoded configuration
  const {
    isRunning: minerRunning,
    state: minerState,
    stats: minerStats,
    error: minerError,
    genesisHash,
  } = useMiner(isMining, { numThreads: cores });

  // Get CPU core count on mount
  useEffect(() => {
    const getCPUCores = async () => {
      try {
        const systemInfo = await callAPI('system/get/info');
        const cpuCores = systemInfo.cpus || 1;
        setMaxCores(cpuCores);
        setCores(Math.max(1, Math.floor(cpuCores / 2))); // Default to half
      } catch (err) {
        console.error('Failed to get CPU info:', err);
        setMaxCores(4); // Fallback
        setCores(2);
      }
    };
    getCPUCores();
  }, []);

  const startMining = async () => {
    if (!isLoggedIn) {
      showNotification(__('Please log in to start mining'), 'error');
      return;
    }

    if (!genesisHash) {
      showNotification(
        __('Genesis hash not available. Please ensure you are logged in.'),
        'error'
      );
      return;
    }

    try {
      // No PIN required - just start the miner directly
      setIsMining(true);
      showNotification(__('Mining started successfully'), 'success');
      UT.SendEvent('Mining', 'Start');
    } catch (err: any) {
      console.error('Failed to start mining:', err);
      openErrorDialog({
        message: __('Failed to start mining: %{error}', {
          error: err.message || 'Unknown error',
        }),
      });
    }
  };

  const stopMining = async () => {
    if (!isLoggedIn) return;

    try {
      // No PIN required - just stop the miner directly
      setIsMining(false);
      showNotification(__('Mining stopped successfully'), 'success');
      UT.SendEvent('Mining', 'Stop');
    } catch (err: any) {
      console.error('Failed to stop mining:', err);
      openErrorDialog({
        message: __('Failed to stop mining: %{error}', {
          error: err.message || 'Unknown error',
        }),
      });
    }
  };

  const handleCoresChange = (value: number) => {
    if (isMining) {
      showNotification(__('Stop mining to change thread count'), 'warning');
      return;
    }
    setCores(value);
  };

  useEffect(() => {
    UT.SendScreen('Mining');
  }, []);

  return (
    <MiningPage>
      <MiningHeader>
        <MiningIcon icon={workIcon} />
        {__('Mining Control')}
      </MiningHeader>

      {/* Payment Address Section - Shows where mining rewards go */}
      <PaymentAddressPanel title={__('Payment Address')}>
        <SubLabel>
          {__(
            'Mining rewards will be sent to your wallet genesis address (immutable during mining session)'
          )}
        </SubLabel>
        {genesisHash ? (
          <>
            <GenesisHash>{genesisHash}</GenesisHash>
            <ConfigInfo>
              <ConfigLabel>{__('Mining Server:')}</ConfigLabel>
              <ConfigValue>127.0.0.1:{minerStats.port}</ConfigValue>

              <ConfigLabel>{__('Channel:')}</ConfigLabel>
              <ConfigValue>Prime (1)</ConfigValue>

              <ConfigLabel>{__('Port Fallback:')}</ConfigLabel>
              <ConfigValue>Auto (0)</ConfigValue>
            </ConfigInfo>
            <InfoText>
              {__(
                'Configuration loaded from miner.conf file. All mining rewards will automatically be credited to this genesis address.'
              )}
            </InfoText>
          </>
        ) : (
          <InfoText>
            {__(
              'Please log in to see your payment address. You must be logged in to start mining.'
            )}
          </InfoText>
        )}
      </PaymentAddressPanel>

      <ControlPanel title={__('Mining Controls')}>
        <ControlRow>
          <Label>
            {__('Mining Status')}
            <SubLabel>
              {isLoggedIn
                ? isMining
                  ? __('Mining is active')
                  : __('Mining is stopped')
                : __('Please log in to enable mining')}
            </SubLabel>
          </Label>
          <ButtonGroup>
            <Button
              skin="primary"
              onClick={startMining}
              disabled={!isLoggedIn || isMining}
              style={{ minWidth: '100px' }}
            >
              {__('Start Mining')}
            </Button>
            <Button
              skin="danger"
              onClick={stopMining}
              disabled={!isLoggedIn || !isMining}
              style={{ minWidth: '100px' }}
            >
              {__('Stop Mining')}
            </Button>
          </ButtonGroup>
        </ControlRow>

        <ControlRow>
          <Label>
            {__('CPU Threads')}
            <SubLabel>
              {__(
                'Number of CPU worker threads for mining (requires restart to change)'
              )}
            </SubLabel>
          </Label>
          <SliderContainer>
            <Slider
              min={1}
              max={maxCores}
              value={cores}
              onChange={handleCoresChange}
              disabled={!isLoggedIn || isMining}
              style={{ width: '180px' }}
            />
            <CoreCount>
              {cores}/{maxCores}
            </CoreCount>
          </SliderContainer>
        </ControlRow>
      </ControlPanel>

      <StatsPanel title={__('Mining Statistics')}>
        <SubLabel style={{ marginBottom: '1em' }}>
          {__('Real-time mining statistics and connection status')}
        </SubLabel>

        {/* Enhanced connection status with visual indicators */}
        {isMining && (
          <ConnectionStatus>
            <StatusIndicator
              status={
                minerError
                  ? 'error'
                  : minerStats.connected
                    ? 'connected'
                    : 'disconnected'
              }
            />
            {minerError
              ? `${__('Error')}: ${minerError}`
              : minerStats.connected
                ? __('Connected to mining server')
                : __('Connecting to mining server...')}
            {' • '}
            {__('State')}: {minerState}
            {' • '}
            {__('Port')}: {minerStats.port}
          </ConnectionStatus>
        )}

        <StatsGrid>
          <StatCard>
            <StatIcon icon={mathIcon} />
            <StatContent>
              <StatLabel>{__('Prime Difficulty')}</StatLabel>
              <StatValue>
                {ledgerInfo?.prime?.difficulty
                  ? ledgerInfo.prime.difficulty.toFixed(6)
                  : '-'}
              </StatValue>
            </StatContent>
          </StatCard>

          <StatCard>
            <StatIcon icon={hashIcon} />
            <StatContent>
              <StatLabel>{__('Hash Difficulty')}</StatLabel>
              <StatValue>
                {ledgerInfo?.hash?.difficulty
                  ? ledgerInfo.hash.difficulty.toFixed(6)
                  : '-'}
              </StatValue>
            </StatContent>
          </StatCard>

          <StatCard>
            <StatIcon icon={workIcon} />
            <StatContent>
              <StatLabel>{__('Mining Channel')}</StatLabel>
              <StatValue>
                {isMining ? __('Prime & Hash') : __('Inactive')}
              </StatValue>
            </StatContent>
          </StatCard>

          {/* New stats from miner */}
          {isMining && (
            <>
              <StatCard>
                <StatIcon icon={workIcon} />
                <StatContent>
                  <StatLabel>{__('Block Height')}</StatLabel>
                  <StatValue>{minerStats.blockHeight || '-'}</StatValue>
                </StatContent>
              </StatCard>

              <StatCard>
                <StatIcon icon={mathIcon} />
                <StatContent>
                  <StatLabel>{__('Active Workers')}</StatLabel>
                  <StatValue>{minerStats.numWorkers || 0}</StatValue>
                </StatContent>
              </StatCard>

              <StatCard>
                <StatIcon icon={hashIcon} />
                <StatContent>
                  <StatLabel>{__('Hashrate')}</StatLabel>
                  <StatValue>
                    {minerStats.hashrate
                      ? `${minerStats.hashrate.toFixed(0)} H/s`
                      : '-'}
                  </StatValue>
                </StatContent>
              </StatCard>

              <StatCard>
                <StatIcon icon={mathIcon} />
                <StatContent>
                  <StatLabel>{__('Blocks Accepted')}</StatLabel>
                  <StatValue>{minerStats.blocksAccepted}</StatValue>
                </StatContent>
              </StatCard>

              <StatCard>
                <StatIcon icon={hashIcon} />
                <StatContent>
                  <StatLabel>{__('Blocks Rejected')}</StatLabel>
                  <StatValue>{minerStats.blocksRejected}</StatValue>
                </StatContent>
              </StatCard>
            </>
          )}
        </StatsGrid>
      </StatsPanel>

      <Panel
        title={__('Mining Information')}
        style={{ marginTop: '1.5em', padding: '1.5em' }}
      >
        <div style={{ lineHeight: '1.6' }}>
          <p>
            {__(
              'The Nexus Wallet supports CPU mining on the Prime channel through the embedded Nexus Core with zero configuration required.'
            )}
          </p>
          <p style={{ marginTop: '1em' }}>
            {__(
              'Mining allows you to earn NXS by contributing computational power to secure the Nexus blockchain. All rewards are automatically sent to your genesis address.'
            )}
          </p>
          <p style={{ marginTop: '1em' }}>
            <strong>{__('Key Features:')}</strong>
          </p>
          <ul style={{ marginLeft: '1.5em', marginTop: '0.5em' }}>
            <li>
              {__('Configuration from miner.conf with sensible defaults')}
            </li>
            <li>{__('Auto port selection with fallback support')}</li>
            <li>{__('Automatic reconnection with exponential backoff')}</li>
            <li>{__('Genesis hash validation against Nexus Node')}</li>
            <li>{__('Optimized worker thread allocation')}</li>
            <li>{__('Verbose stats for debugging and monitoring')}</li>
            <li>{__('No PIN required for mining start/stop')}</li>
          </ul>
          <p style={{ marginTop: '1em' }}>
            {__(
              'For GPU mining on the Hash channel, please use standalone mining software like NexusMiner.'
            )}
          </p>
        </div>
      </Panel>
    </MiningPage>
  );
}
