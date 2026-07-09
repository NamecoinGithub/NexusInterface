import { contextBridge, ipcRenderer } from 'electron';

const invokeChannels = new Set([
  'is-force-quit',
  'quit-app',
  'exit-app',
  'hide-window',
  'hide-dock',
  'show-open-dialog',
  'show-save-dialog',
  'popup-context-menu',
  'set-app-menu',
  'open-virtual-keyboard',
  'serve-module-files',
  'check-core-exists',
  'core-binary-status',
  'check-core-running',
  'start-core',
  'kill-core-process',
  'execute-core-command',
  'check-for-updates',
  'quit-and-install-update',
  'set-allow-prerelease',
  'migrate-to-mainnet',
  'proxy-request',
  'clipboard-write-text',
  'shell-open-external',
  'shell-open-path',
  'aptabase-track-event',
]);

const sendSyncChannels = new Set(['get-path', 'get-file-server-domain']);
// Keep this list synchronized with main IPC event relays.
const eventChannels = new Set([
  'window-close',
  'usage-tracking-error-relay',
  'keyboard-input-change',
  'keyboard-closed',
  'updater:error',
  'updater:checking-for-update',
  'updater:update-available',
  'updater:update-not-available',
  'updater:download-progress',
  'updater:update-downloaded',
]);

const menuClickPrefix = 'menu-click:';
const menuClickChannelPattern = /^menu-click:[A-Za-z0-9_.-]+$/;

function assertChannel(channel, channels) {
  if (typeof channel !== 'string' || !channels.has(channel)) {
    throw new Error(`IPC channel is not allowed: ${channel}`);
  }
}

function isAllowedEventChannel(channel) {
  return (
    eventChannels.has(channel) ||
    (channel.startsWith(menuClickPrefix) && menuClickChannelPattern.test(channel))
  );
}

const ipc = {
  invoke(channel, ...args) {
    assertChannel(channel, invokeChannels);
    return ipcRenderer.invoke(channel, ...args);
  },
  sendSync(channel, ...args) {
    assertChannel(channel, sendSyncChannels);
    return ipcRenderer.sendSync(channel, ...args);
  },
  on(channel, listener) {
    if (typeof channel !== 'string' || !isAllowedEventChannel(channel)) {
      throw new Error(`IPC channel is not allowed: ${channel}`);
    }
    if (typeof listener !== 'function') {
      throw new Error('IPC listener must be a function');
    }
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  once(channel, listener) {
    if (typeof channel !== 'string' || !isAllowedEventChannel(channel)) {
      throw new Error(`IPC channel is not allowed: ${channel}`);
    }
    if (typeof listener !== 'function') {
      throw new Error('IPC listener must be a function');
    }
    ipcRenderer.once(channel, (_event, ...args) => listener(_event, ...args));
  },
};

contextBridge.exposeInMainWorld('nexusElectron', {
  ipc,
  clipboard: {
    writeText(text) {
      if (typeof text !== 'string') {
        throw new Error('Clipboard text must be a string');
      }
      return ipcRenderer.invoke('clipboard-write-text', text);
    },
  },
  shell: {
    openExternal(url) {
      if (typeof url !== 'string') {
        throw new Error('External URL must be a string');
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('External URL must be a valid absolute URL');
      }
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new Error(`External URL protocol is not allowed: ${parsed.protocol}`);
      }
      return ipcRenderer.invoke('shell-open-external', parsed.toString());
    },
    openPath(targetPath) {
      if (typeof targetPath !== 'string' || !targetPath.trim()) {
        throw new Error('Shell path must be a non-empty string');
      }
      return ipcRenderer.invoke('shell-open-path', targetPath);
    },
  },
  aptabase: {
    trackEvent(eventName, props) {
      if (typeof eventName !== 'string') {
        throw new Error('Aptabase event name must be a string');
      }
      return ipcRenderer.invoke('aptabase-track-event', eventName, props);
    },
  },
});
