'use strict';

/**
 * This is the single source of truth for IPC operation names and request
 * validation. It intentionally contains no Electron or Node privileged APIs so
 * it can be imported by the main process, preload, and contract tests.
 */

const CHANNELS = Object.freeze({
  paths: Object.freeze({
    getBootstrap: 'paths:get-bootstrap',
  }),
  settings: Object.freeze({
    getInitial: 'settings:get-initial',
    update: 'settings:update',
    getAddressBook: 'settings:get-address-book',
    saveAddressBook: 'settings:save-address-book',
  }),
  theme: Object.freeze({
    getInitial: 'theme:get-initial',
    update: 'theme:update',
    selectWallpaper: 'theme:select-wallpaper',
    importFromDialog: 'theme:import-from-dialog',
    exportToDialog: 'theme:export-to-dialog',
  }),
  dialogs: Object.freeze({
    selectBackupDirectory: 'dialogs:select-backup-directory',
    selectCoreBinary: 'dialogs:select-core-binary',
    selectModuleArchive: 'dialogs:select-module-archive',
    selectModuleDirectory: 'dialogs:select-module-directory',
    selectDevModuleDirectory: 'dialogs:select-dev-module-directory',
  }),
  core: Object.freeze({
    getStatus: 'core:get-status',
    getConfiguration: 'core:get-configuration',
    start: 'core:start',
    kill: 'core:kill',
    resyncLiteDatabase: 'core:resync-lite-database',
    executeConsoleCommand: 'core:execute-console-command',
    subscribeOutput: 'core:subscribe-output',
    unsubscribeOutput: 'core:unsubscribe-output',
  }),
  coreRpc: Object.freeze({
    call: 'core-rpc:call',
    callByUrl: 'core-rpc:call-by-url',
  }),
  bootstrap: Object.freeze({
    start: 'bootstrap:start',
    abort: 'bootstrap:abort',
  }),
  modules: Object.freeze({
    list: 'modules:list',
    inspectInstallSource: 'modules:inspect-install-source',
    install: 'modules:install',
    addDevelopment: 'modules:add-development',
    remove: 'modules:remove',
    downloadAndInstall: 'modules:download-and-install',
    abortDownload: 'modules:abort-download',
    prepareFiles: 'modules:prepare-files',
    getEntry: 'modules:get-entry',
    readStorage: 'modules:read-storage',
    writeStorage: 'modules:write-storage',
    getFeatured: 'modules:get-featured',
    checkUpdates: 'modules:check-updates',
    openFailureLocation: 'modules:open-failure-location',
  }),
  updater: Object.freeze({
    check: 'updater:check',
    quitAndInstall: 'updater:quit-and-install',
    setAllowPrerelease: 'updater:set-allow-prerelease',
    migrateToMainnet: 'updater:migrate-to-mainnet',
    getMarketData: 'updater:get-market-data',
  }),
  fileAssets: Object.freeze({
    readModuleIcon: 'file-assets:read-module-icon',
    fetchExternalIcon: 'file-assets:fetch-external-icon',
    loadRecoveryWords: 'file-assets:load-recovery-words',
    lookupGeoIp: 'file-assets:lookup-geo-ip',
    lookupPublicGeoIp: 'file-assets:lookup-public-geo-ip',
    loadTranslation: 'file-assets:load-translation',
  }),
  app: Object.freeze({
    isForceQuit: 'app:is-force-quit',
    quit: 'app:quit',
    exit: 'app:exit',
    hideWindow: 'app:hide-window',
    hideDock: 'app:hide-dock',
    setOpenOnStart: 'app:set-open-on-start',
    popupContextMenu: 'app:popup-context-menu',
    setMenu: 'app:set-menu',
    openVirtualKeyboard: 'app:open-virtual-keyboard',
    openExternal: 'app:open-external',
    openManagedPath: 'app:open-managed-path',
  }),
});

const EVENTS = Object.freeze({
  bootstrapStatus: 'bootstrap:status',
  coreOutput: 'core:output',
  modules: Object.freeze({
    downloadProgress: 'modules:download-progress',
  }),
  windowClose: 'window-close',
  usageTrackingError: 'usage-tracking-error-relay',
  keyboardInputChange: 'keyboard-input-change',
  keyboardClosed: 'keyboard-closed',
  updater: Object.freeze({
    error: 'updater:error',
    checking: 'updater:checking-for-update',
    available: 'updater:update-available',
    unavailable: 'updater:update-not-available',
    downloadProgress: 'updater:download-progress',
    downloaded: 'updater:update-downloaded',
  }),
});

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'api.dex-trade.com',
  'api.github.com',
  'bootstrap.nexus.io',
  'crypto.nexus.io',
  'github.com',
  'ipwho.is',
  'nexus-featured-modules.netlify.app',
  'nexus.io',
  'raw.githubusercontent.com',
  't.me',
]);

