import child_process from 'child_process';
import spawn from 'cross-spawn';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';

import { assetsByPlatformDir } from './paths';
import { loadSettingsFromFile, updateSettingsFile } from './settings';
import {
  clearCoreConfigCache,
  getCoreConfiguration,
  probeCoreApi,
} from './coreRpc';

// After killing a mismatched Core, wait briefly so OS listen sockets (API/P2P)
// are released before we spawn a replacement on the same ports.
const CORE_PORT_RELEASE_DELAY_MS = 750;

const coreBinaryName = `nexus-${process.platform}-${process.arch}${
  process.platform === 'win32' ? '.exe' : ''
}`;
const bundledCoreBinaryPath = path.join(
  assetsByPlatformDir,
  'cores',
  coreBinaryName
);
const coreBinaryOverrideEnv =
  process.env.NEXUS_CORE_BINARY_PATH || process.env.NEXUS_CORE_BINARY;
const windowsExecutableExtension = '.exe';
const windowsTasklistPidIndex = 1;

const execFile = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    child_process.execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });

function normalizeConfiguredBinaryPath(configuredPath) {
  if (typeof configuredPath !== 'string') {
    return '';
  }

  let normalizedPath = configuredPath.trim();

  if (
    (normalizedPath.startsWith('"') && normalizedPath.endsWith('"')) ||
    (normalizedPath.startsWith("'") && normalizedPath.endsWith("'"))
  ) {
    normalizedPath = normalizedPath.slice(1, -1).trim();
  }

  const homePrefix = `~${path.sep}`;
  if (normalizedPath === '~' || normalizedPath.startsWith(homePrefix)) {
    const homeDir =
      process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME;
    if (homeDir) {
      normalizedPath =
        normalizedPath === '~'
          ? homeDir
          : path.join(homeDir, normalizedPath.slice(homePrefix.length));
    }
  }

  return normalizedPath ? path.normalize(normalizedPath) : '';
}

function getConfiguredCoreBinaryPath() {
  const settings = loadSettingsFromFile();
  const configuredPath =
    coreBinaryOverrideEnv || settings.embeddedCoreBinaryPath || '';

  return normalizeConfiguredBinaryPath(configuredPath) || bundledCoreBinaryPath;
}

function getCoreBinaryName(binaryPath = getConfiguredCoreBinaryPath()) {
  return path.basename(binaryPath);
}

function getCoreBinaryStatus() {
  const coreBinaryPath = getConfiguredCoreBinaryPath();
  const usingOverride = coreBinaryPath !== bundledCoreBinaryPath;
  const source = coreBinaryOverrideEnv
    ? 'environment'
    : usingOverride
    ? 'settings'
    : 'bundled assets';

  if (!path.isAbsolute(coreBinaryPath)) {
    return {
      exists: false,
      executable: false,
      path: coreBinaryPath,
      name: getCoreBinaryName(coreBinaryPath),
      source,
      error: `Nexus Core binary path must be absolute: ${coreBinaryPath}`,
    };
  }

  try {
    const stats = fs.statSync(coreBinaryPath);
    if (!stats.isFile()) {
      return {
        exists: true,
        executable: false,
        path: coreBinaryPath,
        name: getCoreBinaryName(coreBinaryPath),
        source,
        error: `Nexus Core binary path must point to a file: ${coreBinaryPath}`,
      };
    }

    if (
      process.platform === 'win32' &&
      path.extname(coreBinaryPath).toLowerCase() !== windowsExecutableExtension
    ) {
      return {
        exists: true,
        executable: false,
        path: coreBinaryPath,
        name: getCoreBinaryName(coreBinaryPath),
        source,
        error: `Nexus Core binary must be a .exe file on Windows: ${coreBinaryPath}`,
      };
    }

    fs.accessSync(
      coreBinaryPath,
      process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
    );
    return {
      exists: true,
      executable: true,
      path: coreBinaryPath,
      name: getCoreBinaryName(coreBinaryPath),
      source,
    };
  } catch (err) {
    const error =
      err.code === 'ENOENT'
        ? usingOverride
          ? `Configured Nexus Core binary was not found: ${coreBinaryPath}`
          : `No bundled Nexus Core binary was found for ${process.platform}/${process.arch}. Expected: ${coreBinaryPath}. Set NEXUS_CORE_BINARY_PATH or Core Binary Path to use an external binary.`
        : process.platform === 'win32'
        ? `Nexus Core binary is not accessible: ${coreBinaryPath}`
        : `Nexus Core binary is not executable: ${coreBinaryPath}`;

    return {
      exists: false,
      executable: false,
      path: coreBinaryPath,
      name: getCoreBinaryName(coreBinaryPath),
      source,
      error,
    };
  }
}

