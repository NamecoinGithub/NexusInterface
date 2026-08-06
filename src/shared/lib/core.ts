import { store } from 'lib/store';
import { coreConfigAtom } from 'lib/coreConfig';
import { coreInfoPausedAtom } from 'lib/coreInfo';
import { callAPI } from 'lib/api';
import { settingsAtom } from 'lib/settings';
import sleep from 'utils/sleep';

/**
 * Start Nexus Core
 */
export const startCore = async () => {
  // Check remote core mode
  const settings = store.get(settingsAtom);
  if (settings.manualDaemon) {
    console.info('Core Manager: Remote Core mode, skipping starting core');
    // Still load public connection metadata for UI consumers.
    store.set(
      coreConfigAtom,
      await window.nexusElectron.core.getConfiguration()
    );
    store.set(coreInfoPausedAtom, false);
    return;
  }

  const status = (await window.nexusElectron.core.getStatus()) as {
    exists?: boolean;
    running?: boolean;
    status?: { error?: string };
  };
  if (!status.exists) {
    throw new Error(status.status?.error || 'Nexus Core binary not found');
  }

  // Always delegate to main. If a Core process is already running, main probes
  // the configured local API and restarts Core when P2P is up but the API bind
  // / auth / port does not match the wallet configuration.
  const startResult = (await window.nexusElectron.core.start()) as {
    started?: boolean;
    reason?: string;
    apiReachable?: boolean;
  };
  if (status.running && startResult?.reason === 'already-running') {
    console.info(
      'Core Manager: Nexus Core Process already running with a reachable API'
    );
  } else if (startResult?.started) {
    console.info('Core Manager: Nexus Core start requested by wallet');
  }

  store.set(coreConfigAtom, await window.nexusElectron.core.getConfiguration());
  store.set(coreInfoPausedAtom, false);
};

/**
 * Stop Nexus Core
 */
export const stopCore = async (forRestart?: boolean) => {
  console.info('Core Manager: Stop function called');
  const { manualDaemon } = store.get(settingsAtom);
  try {
    await callAPI('system/stop');

    // Wait for core to gracefully stop for 10 seconds
    let coreStillRunning;
    for (let i = 0; i < 10; i++) {
      const coreStatus = (await window.nexusElectron.core.getStatus()) as {
        running?: boolean;
      };
      coreStillRunning = !!coreStatus.running;
      if (coreStillRunning) {
        console.info(
          `Core Manager: Core still running after stop command for: ${i} seconds`
        );
      } else {
        console.info(`Core Manager: Core stopped gracefully.`);
        break;
      }
      await sleep(1000);
    }

    if (coreStillRunning) {
      await window.nexusElectron.core.kill();
    }
  } catch (err) {}

  if (!forRestart && !manualDaemon) {
    store.set(coreInfoPausedAtom, true);
  }
};

/**
 * Restart Nexus Core
 */
export const restartCore = async () => {
  await stopCore(true);
  await startCore();
  store.set(coreInfoPausedAtom, false);
};