const ALLOWED_THEME_FIELDS = new Set([
  'wallpaper',
  'background',
  'foreground',
  'primary',
  'primaryAccent',
  'danger',
  'dangerAccent',
  'globeColor',
  'globePillarColor',
  'globeArchColor',
  'wallpaperSize',
  'wallpaperBackgroundColor',
  'featuredTokenName',
]);

const ALLOWED_SETTINGS_FIELDS = new Set([
  'locale',
  'minimizeOnClose',
  'openOnStart',
  'autoUpdate',
  'allowPrerelease',
  'sendUsageData',
  'fiatCurrency',
  'minConfirmations',
  'backupDirectory',
  'devMode',
  'verifyModuleSource',
  'fakeTransactions',
  'overviewDisplay',
  'hideOverviewBalances',
  'displayFiatBalance',
  'liteMode',
  'safeMode',
  'enableMining',
  'enableStaking',
  'pooledStaking',
  'multiUser',
  'verboseLevel',
  'avatarMode',
  'ipMineWhitelist',
  'coreDataDir',
  'embeddedCoreBinaryPath',
  'testnetIteration',
  'privateTestnet',
  'allowAdvancedCoreOptions',
  'advancedCoreParams',
  'manualDaemon',
  'manualDaemonIP',
  'manualDaemonApiSSL',
  'manualDaemonApiUser',
  'manualDaemonApiPassword',
  'manualDaemonApiIP',
  'manualDaemonApiPort',
  'manualDaemonApiPortSSL',
  'manualDaemonLogOutOnClose',
  'embeddedCoreUseNonSSL',
  'embeddedCoreApiPort',
  'embeddedCoreApiPortSSL',
  'renderGlobe',
  'addressStyle',
  'disabledModules',
  'allowSymLink',
  'devModulePaths',
  'showUnusedNames',
  'acceptedAgreement',
  'bootstrapSuggestionDisabled',
  'liteModeNoticeDisabled',
  'revertBlocks',
  'walletClean',
  'clearPeers',
  'coreAPIPolicy',
  'firstCreateNewUserShown',
  'consoleCliSyntax',
  'dontAskToStartStaking',
  'lastCheckForUpdates',
]);

function fail(message) {
  throw new TypeError(message);
}

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function assertString(value, name, { min = 0, max = 4096 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(`${name} must be a string between ${min} and ${max} characters`);
  }
  return value;
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') fail(`${name} must be a boolean`);
  return value;
}

function validateNoArguments(value, operationName = 'Operation') {
  if (value !== undefined) {
    fail(`${operationName} does not accept arguments`);
  }
  return undefined;
}

function assertSafeModuleName(value, name = 'Module name') {
  const moduleName = assertString(value, name, { min: 1, max: 80 });
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(moduleName)) {
    fail(`${name} contains unsupported characters`);
  }
  return moduleName;
}

function assertRelativeModulePath(value, name = 'Module file') {
  const relativePath = assertString(value, name, { min: 1, max: 1024 });
  if (
    relativePath.includes('\0') ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[a-z]:/i.test(relativePath) ||
    relativePath.split(/[\\/]+/).includes('..')
  ) {
    fail(`${name} must be a relative module path`);
  }
  return relativePath;
}

function assertExternalUrl(value, name = 'URL', { mailto = false } = {}) {
  const rawUrl = assertString(value, name, { min: 1, max: 2048 });
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail(`${name} must be an absolute URL`);
  }

  if (mailto && parsed.protocol === 'mailto:') return parsed.toString();
  if (parsed.protocol !== 'https:') {
    fail(`${name} protocol is not allowed`);
  }
  if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    fail(`${name} host is not allowed`);
  }
  return parsed.toString();
}

