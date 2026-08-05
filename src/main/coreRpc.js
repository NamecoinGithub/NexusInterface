import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import path from 'path';
import crypto from 'crypto';

import { loadSettingsFromFile } from './settings';

let cachedEmbeddedConfig;

function fromKeyValues(contents) {
  return contents
    ? contents.split('\n').reduce((config, line) => {
        const separator = line.indexOf('=');
        if (separator > 0) {
          config[line.slice(0, separator)] = line.slice(separator + 1);
        }
        return config;
      }, {})
    : {};
}

async function loadEmbeddedConfig(settings) {
  if (cachedEmbeddedConfig) return cachedEmbeddedConfig;
  await fs.mkdir(settings.coreDataDir, { recursive: true });
  const configPath = path.join(settings.coreDataDir, 'nexus.conf');
  let config = {};
  try {
    config = fromKeyValues(await fs.readFile(configPath, 'utf8'));
  } catch {
    // A first launch creates the configuration below.
  }
  let changed = false;
  const defaults = {
    apiuser: 'apiserver',
    apipassword: crypto.randomBytes(32).toString('hex'),
    apissl: settings.embeddedCoreUseNonSSL ? 'false' : 'true',
    apiport: settings.embeddedCoreApiPort || '8080',
    apiportssl: settings.embeddedCoreApiPortSSL || '7080',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (config[key] === undefined || config[key] === '') {
      config[key] = value;
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(
      configPath,
      Object.entries(config)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { encoding: 'utf8', mode: 0o600 }
    );
  }
  cachedEmbeddedConfig = {
    ip: '127.0.0.1',
    apiSSL: config.apissl !== 'false',
    apiPort: config.apiport,
    apiPortSSL: config.apiportssl,
    apiUser: config.apiuser,
    apiPassword: config.apipassword,
    txExpiry: Number.parseInt(config.txexpiry, 10) || undefined,
  };
  return cachedEmbeddedConfig;
}

export function clearCoreConfigCache() {
  cachedEmbeddedConfig = undefined;
}

export async function getCoreConfiguration() {
  const settings = loadSettingsFromFile();
  if (settings.manualDaemon) {
    return {
      ip: settings.manualDaemonIP,
      apiSSL: settings.manualDaemonApiSSL,
      apiPort: settings.manualDaemonApiPort,
      apiPortSSL: settings.manualDaemonApiPortSSL,
      apiUser: settings.manualDaemonApiUser,
      apiPassword: settings.manualDaemonApiPassword,
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

function requestCore({ method, endpoint, params, config }) {
  const body = params === undefined ? undefined : JSON.stringify(params);
  const client = config.apiSSL ? https : http;
  const options = {
    method,
    hostname: config.ip,
    port: config.apiSSL ? config.apiPortSSL : config.apiPort,
    path: `/${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    },
    auth:
      config.apiUser && config.apiPassword
        ? `${config.apiUser}:${config.apiPassword}`
        : undefined,
    // Nexus Core commonly uses a self-signed local certificate.
    rejectUnauthorized: false,
    timeout: 30000,
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

export async function callCoreRpc({ endpoint, params }) {
  const config = await getCoreConfiguration();
  return requestCore({ method: 'POST', endpoint, params, config });
}

export async function callCoreRpcByUrl(url) {
  if (typeof url !== 'string' || !url || url.length > 2048) {
    throw new Error('Core RPC URL is invalid');
  }
  const normalizedUrl = url.replace(/^\/+/, '');
  if (
    normalizedUrl.includes('://') ||
    normalizedUrl.includes('\\') ||
    normalizedUrl.split('/').some((part) => part === '..')
  ) {
    throw new Error('Core RPC URL must be a relative API path');
  }
  const config = await getCoreConfiguration();
  return requestCore({
    method: 'GET',
    endpoint: normalizedUrl,
    params: undefined,
    config,
  });
}
