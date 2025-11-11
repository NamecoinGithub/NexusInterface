// External
import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import styled from '@emotion/styled';

// Internal
import Panel from 'components/Panel';
import Button from 'components/Button';
import Slider from 'components/Slider';
import Switch from 'components/Switch';
import Icon from 'components/Icon';
import { callAPI } from 'lib/api';
import { showNotification } from 'lib/ui';
import { openErrorDialog } from 'lib/dialog';
import UT from 'lib/usageTracking';
import { consts } from 'styles';

// Icons
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

export default function Mining() {
  const [isMining, setIsMining] = useState(false);
  const [cores, setCores] = useState(1);
  const [maxCores, setMaxCores] = useState(1);
  const [loading, setLoading] = useState(false);
  const [miningStats, setMiningStats] = useState<any>(null);

  const ledgerInfo = useSelector((state: any) => state.core.ledgerInfo);
  const session = useSelector((state: any) => state.user?.session);
  const isLoggedIn = !!session;

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
    const checkMiningStatus = async () => {
      if (!isLoggedIn) return;
      try {
        const status = await callAPI('sessions/status/local', { session });
        setIsMining(status.mining || false);
      } catch (err) {
        console.error('Failed to get mining status:', err);
      }
    };
    checkMiningStatus();
  }, [isLoggedIn, session]);

  const startMining = async () => {
    if (!isLoggedIn) {
      showNotification(__('Please log in to start mining'), 'error');
      return;
    }

    setLoading(true);
    try {
      // Unlock session with mining enabled
      await callAPI('sessions/unlock/local', {
        mining: true,
        notifications: true,
        staking: true, // Keep staking enabled
        session,
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
      // Unlock session with mining disabled but keep staking
      await callAPI('sessions/unlock/local', {
        mining: false,
        notifications: true,
        staking: true, // Keep staking enabled
        session,
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

  return (
    <MiningPage>
      <MiningHeader>
        <MiningIcon icon={workIcon} />
        {__('Mining Control')}
      </MiningHeader>

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
              {__('Number of CPU threads to use for mining (placeholder for future feature)')}
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
              <StatLabel>{__('Mining Channel')}</StatLabel>
              <StatValue>
                {isMining ? __('Prime & Hash') : __('Inactive')}
              </StatValue>
            </StatContent>
          </StatCard>
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
