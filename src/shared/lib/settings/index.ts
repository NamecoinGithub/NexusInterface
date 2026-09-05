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
let persistedSettings = initialUserSettings;
let persistenceQueue = Promise.resolve();
let pendingPersistenceWaiters: Array<{
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];
subscribeWithPrevious(userSettingsAtom, () => {
  clearTimeout(timerId);
  timerId = setTimeout(async () => {
    const waiters = pendingPersistenceWaiters;
    pendingPersistenceWaiters = [];
    let failedUpdates: PartialSettings = {};
    persistenceQueue = persistenceQueue
      .catch(() => {})
      .then(async () => {
        let updates: PartialSettings = {};
        do {
          const latestSettings = store.get(userSettingsAtom);
          updates = Object.fromEntries(
            Object.entries(latestSettings).filter(
              ([key, value]) =>
                persistedSettings?.[key as SettingsKey] !== value
            )
          ) as PartialSettings;
          if (!Object.keys(updates).length) break;

          failedUpdates = updates;
          await window.nexusElectron.settings.update(updates);
          persistedSettings = { ...persistedSettings, ...updates };
        } while (Object.keys(updates).length);
      })
      .catch((error) => {
        const currentSettings = store.get(userSettingsAtom);
        const rolledBackSettings = { ...currentSettings };
        let changed = false;
        Object.entries(failedUpdates).forEach(([key, value]) => {
          const settingsKey = key as SettingsKey;
          if (currentSettings[settingsKey] !== value) return;
          if (Object.prototype.hasOwnProperty.call(persistedSettings, key)) {
            rolledBackSettings[settingsKey] = persistedSettings[settingsKey];
          } else {
            delete rolledBackSettings[settingsKey];
          }
          changed = true;
        });
        if (changed) store.set(userSettingsAtom, rolledBackSettings);
        throw error;
      });
    try {
      await persistenceQueue;
    } catch (error) {
      console.error(error);
      waiters.forEach(({ reject }) => reject(error));
      return;
    }
    waiters.forEach(({ resolve }) => resolve());
  }, 0);
});

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
  const persisted = new Promise<void>((resolve, reject) => {
    pendingPersistenceWaiters.push({ resolve, reject });
  });
  persisted.catch(() => {});
  const userSettings = store.get(userSettingsAtom);
  store.set(userSettingsAtom, {
    ...userSettings,
    ...updates,
  });
  return persisted;
}

export type { Settings, SettingsKey as SettingKeys, PartialSettings };