function commandMatchesCore(
  command,
  normalizedCoreBinaryPath,
  resolvedCoreBinaryName
) {
  const normalizedCommand = path.normalize(command);
  const commandParts = splitCommandParts(command).map((part) =>
    path.normalize(part)
  );
  const possibleExecutableParts = commandParts.slice(0, 2);

  return (
    normalizedCommand === normalizedCoreBinaryPath ||
    normalizedCommand.startsWith(`${normalizedCoreBinaryPath} `) ||
    normalizedCommand.startsWith(`"${normalizedCoreBinaryPath}"`) ||
    normalizedCommand.includes(` ${normalizedCoreBinaryPath} `) ||
    normalizedCommand.includes(` "${normalizedCoreBinaryPath}"`) ||
    possibleExecutableParts.some((part) => {
      const unquotedPart = part.replace(/^(['"])(.*)\1$/, '$2');
      return path.basename(unquotedPart) === resolvedCoreBinaryName;
    })
  );
}

function splitCommandParts(command) {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;

  while ((match = pattern.exec(command)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }

  return parts;
}

function parseWindowsCSVLine(line) {
  const fields = [];
  let field = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && nextChar === '"') {
      field += char;
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

function findCorePIDInProcessList(
  processList,
  coreBinaryPath,
  resolvedCoreBinaryName
) {
  const normalizedCoreBinaryPath = path.normalize(coreBinaryPath);
  const matchingProcess = processList
    .toString()
    .split('\n')
    .map((output) => {
      const match = output.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) return null;

      return {
        pid: Number(match[1]),
        command: match[2],
      };
    })
    .find(
      (processInfo) =>
        processInfo &&
        processInfo.pid > 1 &&
        commandMatchesCore(
          processInfo.command,
          normalizedCoreBinaryPath,
          resolvedCoreBinaryName
        )
    );

  return matchingProcess ? matchingProcess.pid : null;
}

function getExecutableCoreBinary() {
  const status = getCoreBinaryStatus();
  if (!status.exists || !status.executable) {
    throw new Error(status.error);
  }
  return status;
}

/**
 * Check if core binary file exists
 *
 * @returns {boolean} Does the configured core binary exist and is it executable
 */
export function coreBinaryExists() {
  const status = getCoreBinaryStatus();
  log.info(`Checking if core binary exists: ${status.path} (${status.source})`);
  if (status.exists && status.executable) {
    log.info('Core binary exists');
    return true;
  }

  log.info(status.error);
  return false;
}

export function coreBinaryStatus() {
  return getCoreBinaryStatus();
}

/**
 * Get Process ID of core process if core is running
 *
 * @returns {string} PID
 * @memberof Core
 */
async function getCorePID() {
  const { path: coreBinaryPath, name: resolvedCoreBinaryName } =
    getExecutableCoreBinary();
  const modEnv = { ...process.env, Nexus_Daemon: resolvedCoreBinaryName };
  let PID;

  if (process.platform == 'win32') {
    const taskList = await execFile(
      'tasklist',
      ['/NH', '/v', '/fo', 'CSV'],
      { env: modEnv }
    );
    const matchingProcess = taskList
      .toString()
      .split('\n')
      .find((output) => output.includes(`"${resolvedCoreBinaryName}"`));
    if (matchingProcess) {
      const fields = parseWindowsCSVLine(matchingProcess);
      // tasklist CSV fields are "Image Name","PID",... so PID is column index 1.
      PID =
        fields.length > windowsTasklistPidIndex
          ? Number(fields[windowsTasklistPidIndex])
          : null;
    }
  } else {
    PID = findCorePIDInProcessList(
      await execFile(
        'ps',
        process.platform == 'darwin'
          ? ['-axo', 'pid=,comm=,args=']
          : ['-eo', 'pid=,comm=,args='],
        { env: modEnv }
      ),
      coreBinaryPath,
      resolvedCoreBinaryName
    );
  }

  if (!PID || Number.isNaN(PID) || PID < 2) {
    return null;
  } else {
    return PID;
  }
}

/**
 * Returns true if the PID is found.
 * @returns { boolean } If the core is running.
 * @memberof Core
 */
export async function isCoreRunning() {
  const pid = await getCorePID();
  return !!pid;
}

/**
 * Start up the core with necessary parameters
 *
 * @memberof Core
 */
export function startCore(params) {
  const { path: coreBinaryPath } = getExecutableCoreBinary();
  // Never log raw API credentials from the parameter list.
  const redactedParams = (params || []).map((param) =>
    /^-api(user|password)=/i.test(param)
      ? `${param.slice(0, param.indexOf('=') + 1)}********`
      : param
  );
  log.info('Core Parameters: ' + redactedParams.join(' '));
  log.info('Core Manager: Starting core: ' + coreBinaryPath);
  try {
    const coreProcess = spawn(coreBinaryPath, params, {
      shell: false,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    if (coreProcess) {
      // Detach fully so the wallet can exit without waiting on Core.
      coreProcess.unref();
      log.info(
        `Core Manager: Core has started (process id: ${coreProcess.pid})`
      );
      return coreProcess.pid;
    } else {
      throw 'Core failed to start';
    }

  } catch (err) {
    console.error(err);
    throw err;
  }
}

function buildConfiguredCoreParams(settings, configuration) {
  const lockedTestnet =
    typeof LOCK_TESTNET === 'undefined' ? '' : String(LOCK_TESTNET);
  const version = typeof APP_VERSION === 'undefined' ? '' : String(APP_VERSION);
  const preRelease =
    version.includes('alpha') || version.includes('beta') || !!lockedTestnet;
  const apiSSL = configuration.apiSSL !== false;

  // Pass API auth and bind settings on the CLI as well as via nexus.conf.
  // Core disables the API entirely when apiuser/apipassword are missing, and
  // defaults the SSL API port to 8443 unless apisslport is set — both of which
  // leave the GUI stuck on "Connecting to Nexus Core..." while P2P still works.
  const params = [
    '-daemon',
    '-server',
    '-fastsync',
    '-noterminateauth',
    '-ssl=1',
    `-apissl=${apiSSL ? '1' : '0'}`,
    '-p2pssl=1',
    `-datadir=${settings.coreDataDir}`,
    `-apiuser=${configuration.apiUser}`,
    `-apipassword=${configuration.apiPassword}`,
    `-apisslport=${configuration.apiPortSSL}`,
    `-apiport=${configuration.apiPort}`,
    `-verbose=${preRelease ? 3 : settings.verboseLevel}`,
  ];

  if (lockedTestnet) {
    params.push(
      '-connect=testnet1.interactions-nexus.io',
      '-connect=testnet2.interactions-nexus.io',
      '-connect=testnet3.interactions-nexus.io',
      '-nodns=1',
      `-testnet=${lockedTestnet}`
    );
  } else if (
    settings.testnetIteration &&
    String(settings.testnetIteration) !== '0'
  ) {
    params.push(`-testnet=${settings.testnetIteration}`);
    if (settings.privateTestnet) params.push('-private=1');
  }

  if (settings.revertBlocks) {
    params.push(`-revertblocks=${settings.revertBlocks}`);
    updateSettingsFile({ revertBlocks: 0 });
  }
  if (settings.safeMode) params.push('-safemode=1');
  if (settings.walletClean) {
    params.push('-walletclean');
    updateSettingsFile({ walletClean: false });
  }
  if (!settings.avatarMode) params.push('-avatar=0');
  if (settings.enableMining) {
    params.push('-mining=1');
    if (settings.ipMineWhitelist) {
      for (const ip of settings.ipMineWhitelist.split(';')) {
        if (ip) params.push(`-llpallowip=${ip}`);
      }
    }
  }
  if (settings.enableStaking) params.push('-stake=1');
  if (settings.pooledStaking) params.push('-poolstaking=1');
  if (settings.liteMode) params.push('-client=1');
  if (settings.multiUser) params.push('-multiusername=1');
  if (settings.allowAdvancedCoreOptions && settings.advancedCoreParams) {
    params.push(...splitCommandParts(settings.advancedCoreParams));
  }

  return { params, lockedTestnet };
}

/**
 * Starts the bundled core using only settings persisted by the main process.
 * Renderer callers cannot supply executable paths or process arguments.
 *
 * If a Core process is already running, the wallet probes the local API with
 * the configured host/port/SSL/credentials. P2P alone is not enough — a Core
 * started with a different datadir, default SSL port 8443, or without API auth
 * will keep the GUI disconnected forever unless we recover here.
 */
export async function startConfiguredCore() {
  const settings = loadSettingsFromFile();
  if (settings.manualDaemon) {
    return { started: false, reason: 'manual-daemon' };
  }

  const status = getCoreBinaryStatus();
  if (!status.exists || !status.executable) {
    throw new Error(status.error || 'Nexus Core binary not found');
  }

  clearCoreConfigCache();
  const configuration = await getCoreConfiguration();
  if (!configuration.apiUser || !configuration.apiPassword) {
    throw new Error(
      'Nexus Core API credentials are missing from nexus.conf; cannot start API server'
    );
  }

  if (await isCoreRunning()) {
    const probe = await probeCoreApi(configuration);
    if (probe.ok) {
      log.info(
        `Core Manager: Existing Core API is reachable at ${configuration.ip}:${
          configuration.apiSSL ? configuration.apiPortSSL : configuration.apiPort
        } (${configuration.apiSSL ? 'ssl' : 'plain'})`
      );
      return { started: false, reason: 'already-running', apiReachable: true };
    }

    log.warn(
      `Core Manager: Core process is running but API is unreachable (${probe.error}). ` +
        'Restarting Core with wallet API settings so the GUI can connect.'
    );
    await killCoreProcess();
    await new Promise((resolve) =>
      setTimeout(resolve, CORE_PORT_RELEASE_DELAY_MS)
    );
  }

  const { params, lockedTestnet } = buildConfiguredCoreParams(
    settings,
    configuration
  );

  if (
    !lockedTestnet &&
    !settings.testnetIteration &&
    (!settings.coreAPIPolicy || settings.coreAPIPolicy < 1)
  ) {
    updateSettingsFile({ coreAPIPolicy: 1 });
    await fs.promises.rm(path.join(settings.coreDataDir, '_API'), {
      recursive: true,
      force: true,
    });
    // Lite mode keeps API state under datadir/client/_API.
    if (settings.liteMode) {
      await fs.promises.rm(path.join(settings.coreDataDir, 'client', '_API'), {
        recursive: true,
        force: true,
      });
    }
  }
  return { started: true, pid: startCore(params), apiReachable: false };
}

export async function resyncLiteDatabase() {
  const settings = loadSettingsFromFile();
  if (settings.manualDaemon || !settings.liteMode) {
    throw new Error('Lite database resync is only available for embedded lite mode');
  }
  await fs.promises.rm(path.join(settings.coreDataDir, 'client'), {
    recursive: true,
    force: true,
  });
  return { removed: true };
}

/**
 * Find the Core's PID and then kill the task.
 * @memberof Core
 */
export async function killCoreProcess() {
  const corePID = await getCorePID();
  if (!corePID) {
    log.info('Core Manager: No Nexus Core process found to kill');
    return false;
  }

  log.info('Core Manager: Killing process ' + corePID);
  if (process.platform == 'win32') {
    await execFile('taskkill', ['/F', '/PID', String(corePID)]);
  } else {
    process.kill(corePID, 'SIGKILL');
  }
  return true;
}

/**
 * Execute either an API call  by using the shell to execute the core path plus a command.
 * @param {string} command API command to run
 * @returns {object} the result of the command
 * @memberof Core
 */
export async function executeCommand(command) {
  const { path: coreBinaryPath } = getExecutableCoreBinary();
  try {
    const args = splitCommandParts(command);
    if (!args.length) throw new Error('Core console command is empty');
    const result = await execFile(coreBinaryPath, ['-noapiauth', ...args]);
    return result;
  } catch (err) {
    console.error(err);
    throw err;
  }
}