function validateSettingsUpdate(value) {
  const updates = assertRecord(value, 'Settings update');
  const entries = Object.entries(updates);
  if (!entries.length || entries.length > 16) {
    fail('Settings update must contain between 1 and 16 fields');
  }
  const validated = {};
  for (const [key, fieldValue] of entries) {
    if (!ALLOWED_SETTINGS_FIELDS.has(key)) {
      fail(`Unsupported settings field: ${key}`);
    }
    if (
      fieldValue !== undefined &&
      fieldValue !== null &&
      !['string', 'number', 'boolean'].includes(typeof fieldValue) &&
      !Array.isArray(fieldValue)
    ) {
      fail(`Unsupported settings value for ${key}`);
    }
    if (typeof fieldValue === 'string' && fieldValue.length > 4096) {
      fail(`Settings value for ${key} is too long`);
    }
    if (
      key === 'manualDaemonIP' &&
      (typeof fieldValue !== 'string' ||
        !/^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$|^\[[0-9a-fA-F:]+\]$|^[0-9a-fA-F:]+$/.test(
          fieldValue
        ))
    ) {
      fail('Manual daemon host is invalid');
    }
    if (
      ['manualDaemonApiPort', 'manualDaemonApiPortSSL', 'embeddedCoreApiPort', 'embeddedCoreApiPortSSL'].includes(
        key
      ) &&
      fieldValue !== undefined &&
      fieldValue !== '' &&
      (!/^\d{1,5}$/.test(String(fieldValue)) ||
        Number(fieldValue) < 1 ||
        Number(fieldValue) > 65535)
    ) {
      fail(`Settings port for ${key} is invalid`);
    }
    if (
      key === 'manualDaemonApiUser' &&
      (typeof fieldValue !== 'string' || fieldValue.length > 256)
    ) {
      fail('Manual daemon API user is invalid');
    }
    if (
      key === 'manualDaemonApiPassword' &&
      (typeof fieldValue !== 'string' || fieldValue.length > 1024)
    ) {
      fail('Manual daemon API password is invalid');
    }
    if (
      Array.isArray(fieldValue) &&
      (fieldValue.length > 100 ||
        fieldValue.some(
          (item) => typeof item !== 'string' || item.length > 1024
        ))
    ) {
      fail(`Settings array value for ${key} is invalid`);
    }
    validated[key] = fieldValue;
  }
  return validated;
}

function validateThemeUpdate(value) {
  const updates = assertRecord(value, 'Theme update');
  const entries = Object.entries(updates);
  if (!entries.length || entries.length > ALLOWED_THEME_FIELDS.size) {
    fail('Theme update contains an invalid number of fields');
  }
  const validated = {};
  for (const [key, fieldValue] of entries) {
    if (!ALLOWED_THEME_FIELDS.has(key)) {
      fail(`Unsupported theme field: ${key}`);
    }
    if (typeof fieldValue !== 'string' || fieldValue.length > 2048) {
      fail(`Theme field ${key} must be a string of at most 2048 characters`);
    }
    validated[key] = fieldValue;
  }
  return validated;
}

function validateCoreRpcRequest(value) {
  const request = assertRecord(value, 'Core RPC request');
  const endpoint = assertString(request.endpoint, 'Core RPC endpoint', {
    min: 3,
    max: 96,
  });
  if (!/^[a-z]+(?:\/[a-z]+){1,3}$/.test(endpoint)) {
    fail('Core RPC endpoint is invalid');
  }
  const params =
    request.params === undefined ? undefined : assertRecord(request.params, 'Core RPC params');
  if (params && JSON.stringify(params).length > 64 * 1024) {
    fail('Core RPC parameters are too large');
  }
  return { endpoint, params };
}

function validateCoreConsoleCommand(value) {
  const command = assertString(value, 'Core console command', {
    min: 1,
    max: 4096,
  }).trim();
  if (!command || /[\r\n\0]/.test(command)) {
    fail('Core console command is invalid');
  }
  return command;
}

function validateModuleFiles(value) {
  if (!Array.isArray(value) || !value.length || value.length > 10000) {
    fail('Module files must be a non-empty array of at most 10000 paths');
  }
  return value.map((file) => assertRelativeModulePath(file));
}

function validateModuleStorageRequest(value) {
  const request = assertRecord(value, 'Module storage request');
  return {
    name: assertSafeModuleName(request.name),
    data:
      request.data === undefined
        ? undefined
        : assertRecord(request.data, 'Module storage data'),
  };
}

function validateModuleDownloadRequest(value) {
  const request = assertRecord(value, 'Module download request');
  return {
    moduleName: assertSafeModuleName(request.moduleName),
    owner: assertString(request.owner, 'Repository owner', { min: 1, max: 80 }),
    repo: assertString(request.repo, 'Repository name', { min: 1, max: 100 }),
    releaseId:
      request.releaseId === 'latest'
        ? 'latest'
        : Number.isSafeInteger(request.releaseId) && request.releaseId > 0
        ? request.releaseId
        : fail('Release id must be "latest" or a positive integer'),
  };
}

function validateMenuTemplate(value) {
  if (!Array.isArray(value) || value.length > 100) {
    fail('Menu template must contain at most 100 items');
  }
  return value;
}

function result(value) {
  return { ok: true, value };
}

function error(code, message) {
  return { ok: false, error: { code, message } };
}

module.exports = {
  ALLOWED_EXTERNAL_HOSTS,
  CHANNELS,
  EVENTS,
  assertBoolean,
  assertExternalUrl,
  assertRecord,
  assertRelativeModulePath,
  assertSafeModuleName,
  assertString,
  error,
  result,
  validateCoreConsoleCommand,
  validateCoreRpcRequest,
  validateMenuTemplate,
  validateModuleDownloadRequest,
  validateModuleFiles,
  validateModuleStorageRequest,
  validateNoArguments,
  validateSettingsUpdate,
  validateThemeUpdate,
};
