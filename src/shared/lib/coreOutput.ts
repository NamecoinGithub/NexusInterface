import { atom } from 'jotai';

import { store, subscribe } from 'lib/store';
import { coreConnectedAtom } from 'lib/coreInfo';
import { settingsAtom } from 'lib/settings';

export const coreOutputAtom = atom<string[]>([]);
export const coreOutputPausedAtom = atom<boolean>(false);

let unsubscribeOutput: (() => void) | undefined;

export function togglePaused(): void {
  store.set(coreOutputPausedAtom, (paused) => !paused);
}

function printCoreOutput(output: string[]): void {
  if (store.get(coreOutputPausedAtom)) return;
  store.set(coreOutputAtom, (currentOutput) =>
    [...output, ...currentOutput].slice(0, 1000)
  );
}

export function stopCoreOuputWatch(): void {
  unsubscribeOutput?.();
  unsubscribeOutput = undefined;
  void window.nexusElectron.core.unsubscribeOutput();
  store.set(coreOutputAtom, []);
}

subscribe(coreConnectedAtom, (coreConnected) => {
  if (!coreConnected || store.get(settingsAtom).manualDaemon) {
    stopCoreOuputWatch();
    return;
  }
  unsubscribeOutput?.();
  unsubscribeOutput = window.nexusElectron.core.onOutput(printCoreOutput);
  void window.nexusElectron.core.subscribeOutput().catch((error) => {
    console.error(error);
    unsubscribeOutput?.();
    unsubscribeOutput = undefined;
  });
});
