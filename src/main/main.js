import { app, ipcMain, dialog, webContents } from 'electron';
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

const allowedOpenDialogProperties = new Set([
  'openFile',
  'openDirectory',
  'multiSelections',
  'showHiddenFiles',
  'createDirectory',
  'promptToCreate',
  'noResolveAliases',
  'treatPackageAsDirectory',
  'dontAddToRecent',
]);
const allowedAppPathNames = new Set([
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
  'recent',
  'logs',
  'crashDumps',
]);
const allowedMenuRoles = new Set([
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'pasteAndMatchStyle',
  'delete',
  'selectAll',
  'reload',
  'forceReload',
  'toggleDevTools',
  'resetZoom',
  'zoomIn',
  'zoomOut',
  'toggleSpellChecker',
  'toggleFullScreen',
  'window',
  'minimize',
  'close',
  'help',
  'about',
  'services',
  'hide',
  'hideOthers',
  'unhide',
  'quit',
  'showSubstitutions',
  'toggleSmartQuotes',
  'toggleSmartDashes',
  'toggleTextReplacement',
  'startSpeaking',
  'stopSpeaking',
  'front',
  'zoom',
  'toggleTabBar',
  'selectNextTab',
  'selectPreviousTab',
  'showAllTabs',
  'mergeAllWindows',
  'moveTabToNewWindow',
  'windowMenu',
]);

function ensureString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string`);
  }
  return value;
}

function ensureNonEmptyString(value, fieldName) {
  const stringValue = ensureString(value, fieldName).trim();
  if (!stringValue) {
    throw new TypeError(`${fieldName} must not be empty`);
  }
  return stringValue;
}

function ensureStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${fieldName} must be an array of strings`);
  }
  return value;
}

function ensureBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
  return value;
}

function ensureOptionalBoolean(value, fieldName, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ensureBoolean(value, fieldName);
}

function ensureObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function sanitizeDialogFilters(filters) {
  if (filters === undefined) return undefined;
  const filterList = Array.isArray(filters) ? filters : [filters];
  if (filterList.some((filter) => !filter || typeof filter !== 'object')) {
    throw new TypeError('Dialog filters must be an array');
  }
  return filterList.map((filter) => ({
    name: ensureString(filter?.name, 'Dialog filter name'),
    extensions: ensureStringArray(
      filter?.extensions,
      'Dialog filter extensions'
    ),
  }));
}

function sanitizeOpenDialogOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Open dialog options must be an object');
  }
  return {
    title:
      options.title === undefined
        ? undefined
        : ensureString(options.title, 'Dialog title'),
    defaultPath:
      options.defaultPath === undefined
        ? undefined
        : ensureString(options.defaultPath, 'Dialog defaultPath'),
    buttonLabel:
      options.buttonLabel === undefined
        ? undefined
        : ensureString(options.buttonLabel, 'Dialog buttonLabel'),
    properties: (options.properties || []).filter((property) =>
      allowedOpenDialogProperties.has(property)
    ),
    filters: sanitizeDialogFilters(options.filters),
  };
}

function sanitizeSaveDialogOptions(options = {}) {
  const sanitized = sanitizeOpenDialogOptions(options);
  delete sanitized.properties;
  return sanitized;
}

function sanitizeKeyboardOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Keyboard options must be an object');
  }
  return {
    ...options,
    defaultText:
      options.defaultText === undefined
        ? ''
        : ensureString(options.defaultText, 'Keyboard defaultText'),
    placeholder:
      options.placeholder === undefined
        ? ''
        : ensureString(options.placeholder, 'Keyboard placeholder'),
    maskable: !!options.maskable,
  };
}

