import { app, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { initialize } from '@aptabase/electron/main';

import { loadSettingsFromFile } from 'lib/settings/universal';
import {
  startCore,
  coreBinaryExists,
  coreBinaryStatus,
  executeCommand,
  isCoreRunning,
  killCoreProcess,
} from './core';
import { getDomain, serveModuleFiles } from './fileServer';
import { createWindow } from './renderer';
import { setupTray } from './tray';
import { setApplicationMenu, popupContextMenu } from './menu';
import { openVirtualKeyboard } from './keyboard';
import {
  initializeUpdater,
  migrateToMainnet,
  setAllowPrerelease,
} from './updater';
import { proxyRequest } from './modules';

let mainWindow;
global.forceQuit = false;
app.setAppUserModelId(APP_ID);
initialize('A-US-0744437796'); // This doesn't send anything so it is safe to fire even if the user has turned tracking off

log.initialize();

const appPathNames = new Set([
  'home',
  'appData',
  'userData',
  'sessionData',
  'temp',
  'exe',
  'module',
  'desktop',
  'documents',
  'downloads',
  'music',
  'pictures',
  'videos',
  'logs',
  'crashDumps',
]);

const isPlainObject = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const sanitizeDialogOptions = (options) => {
  if (options === undefined) return undefined;
  if (!isPlainObject(options)) {
    throw new Error('Dialog options must be an object');
  }
  return options;
};

const sanitizeMenuTemplate = (menuTemplate) => {
  if (!Array.isArray(menuTemplate) && !isPlainObject(menuTemplate)) {
    throw new Error('Menu template must be an object or array');
  }
  return menuTemplate;
};

const sanitizeWebContentsId = (webContentsId) => {
  if (webContentsId === undefined) return undefined;
  if (!Number.isInteger(webContentsId) || webContentsId < 1) {
    throw new Error('webContentsId must be a positive integer');
  }
  return webContentsId;
};

const sanitizeStringArray = (value, name) => {
  const isStringArray =
    Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (!isStringArray) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
};

const sanitizeVirtualKeyboardOptions = (options) => {
  if (!isPlainObject(options)) {
    throw new Error('Virtual keyboard options must be an object');
  }
  return options;
};

// Temporarily add this because there are some errors in autoUpdater.checkForUpdates
// cannot be caught (net::ERR_HTTP_RESPONSE_CODE_FAILURE).
// This should be removed when the issue is resolved.
// A similar issue: https://github.com/electron-userland/electron-builder/issues/2451
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// HANDLERS
// =============================================================================

// App
ipcMain.handle('is-force-quit', async () => global.forceQuit);
ipcMain.handle('quit-app', async () => {
  app.quit();
});
ipcMain.handle('exit-app', () => {
  app.exit();
});
ipcMain.handle('hide-window', () => mainWindow.hide());
ipcMain.handle('hide-dock', () => app.dock.hide());
ipcMain.handle('show-open-dialog', (event, options) =>
  dialog.showOpenDialogSync(mainWindow, sanitizeDialogOptions(options))
);
ipcMain.handle('show-save-dialog', async (event, options) =>
  dialog.showSaveDialogSync(mainWindow, sanitizeDialogOptions(options))
);
ipcMain.handle('popup-context-menu', (event, menuTemplate, webContentsId) =>
  popupContextMenu(
    sanitizeMenuTemplate(menuTemplate),
    sanitizeWebContentsId(webContentsId)
  )
);
ipcMain.handle('set-app-menu', (event, menuTemplate) => {
  setApplicationMenu(sanitizeMenuTemplate(menuTemplate));
});
ipcMain.handle('open-virtual-keyboard', (event, options) => {
  openVirtualKeyboard(sanitizeVirtualKeyboardOptions(options));
});

// File server
ipcMain.handle('serve-module-files', (event, moduleFiles) =>
  serveModuleFiles(sanitizeStringArray(moduleFiles, 'moduleFiles'))
);

// Core
ipcMain.handle('check-core-exists', async () => await coreBinaryExists());
ipcMain.handle('core-binary-status', async () => await coreBinaryStatus());
ipcMain.handle('check-core-running', async () => await isCoreRunning());
ipcMain.handle('start-core', (event, params) =>
  startCore(sanitizeStringArray(params, 'Core parameters'))
);
ipcMain.handle('kill-core-process', async () => await killCoreProcess());
ipcMain.handle(
  'execute-core-command',
  async (event, command) => {
    if (typeof command !== 'string') {
      throw new Error('Core command must be a string');
    }
    return await executeCommand(command);
  }
);

// Auto update
ipcMain.handle('check-for-updates', (event, ...args) =>
  autoUpdater.checkForUpdates(...args)
);
ipcMain.handle('quit-and-install-update', (event, ...args) =>
  autoUpdater.quitAndInstall(...args)
);
ipcMain.handle('set-allow-prerelease', (event, value) =>
  setAllowPrerelease(Boolean(value))
);
ipcMain.handle('migrate-to-mainnet', (event, value) => migrateToMainnet());

// Sync message handlers
ipcMain.on('get-path', (event, name) => {
  if (typeof name !== 'string' || !appPathNames.has(name)) {
    log.warn(`Rejected invalid get-path IPC request: ${String(name)}`);
    event.returnValue = undefined;
    return;
  }
  event.returnValue = app.getPath(name);
});
ipcMain.on('get-file-server-domain', (event) => {
  event.returnValue = getDomain();
});

// Modules
ipcMain.handle('proxy-request', (event, url, config) => {
  if (typeof url !== 'string') {
    throw new Error('Proxy URL must be a string');
  }
  if (config !== undefined && !isPlainObject(config)) {
    throw new Error('Proxy config must be an object');
  }
  return proxyRequest(url, config);
});

// START RENDERER
// =============================================================================
// Ensure only one instance of the wallet is run
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      mainWindow.show();
      if (process.platform === 'darwin') {
        app.dock.show();
      }
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Application Startup
  app.on('ready', async () => {
    const settings = loadSettingsFromFile();
    initializeUpdater(settings);
    global.mainWindow = mainWindow = await createWindow(settings);
    mainWindow.on('close', () => {
      mainWindow.webContents.send('window-close');
    });
    global.tray = setupTray(mainWindow);
  });
}
