import { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { useAtomValue } from 'jotai';

import Panel from 'components/Panel';
import Button from 'components/Button';
import Slider from 'components/Slider';
import Icon from 'components/Icon';
import { callAPI } from 'lib/api';
import { showNotification } from 'lib/ui';
import { openErrorDialog, confirmPin } from 'lib/dialog';
import { ledgerInfoQuery } from 'lib/ledger';
import { loggedInAtom, activeSessionIdAtom, userStatusQuery } from 'lib/session';
import { store } from 'lib/store';
import { settingsAtom, updateSettings } from 'lib/settings';
import { restartCore } from 'lib/core';
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

const WarningBanner = styled.div(({ theme }) => ({
  background: theme.mixer(0.15),
  border: `2px solid ${theme.danger}`,
  borderRadius: '4px',
  padding: '1.5em',
  marginBottom: '1.5em',
  display: 'flex',
  flexDirection: 'column',
  gap: '1em',
}));

const WarningTitle = styled.div(({ theme }) => ({
  fontSize: '1.2em',
  fontWeight: 'bold',
  color: theme.danger,
  display: 'flex',
  alignItems: 'center',
  gap: '0.5em',
}));

const WarningContent = styled.div(({ theme }) => ({
  color: theme.mixer(0.75),
  lineHeight: '1.6',
}));

const WarningList = styled.ul(({ theme }) => ({
  margin: '0.5em 0',
  paddingLeft: '2em',
  color: theme.mixer(0.75),
}));

const WarningActions = styled.div({
  display: 'flex',
  gap: '1em',
  marginTop: '0.5em',
});

export default function Mining() {
  const [isMining, setIsMining] = useState(false);
  const [cores, setCores] = useState(1);
  const [maxCores, setMaxCores] = useState(1);
  const [loading, setLoading] = useState(false);
  const [configuringSettings, setConfiguringSettings] = useState(false);

  const ledgerInfo = ledgerInfoQuery.use();
  const sessionId = useAtomValue(activeSessionIdAtom);
  const isLoggedIn = useAtomValue(loggedInAtom);
  const userStatus = useAtomValue(userStatusQuery.valueAtom);
  const settings = useAtomValue(settingsAtom);

  // Check for incompatible core settings
  const hasIncompatibleSettings = 
    settings.liteMode || settings.multiUser || !settings.enableMining;

  const getConfigurationIssues = () => {
    const issues = [];
    if (settings.liteMode) issues.push(__('Lite mode is enabled'));
    if (settings.multiUser) issues.push(__('Multi-user mode is enabled'));
    if (!settings.enableMining) issues.push(__('Mining is disabled in core settings'));
    return issues;
  };

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

  // Check current mining status
  useEffect(() => {
    if (userStatus?.unlocked) {
      setIsMining(userStatus.unlocked.mining || false);
    }
  }, [userStatus]);

  // Auto-refresh statistics every 30 seconds while mining
  useEffect(() => {
    if (!isMining) return;

    const interval = setInterval(() => {
      ledgerInfoQuery.refetch();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [isMining]);

  const startMining = async () => {
    if (!isLoggedIn) {
      showNotification(__('Please log in to start mining'), 'error');
      return;
    }

    // Check for incompatible settings
    if (hasIncompatibleSettings) {
      showNotification(
        __('Please configure mining settings first'),
        'error'
      );
      return;
    }

    setLoading(true);
    try {
      // Request PIN authentication
      const pin = await confirmPin({
        note: __('Enter your PIN to start mining'),
      });

      if (!pin) {
        showNotification(__('Mining start cancelled'), 'info');
        setLoading(false);
        return;
      }

      // Unlock session with mining enabled
      await callAPI('sessions/unlock/local', {
        pin,
        mining: true,
        notifications: true,
        staking: userStatus?.unlocked?.staking || false, // Preserve staking state
        session: sessionId || undefined,
      });

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
    } finally {
      setLoading(false);
    }
  };

  const stopMining = async () => {
    if (!isLoggedIn) return;

    setLoading(true);
    try {
      // Request PIN authentication
      const pin = await confirmPin({
        note: __('Enter your PIN to stop mining'),
      });

      if (!pin) {
        showNotification(__('Mining stop cancelled'), 'info');
        setLoading(false);
        return;
      }

      // Unlock session with mining disabled but preserve staking
      await callAPI('sessions/unlock/local', {
        pin,
        mining: false,
        notifications: true,
        staking: userStatus?.unlocked?.staking || false, // Preserve staking state
        session: sessionId || undefined,
      });

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
    } finally {
      setLoading(false);
    }
  };

  const handleCoresChange = (value: number) => {
    setCores(value);
    // Note: The Nexus Core doesn't currently support dynamic thread count changes
    // This is a UI placeholder for future functionality
  };

  const configureSettings = async () => {
    setConfiguringSettings(true);
    try {
      // Update settings to enable mining
      updateSettings({
        enableMining: true,
        liteMode: false,
        multiUser: false,
      });

      showNotification(
        __('Settings updated. Restarting core...'),
        'info'
      );

      // Restart core to apply changes
      await restartCore();

      showNotification(
        __('Core restarted successfully. Mining is now available.'),
        'success'
      );
      UT.SendEvent('Mining', 'ConfigureSettings');
    } catch (err: any) {
      console.error('Failed to configure settings:', err);
      openErrorDialog({
        message: __('Failed to configure settings: %{error}', {
          error: err.message || 'Unknown error',
        }),
      });
    } finally {
      setConfiguringSettings(false);
    }
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

      {hasIncompatibleSettings && (
        <WarningBanner>
          <WarningTitle>
            <Icon icon={workIcon} />
            {__('Mining Configuration Required')}
          </WarningTitle>
          <WarningContent>
            {__('Mining cannot be started due to the following configuration issues:')}
            <WarningList>
              {getConfigurationIssues().map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </WarningList>
            {__('Click the button below to automatically configure the correct settings and restart the core.')}
          </WarningContent>
          <WarningActions>
            <Button
              skin="primary"
              onClick={configureSettings}
              disabled={configuringSettings}
            >
              {configuringSettings 
                ? __('Configuring...') 
                : __('Configure Mining Settings')}
            </Button>
            <Button
              skin="default"
              onClick={() => {
                // Navigate to Settings/Core page
                window.location.hash = '#/settings/core';
              }}
            >
              {__('Go to Core Settings')}
            </Button>
          </WarningActions>
        </WarningBanner>
      )}

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
              disabled={!isLoggedIn || isMining || loading}
              style={{ minWidth: '100px' }}
            >
              {loading && !isMining ? __('Starting...') : __('Start Mining')}
            </Button>
            <Button
              skin="danger"
              onClick={stopMining}
              disabled={!isLoggedIn || !isMining || loading}
              style={{ minWidth: '100px' }}
            >
              {loading && isMining ? __('Stopping...') : __('Stop Mining')}
            </Button>
          </ButtonGroup>
        </ControlRow>

        <ControlRow>
          <Label>
            {__('CPU Threads')}
            <SubLabel>
              {__(
                'Number of CPU threads to use for mining (placeholder for future feature)'
              )}
            </SubLabel>
          </Label>
          <SliderContainer>
            <Slider
              min={1}
              max={maxCores}
              value={cores}
              onChange={handleCoresChange}
              disabled={!isLoggedIn}
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
          {__(
            'Real-time mining difficulty statistics for Prime and Hash channels'
          )}
        </SubLabel>
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
              <StatLabel>{__('Mining Status')}</StatLabel>
              <StatValue>
                {isMining ? __('Active') : __('Inactive')}
              </StatValue>
            </StatContent>
          </StatCard>

          {ledgerInfo?.prime?.hashrate && (
            <StatCard>
              <StatIcon icon={mathIcon} />
              <StatContent>
                <StatLabel>{__('Prime Hashrate')}</StatLabel>
                <StatValue>
                  {ledgerInfo.prime.hashrate.toFixed(2)} {__('H/s')}
                </StatValue>
              </StatContent>
            </StatCard>
          )}

          {ledgerInfo?.hash?.hashrate && (
            <StatCard>
              <StatIcon icon={hashIcon} />
              <StatContent>
                <StatLabel>{__('Hash Hashrate')}</StatLabel>
                <StatValue>
                  {ledgerInfo.hash.hashrate.toFixed(2)} {__('H/s')}
                </StatValue>
              </StatContent>
            </StatCard>
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
              'The Nexus Wallet supports CPU mining on the Prime and Hash channels through the embedded Nexus Core.'
            )}
          </p>
          <p style={{ marginTop: '1em' }}>
            {__(
              'Mining allows you to earn NXS by contributing computational power to secure the Nexus blockchain. You can mine and stake simultaneously while logged in.'
            )}
          </p>
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