function sanitizeMenuTemplate(template) {
  if (!Array.isArray(template)) {
    throw new TypeError('Menu template must be an array');
  }

  return template.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Menu item must be an object');
    }

    if (item.type === 'separator') {
      return { type: 'separator' };
    }

    const sanitized = {};
    if (item.id !== undefined) sanitized.id = ensureString(item.id, 'Menu id');
    if (item.label !== undefined) {
      sanitized.label = ensureString(item.label, 'Menu label');
    }
    if (item.accelerator !== undefined) {
      sanitized.accelerator = ensureString(
        item.accelerator,
        'Menu accelerator'
      );
    }
    if (item.role !== undefined && !allowedMenuRoles.has(item.role)) {
      throw new TypeError(`Unsupported menu role: ${item.role}`);
    }
    if (item.role !== undefined) {
      sanitized.role = item.role;
    }
    if (item.enabled !== undefined) {
      sanitized.enabled = !!item.enabled;
    }
    if (item.visible !== undefined) {
      sanitized.visible = !!item.visible;
    }
    if (item.checked !== undefined) {
      sanitized.checked = !!item.checked;
    }
    if (item.click !== undefined) {
      if (typeof item.click !== 'boolean') {
        throw new TypeError('Menu click marker must be a boolean');
      }
      sanitized.click = item.click;
    }
    if (item.submenu !== undefined) {
      sanitized.submenu = sanitizeMenuTemplate(item.submenu);
    }

    return sanitized;
  });
}

function sanitizeWebContentsId(webContentsId) {
  if (webContentsId === undefined || webContentsId === null) return undefined;
  if (!Number.isInteger(webContentsId) || webContentsId < 1) {
    throw new TypeError('webContentsId must be a positive integer');
  }
  const target = webContents.fromId(webContentsId);
  if (
    !target ||
    (target.id !== mainWindow?.webContents.id &&
      target.hostWebContents?.id !== mainWindow?.webContents.id)
  ) {
    throw new Error('webContentsId must belong to the main window');
  }
  return webContentsId;
}

function sanitizeAppPathName(name) {
  const pathName = ensureString(name, 'Path name');
  if (!allowedAppPathNames.has(pathName)) {
    throw new Error(`Unsupported app path: ${pathName}`);
  }
  return pathName;
}

function sanitizeProxyRequest(url, config = {}) {
  const requestURL = ensureNonEmptyString(url, 'Proxy request URL');
  ensureObject(config, 'Proxy request config');
  let parsedURL;
  try {
    parsedURL = new URL(requestURL);
  } catch (err) {
    throw new Error(`Invalid proxy request URL: ${requestURL}`);
  }
  if (!['http:', 'https:'].includes(parsedURL.protocol)) {
    throw new Error(`Unsupported proxy request protocol: ${parsedURL.protocol}`);
  }
  return [requestURL, config];
}

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
  dialog.showOpenDialogSync(mainWindow, sanitizeOpenDialogOptions(options))
);
ipcMain.handle('show-save-dialog', async (event, options) =>
  dialog.showSaveDialogSync(mainWindow, sanitizeSaveDialogOptions(options))
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
ipcMain.handle('open-virtual-keyboard', (event, ...args) => {
  openVirtualKeyboard(sanitizeKeyboardOptions(args[0]));
});

// File server
ipcMain.handle('serve-module-files', (event, ...args) =>
  serveModuleFiles(ensureStringArray(args[0], 'Module files'))
);

// Core
ipcMain.handle('check-core-exists', async () => await coreBinaryExists());
ipcMain.handle('core-binary-status', async () => await coreBinaryStatus());
ipcMain.handle('check-core-running', async () => await isCoreRunning());
ipcMain.handle('start-core', (event, params) =>
  startCore(ensureStringArray(params, 'Core parameters'))
);
ipcMain.handle('kill-core-process', async () => await killCoreProcess());
ipcMain.handle(
  'execute-core-command',
  async (event, command) => await executeCommand(ensureString(command, 'Command'))
);

// Auto update
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates());
ipcMain.handle('quit-and-install-update', (event, isSilent, isForceRunAfter) =>
  autoUpdater.quitAndInstall(
    ensureOptionalBoolean(isSilent, 'isSilent'),
    ensureOptionalBoolean(isForceRunAfter, 'isForceRunAfter')
  )
);
ipcMain.handle('set-allow-prerelease', (event, value) =>
  setAllowPrerelease(ensureBoolean(value, 'allowPrerelease'))
);
ipcMain.handle('migrate-to-mainnet', () => migrateToMainnet());

// Sync message handlers
ipcMain.on('get-path', (event, name) => {
  event.returnValue = app.getPath(sanitizeAppPathName(name));
});
ipcMain.on('get-file-server-domain', (event) => {
  event.returnValue = getDomain();
});

// Modules
ipcMain.handle('proxy-request', (event, url, config) =>
  proxyRequest(...sanitizeProxyRequest(url, config))
);

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
