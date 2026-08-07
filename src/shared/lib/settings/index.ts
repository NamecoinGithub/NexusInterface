import { atom, Atom } from 'jotai';
import { store, subscribeWithPrevious } from 'lib/store';
import {
  defaultSettings,
  settingKeys,
  Settings,
  PartialSettings,
  SettingsKey,
} from './defaultSettings';

const initialUserSettings = window.nexusElectron.settings.getInitial()
  .settings as PartialSettings;
const userSettingsAtom = atom(initialUserSettings);

export const settingsAtom = atom((get) => ({
  ...defaultSettings,
  ...get(userSettingsAtom),
}));

let timerId: ReturnType<typeof setTimeout> | undefined;
/** Resolves when the latest debounced settings patch has been sent to main. */
let persistChain: Promise<void> = Promise.resolve();

subscribeWithPrevious(userSettingsAtom, (settings, previousSettings) => {
  clearTimeout(timerId);
  timerId = setTimeout(() => {
    const updates = Object.fromEntries(
      Object.entries(settings).filter(
        ([key, value]) => previousSettings?.[key as SettingsKey] !== value
      )
    ) as PartialSettings;
    if (Object.keys(updates).length) {
      const pending = window.nexusElectron.settings
        .update(updates)
        .then(() => undefined)
        .catch((error) => {
          console.error(error);
        });
      persistChain = persistChain.then(() => pending);
    }
  }, 0);
});

/**
 * Wait until renderer setting atom changes have been persisted through the
 * settings.update IPC. Used before operations that read main-process settings
 * (for example Litecoin Test connection).
 */
export async function ensureSettingsPersisted(): Promise<void> {
  // Yield twice so any already-queued setTimeout(0) settings subscriber
  // callbacks can enqueue their IPC writes onto persistChain before we await.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  // Re-read the chain after yields so newly appended IPC promises are included.
  await persistChain;
}

type SettingAtoms = {
  [K in SettingsKey]: Atom<Settings[K]>;
};

export const settingAtoms = Object.fromEntries(
  settingKeys.map((key) => [
    key,
    atom(
      (get) => get(settingsAtom)?.[key],
      (get, set, value) => {
        const userSettings = get(userSettingsAtom);
        if (userSettings?.[key] === value) return;
        const updatedUserSettings = {
          ...userSettings,
          [key]: value,
        };
        set(userSettingsAtom, updatedUserSettings);
      }
    ),
  ])
) as unknown as SettingAtoms;

export function updateSettings(updates: PartialSettings) {
  const userSettings = store.get(userSettingsAtom);
  store.set(userSettingsAtom, {
    ...userSettings,
    ...updates,
  });
}

/**
 * Persist the current Litecoin monitoring fields immediately (not debounced)
 * and wait for main-process confirmation. Resets monitor cache on the main side
 * via settings.update. Does not accept host/port/cookie overrides from callers
 * other than the already-validated renderer settings atom.
 */
export async function persistLitecoinMonitoringSettings(
  settings: Pick<
    Settings,
    | 'litecoinMonitoringEnabled'
    | 'litecoinMonitoringHost'
    | 'litecoinMonitoringRpcPort'
    | 'litecoinMonitoringCookiePath'
  >
): Promise<void> {
  await ensureSettingsPersisted();
  await window.nexusElectron.settings.update({
    litecoinMonitoringEnabled: settings.litecoinMonitoringEnabled,
    litecoinMonitoringHost: settings.litecoinMonitoringHost,
    litecoinMonitoringRpcPort: settings.litecoinMonitoringRpcPort,
    litecoinMonitoringCookiePath: settings.litecoinMonitoringCookiePath,
  });
}

export type { Settings, SettingsKey as SettingKeys, PartialSettings };
