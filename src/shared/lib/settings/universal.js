/**
 * Settings functionalities that can be used by both
 * renderer process and main process code
 */

import path from 'path';
import crypto from 'crypto';
import macaddress from 'macaddress';
import { homeDir, settingsFilePath, defaultCoreDataDir } from 'consts/paths';
import { readJson, writeJson } from 'utils/json';

const defaultBackupDir = path.join(homeDir, '/NexusBackups');

const secret =
  process.platform === 'darwin'
    ? process.env.USER + process.env.HOME + process.env.SHELL
    : JSON.stringify(macaddress.networkInterfaces(), null, 2);
const defaultPassword = crypto
  .createHmac('sha256', secret)
  .update('pass')
  .digest('hex');

export const defaultSettings = {
  // App
  locale: null,
  minimizeOnClose: false,
  openOnStart: false,
  autoUpdate: true,
  allowPrerelease: false,
  sendUsageData: true,
  fiatCurrency: 'USD',
  minConfirmations: 3,
  backupDirectory: defaultBackupDir,
  devMode: false,
  verifyModuleSource: true,
  fakeTransactions: false,
  overviewDisplay: 'standard',
  hideOverviewBalances: false,
  displayFiatBalance: false,

  // Core
  liteMode: false,
  safeMode: true,
  enableMining: false,
  enableStaking: true,
  pooledStaking: false,
  multiUser: false,
  verboseLevel: 0,
  avatarMode: true,
  ipMineWhitelist: '',
  coreDataDir: defaultCoreDataDir,
  testnetIteration: 0,
  manualDaemon: false,
  manualDaemonSSL: true,
  manualDaemonUser: 'rpcserver',
  manualDaemonPassword: defaultPassword,
  manualDaemonIP: '127.0.0.1',
  manualDaemonPort: '9336',
  manualDaemonPortSSL: '7336',
  manualDaemonApiSSL: true,
  manualDaemonApiUser: 'apiserver',
  manualDaemonApiPassword: defaultPassword,
  manualDaemonApiIP: '127.0.0.1',
  manualDaemonApiPort: '8080',
  manualDaemonApiPortSSL: '7080',
  manualDaemonLogOutOnClose: false,
  embeddedCoreAllowNonSSL: false,
  embeddedCoreUseNonSSL: false,
  embeddedCoreApiPort: undefined,
  embeddedCoreApiPortSSL: undefined,
  embeddedCoreRpcPort: undefined,
  embeddedCoreRpcPortSSL: undefined,

  // Style
  renderGlobe: true,
  addressStyle: 'segmented',

  // Modules
  disabledModules: [],
  allowSymLink: false,
  devModulePaths: [],

  // Others
  showUnusedNames: true,

  // Hidden settings
  acceptedAgreement: false,
  encryptionWarningDisabled: false,
  bootstrapSuggestionDisabled: false,
  migrateSuggestionDisabled: false,
  liteModeNoticeDisabled: false,
  windowWidth: 1200,
  windowHeight: 800,
  windowX: undefined,
  windowY: undefined,
  forkBlocks: 0,
  walletClean: false,
  legacyMode: false,
  clearPeers: false,
  // If false, show Create new user modal instead of Login
  // modal automatically when core is connected
  firstCreateNewUserShown: false,
  consoleCliSyntax: true,
  dontAskToStartStaking: false,
  lastCheckForUpdates: null,
};

function readSettings() {
  return readJson(settingsFilePath);
}

function writeSettings(settings) {
  return writeJson(settingsFilePath, settings);
}

export function loadSettingsFromFile() {
  let userSettings = readSettings();
  let changed = false;

  // Enable lite mode for new users
  if (!userSettings) {
    userSettings = {
      liteMode: true,
      liteModeNoticeDisabled: true,
    };
    changed = true;
  }

  // Convert balHidden value of overviewDisplay to hideOverviewBalances
  // TODO: remove this after a few versions
  if (userSettings.overviewDisplay === 'balHidden') {
    userSettings.hideOverviewBalances = true;
    userSettings.overviewDisplay = defaultSettings.overviewDisplay;
    changed = true;
  }

  // Deprecating manualDaemonApiIP, copy to manualDaemonIP if manualDaemonApiIP is configured
  const { manualDaemonIP, manualDaemonApiIP } = userSettings;
  if (manualDaemonApiIP && !manualDaemonIP) {
    userSettings.manualDaemonIP = manualDaemonApiIP;
    changed = true;
  }

  if (changed) {
    writeSettings(userSettings);
  }
  return { ...defaultSettings, ...userSettings };
}

export function updateSettingsFile(updates) {
  const settings = readSettings() || {};
  return writeSettings({ ...settings, ...updates });
}
