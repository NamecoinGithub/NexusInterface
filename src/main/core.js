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

  return configuredPath.trim() || bundledCoreBinaryPath;
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

  try {
    fs.accessSync(coreBinaryPath, fs.constants.X_OK);
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
    PID = (
      await exec('ps -A', {
        env: modEnv,
      })
    )
      .toString()
      .split('\n')
      .find((output) => output.includes(coreBinaryPath));

    PID =
      PID &&
      Number(
        PID.trim()
          .split(' ')[0]
          .toString()
          .replace(/^\s+|\s+$/gm, '')
      );
  } else {
    PID = (
      await exec('ps -o pid --no-headers -p 1 -C ${Nexus_Daemon}', {
        env: modEnv,
      })
    )
      .toString()
      .split('\n')[1];
    PID =
      PID &&
      Number(
        PID.replace(/^\s*/gm, '')
          .split(' ')[0]
          .toString()
          .replace(/^\s+|\s+$/gm, '')
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
  log.info('Core Manager: Killing process ' + corePID);
  const env = { ...process.env, KILL_PID: corePID };
  if (process.platform == 'win32') {
    await exec(`taskkill /F /PID ${corePID}`, { env });
  } else {
    await exec('kill -9 $KILL_PID', { env });
  }
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
