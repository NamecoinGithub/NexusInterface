import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import path from 'path';
import crypto from 'crypto';

import { loadSettingsFromFile } from './settings';
import {
  getCoreTransportOptions,
  validateCoreRpcPath,
} from './ipc/coreTransport';
import {
  fromKeyValues,
  parseBooleanFlag,
  resolveEmbeddedCoreConnection,
  toKeyValues,
} from './ipc/coreConf';

let cachedEmbeddedConfig;
let embeddedConfigLoadPromise;

/**
 * Build the connection config the wallet will use, matching historical
 * NexusInterface behavior:
 * - credentials always come from nexus.conf (created if missing)
 * - SSL/port preferences from wallet settings overlay conf values so the GUI
 *   and the Core process it launches stay aligned
 */
async function loadEmbeddedConfig(settings) {
  if (cachedEmbeddedConfig) return cachedEmbeddedConfig;
  if (embeddedConfigLoadPromise) return embeddedConfigLoadPromise;

  embeddedConfigLoadPromise = (async () => {
    await fs.mkdir(settings.coreDataDir, { recursive: true });
    const configPath = path.join(settings.coreDataDir, 'nexus.conf');
    let config = {};
    try {
      config = fromKeyValues(await fs.readFile(configPath, 'utf8'));
    } catch {
      // A first launch creates the configuration below.
    }

    const resolved = resolveEmbeddedCoreConnection(config, {
      embeddedCoreUseNonSSL: settings.embeddedCoreUseNonSSL,
      embeddedCoreApiPort: settings.embeddedCoreApiPort,
      embeddedCoreApiPortSSL: settings.embeddedCoreApiPortSSL,
      generatedApiPassword: crypto.randomBytes(32).toString('hex'),
    });

    if (resolved.changed) {
      await fs.writeFile(configPath, toKeyValues(resolved.conf), {
        encoding: 'utf8',
        mode: 0o600,
      });
    }

    cachedEmbeddedConfig = resolved.connection;
    return cachedEmbeddedConfig;
  })();

  try {
    return await embeddedConfigLoadPromise;
  } finally {
    // Clear the in-flight promise so a failed load can be retried on the next
    // call. Successful loads are still short-circuited by cachedEmbeddedConfig.
    embeddedConfigLoadPromise = undefined;
  }
}

export function clearCoreConfigCache() {
  cachedEmbeddedConfig = undefined;
  embeddedConfigLoadPromise = undefined;
}

export async function getCoreConfiguration() {
  const settings = loadSettingsFromFile();
  if (settings.manualDaemon) {
    return {
      ip: settings.manualDaemonIP || '127.0.0.1',
      apiSSL: parseBooleanFlag(settings.manualDaemonApiSSL, true),
      apiPort: String(settings.manualDaemonApiPort || '8080'),
      apiPortSSL: String(settings.manualDaemonApiPortSSL || '7080'),
      apiUser: settings.manualDaemonApiUser || 'apiserver',
      apiPassword: settings.manualDaemonApiPassword || '',
    };
  }
  return loadEmbeddedConfig(settings);
}

export async function getPublicCoreConfiguration() {
  const config = await getCoreConfiguration();
  return {
    ip: config.ip,
    apiSSL: config.apiSSL,
    apiPort: config.apiPort,
    apiPortSSL: config.apiPortSSL,
    txExpiry: config.txExpiry,
  };
}

function requestCore({ method, endpoint, params, config, timeout = 30000 }) {
  const body = params === undefined ? undefined : JSON.stringify(params);
  const { apiSSL, rejectUnauthorized } = getCoreTransportOptions(config);
  const client = apiSSL ? https : http;
  const options = {
    method,
    hostname: config.ip,
    port: apiSSL ? config.apiPortSSL : config.apiPort,
    path: `/${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    },
    auth:
      config.apiUser && config.apiPassword
        ? `${config.apiUser}:${config.apiPassword}`
        : undefined,
    ...(apiSSL ? { rejectUnauthorized } : {}),
    timeout,
  };

  return new Promise((resolve, reject) => {
    const request = client.request(options, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        let parsed;
        try {
          parsed = data ? JSON.parse(data) : undefined;
        } catch {
          reject(new Error('Core response is not valid JSON'));
          return;
        }
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve(parsed?.result);
        } else {
          reject(parsed?.error || new Error(`Core returned ${response.statusCode}`));
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Core request timed out')));
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

/**
 * Probe whether the local Core API accepts the wallet's configured credentials
 * and port/SSL settings. Used when a Core process is already running so we do
 * not silently stick to a process that only has P2P up (or uses different
 * datadir/ports/auth).
 */
export async function probeCoreApi(config, { timeout = 2500 } = {}) {
  const resolved = config || (await getCoreConfiguration());
  try {
    const result = await requestCore({
      method: 'POST',
      endpoint: 'system/get/info',
      params: undefined,
      config: resolved,
      timeout,
    });
    return { ok: true, result, config: resolved };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      config: resolved,
    };
  }
}

export async function callCoreRpc({ endpoint, params }) {
  const config = await getCoreConfiguration();
  return requestCore({ method: 'POST', endpoint, params, config });
}

export async function callCoreRpcByUrl(url) {
  const normalizedUrl = validateCoreRpcPath(url);
  const config = await getCoreConfiguration();
  return requestCore({
    method: 'GET',
    endpoint: normalizedUrl,
    params: undefined,
    config,
  });
}
