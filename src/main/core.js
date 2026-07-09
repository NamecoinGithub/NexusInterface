import child_process from 'child_process';
import spawn from 'cross-spawn';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';

import { assetsByPlatformDir } from 'consts/paths';
import { loadSettingsFromFile } from 'lib/settings/universal';

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

function normalizeConfiguredCoreBinaryPath(configuredPath) {
  const trimmedPath = String(configuredPath || '').trim();
  if (!trimmedPath) {
    return bundledCoreBinaryPath;
  }

  return trimmedPath.replace(/^["']|["']$/g, '');
}

const exec = (command, options = {}) =>
  new Promise((resolve, reject) => {
    child_process.exec(command, options, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });

function getConfiguredCoreBinaryPath() {
  const settings = loadSettingsFromFile();
  const configuredPath =
    coreBinaryOverrideEnv || settings.embeddedCoreBinaryPath || '';

  return normalizeConfiguredCoreBinaryPath(configuredPath);
}

function getCoreBinaryName(binaryPath = getConfiguredCoreBinaryPath()) {
  return path.basename(binaryPath);
}

function getCoreBinaryError(coreBinaryPath, usingOverride, err) {
  if (err.code === 'ENOENT') {
    return usingOverride
      ? `Configured Nexus Core binary was not found: ${coreBinaryPath}`
      : `No bundled Nexus Core binary was found for ${process.platform}/${process.arch}. Expected: ${coreBinaryPath}. Set NEXUS_CORE_BINARY_PATH or Core Binary Path to use an external binary.`;
  }
  if (err.code === 'ENOTDIR') {
    return `Nexus Core binary path contains a non-directory component: ${coreBinaryPath}`;
  }
  if (err.code === 'EISDIR') {
    return `Nexus Core binary path points to a directory, not a file: ${coreBinaryPath}`;
  }
  if (err.code === 'EACCES') {
    return `Nexus Core binary is not executable: ${coreBinaryPath}`;
  }
  return `Nexus Core binary is invalid: ${coreBinaryPath} (${err.message})`;
}

function getCoreBinaryStatus() {
  const coreBinaryPath = getConfiguredCoreBinaryPath();
  const usingOverride = coreBinaryPath !== bundledCoreBinaryPath;
  const source = coreBinaryOverrideEnv
    ? 'environment'
    : usingOverride
    ? 'settings'
    : 'bundled assets';

  try {
    if (usingOverride && !path.isAbsolute(coreBinaryPath)) {
      throw new Error('Configured Nexus Core binary path must be absolute.');
    }

    const stat = fs.statSync(coreBinaryPath);
    if (!stat.isFile()) {
      const err = new Error('Nexus Core binary path points to a directory.');
      err.code = 'EISDIR';
      throw err;
    }

    const realPath = fs.realpathSync(coreBinaryPath);
    if (
      process.platform === 'win32' &&
      path.extname(coreBinaryPath).toLowerCase() !== '.exe'
    ) {
      throw new Error(
        'Configured Nexus Core binary path must point to a .exe file on Windows.'
      );
    }

    if (process.platform !== 'win32') {
      fs.accessSync(coreBinaryPath, fs.constants.X_OK);
    }

    return {
      exists: true,
      executable: true,
      path: coreBinaryPath,
      realPath,
      name: getCoreBinaryName(coreBinaryPath),
      source,
    };
  } catch (err) {
    return {
      exists: false,
      executable: false,
      path: coreBinaryPath,
      name: getCoreBinaryName(coreBinaryPath),
      source,
      error: getCoreBinaryError(coreBinaryPath, usingOverride, err),
    };
  }
}

function lineMatchesCoreProcess(line, status) {
  const normalizedLine = line.replace(/\\/g, '/');
  const binaryPath = status.path.replace(/\\/g, '/');
  const realPath = status.realPath && status.realPath.replace(/\\/g, '/');

  return (
    normalizedLine.includes(binaryPath) ||
    (realPath && normalizedLine.includes(realPath)) ||
    (status.source === 'bundled assets' && normalizedLine.includes(status.name))
  );
}

function getPidFromProcessList(stdout, status) {
  const match = stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && lineMatchesCoreProcess(line, status));

  const pid = match && Number(match.split(/\s+/)[0]);
  return pid && !Number.isNaN(pid) ? pid : null;
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
  const status = getExecutableCoreBinary();
  const { path: coreBinaryPath, name: resolvedCoreBinaryName } = status;
  const modEnv = { ...process.env, Nexus_Daemon: resolvedCoreBinaryName };
  let PID;

  if (process.platform == 'win32') {
    PID = (
      await exec(
        `tasklist /NH /v /fi "IMAGENAME eq ${resolvedCoreBinaryName}" /fo CSV`,
        { env: modEnv }
      )
    )
      .toString()
      .split(',')[1];
    PID = PID && Number(PID.replace(/"/gm, ''));
  } else if (process.platform == 'darwin') {
    PID = getPidFromProcessList(
      await exec('ps -Ao pid=,comm=,args=', {
        env: modEnv,
      }),
      status
    );
  } else {
    PID = getPidFromProcessList(
      await exec('ps -eo pid=,comm=,args=', {
        env: modEnv,
      }),
      status
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
  log.info('Core Parameters: ' + (params && params.join(' ')));
  log.info('Core Manager: Starting core: ' + coreBinaryPath);
  try {
    const coreProcess = spawn(coreBinaryPath, params, {
      shell: false,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    if (coreProcess) {
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

/**
 * Find the Core's PID and then kill the task.
 * @memberof Core
 */
export async function killCoreProcess() {
  const corePID = await getCorePID();
  if (!corePID) {
    log.info('Core Manager: No running core process found to kill');
    return false;
  }

  log.info('Core Manager: Killing process ' + corePID);
  const env = { ...process.env, KILL_PID: corePID };
  if (process.platform == 'win32') {
    await exec(`taskkill /F /PID ${corePID}`, { env });
  } else {
    await exec('kill -9 $KILL_PID', { env });
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
    const result = await exec(`"${coreBinaryPath}" -noapiauth ${command}`);
    return result;
  } catch (err) {
    console.error(err);
    throw err;
  }
}
