'use strict';

/**
 * Isolated Litecoin Core read-only monitoring.
 *
 * Hard boundary: never starts/stops Litecoin, never touches wallets/keys,
 * never exposes cookie contents, and only calls a fixed allowlisted RPC set.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

/** Litecoin Core versions below 0.18.0 are not reviewed for this surface. */
const MINIMUM_LITECOIN_CORE_VERSION = 180000;

const ALLOWED_RPC_METHODS = Object.freeze(
  new Set([
    'getblockchaininfo',
    'getnetworkinfo',
    'getmempoolinfo',
    'getconnectioncount',
  ])
);

const ALLOWED_HOSTS = new Set(['127.0.0.1', '::1']);

const REQUEST_TIMEOUT_MS = 3000;
const SEQUENCE_TIMEOUT_MS = 10000;
const SUCCESS_CACHE_MS = 15000;
const FAILURE_BACKOFF_MS = 30000;
const MAX_RESPONSE_BYTES = 256 * 1024;

let cache = {
  status: null,
  expiresAt: 0,
  inflight: null,
};

function nowIso() {
  return new Date().toISOString();
}

function safeStatusBase(partial = {}) {
  return {
    configured: false,
    connected: false,
    fetchedAt: nowIso(),
    freshness: 'unavailable',
    ...partial,
  };
}

function validateHost(host) {
  if (typeof host !== 'string') {
    return { ok: false, reason: 'invalid_configuration' };
  }
  const trimmed = host.trim();
  if (!ALLOWED_HOSTS.has(trimmed)) {
    return { ok: false, reason: 'invalid_configuration' };
  }
  return { ok: true, host: trimmed };
}

function validatePort(portValue) {
  if (typeof portValue !== 'string' && typeof portValue !== 'number') {
    return { ok: false, reason: 'invalid_configuration' };
  }
  const text = String(portValue).trim();
  if (!/^\d{1,5}$/.test(text)) {
    return { ok: false, reason: 'invalid_configuration' };
  }
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'invalid_configuration' };
  }
  return { ok: true, port };
}

function validateCookiePath(cookiePath) {
  if (typeof cookiePath !== 'string' || !cookiePath.trim()) {
    return { ok: false, reason: 'not_configured' };
  }
  const trimmed = cookiePath.trim();
  if (trimmed.length > 4096 || trimmed.includes('\0')) {
    return { ok: false, reason: 'invalid_configuration' };
  }
  // Reject obvious URLs / remote references — cookie must be a local path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return { ok: false, reason: 'invalid_configuration' };
  }
  return { ok: true, cookiePath: trimmed };
}

/**
 * Parse Litecoin Core cookie file contents: "__cookie__:<password>"
 * Never returns secrets in error objects.
 */
function parseCookieContents(raw) {
  if (typeof raw !== 'string') {
    return { ok: false };
  }
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return { ok: false };
  const separator = line.indexOf(':');
  if (separator <= 0 || separator === line.length - 1) {
    return { ok: false };
  }
  const username = line.slice(0, separator);
  const password = line.slice(separator + 1);
  if (!username || !password || username.length > 256 || password.length > 1024) {
    return { ok: false };
  }
  return { ok: true, username, password };
}

function readCookieFile(cookiePath) {
  try {
    const resolved = path.resolve(cookiePath);
    const stats = fs.statSync(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > 8192) {
      return { ok: false, code: 'cookie_unavailable' };
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = parseCookieContents(raw);
    if (!parsed.ok) {
      return { ok: false, code: 'cookie_unavailable' };
    }
    return parsed;
  } catch {
    return { ok: false, code: 'cookie_unavailable' };
  }
}

function classifyNetwork(chain) {
  if (typeof chain !== 'string') return 'unknown';
  const normalized = chain.trim().toLowerCase();
  if (normalized === 'main' || normalized === 'mainnet') return 'main';
  if (
    normalized === 'test' ||
    normalized === 'testnet' ||
    normalized.startsWith('testnet')
  ) {
    return 'test';
  }
  if (normalized === 'regtest') return 'regtest';
  return 'unknown';
}

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function asNonNegativeInt(value) {
  const number = asFiniteNumber(value);
  if (number === undefined || number < 0 || !Number.isInteger(number)) {
    return undefined;
  }
  return number;
}

function jsonRpcRequest({ host, port, authHeader, method, id }) {
  if (!ALLOWED_RPC_METHODS.has(method)) {
    return Promise.reject(
      Object.assign(new Error('Method not allowed'), { code: 'unavailable' })
    );
  }

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id,
    method,
    params: [],
  });

  const hostname = host === '::1' ? '::1' : host;
  const options = {
    protocol: 'http:',
    method: 'POST',
    hostname,
    port,
    path: '/',
    family: host === '::1' ? 6 : 4,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Authorization: authHeader,
      Connection: 'close',
    },
    timeout: REQUEST_TIMEOUT_MS,
  };

  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      let data = '';
      let truncated = false;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (truncated) return;
        if (data.length + chunk.length > MAX_RESPONSE_BYTES) {
          truncated = true;
          data = '';
          request.destroy();
          reject(
            Object.assign(new Error('Response too large'), {
              code: 'invalid_response',
            })
          );
          return;
        }
        data += chunk;
      });
      response.on('end', () => {
        if (truncated) return;
        const statusCode = response.statusCode || 0;
        if (statusCode === 401 || statusCode === 403) {
          reject(
            Object.assign(new Error('Authentication failed'), {
              code: 'authentication_failed',
              statusCode,
            })
          );
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          reject(
            Object.assign(new Error('Unexpected HTTP status'), {
              code: 'invalid_response',
              statusCode,
            })
          );
          return;
        }
        let parsed;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          reject(
            Object.assign(new Error('Invalid JSON'), {
              code: 'invalid_response',
            })
          );
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(
            Object.assign(new Error('Invalid JSON-RPC envelope'), {
              code: 'invalid_response',
            })
          );
          return;
        }
        if (parsed.error) {
          reject(
            Object.assign(new Error('RPC error'), {
              code: 'invalid_response',
            })
          );
          return;
        }
        resolve(parsed.result);
      });
    });

    request.once('timeout', () => {
      request.destroy(
        Object.assign(new Error('Request timed out'), { code: 'timeout' })
      );
    });
    request.once('error', (error) => {
      const code = error?.code;
      if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
        reject(
          Object.assign(new Error('Connection refused'), {
            code: 'connection_refused',
          })
        );
        return;
      }
      if (code === 'ETIMEDOUT' || code === 'timeout') {
        reject(Object.assign(new Error('Request timed out'), { code: 'timeout' }));
        return;
      }
      if (error?.code === 'authentication_failed' || error?.code === 'invalid_response') {
        reject(error);
        return;
      }
      reject(
        Object.assign(new Error('Unavailable'), {
          code: 'unavailable',
        })
      );
    });
    request.write(body);
    request.end();
  });
}

async function callAllowlistedSequence({ host, port, username, password }) {
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  // Drop local references quickly; never log these.
  username = undefined;
  password = undefined;

  const run = async () => {
    const blockchain = await jsonRpcRequest({
      host,
      port,
      authHeader,
      method: 'getblockchaininfo',
      id: 'ltc-blockchain',
    });
    const network = await jsonRpcRequest({
      host,
      port,
      authHeader,
      method: 'getnetworkinfo',
      id: 'ltc-network',
    });
    let mempool = null;
    try {
      mempool = await jsonRpcRequest({
        host,
        port,
        authHeader,
        method: 'getmempoolinfo',
        id: 'ltc-mempool',
      });
    } catch {
      mempool = null;
    }
    let connections;
    const networkConnections = asNonNegativeInt(network?.connections);
    if (networkConnections !== undefined) {
      connections = networkConnections;
    } else {
      try {
        const count = await jsonRpcRequest({
          host,
          port,
          authHeader,
          method: 'getconnectioncount',
          id: 'ltc-connections',
        });
        connections = asNonNegativeInt(count);
      } catch {
        connections = undefined;
      }
    }
    return { blockchain, network, mempool, connections };
  };

  return Promise.race([
    run(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          Object.assign(new Error('Sequence timed out'), { code: 'timeout' })
        );
      }, SEQUENCE_TIMEOUT_MS);
    }),
  ]);
}

function normalizeProbeResult({ blockchain, network, mempool, connections }) {
  const version = asNonNegativeInt(network?.version);
  const networkName = classifyNetwork(blockchain?.chain);
  const blocks = asNonNegativeInt(blockchain?.blocks);
  const headers = asNonNegativeInt(blockchain?.headers);
  const verificationProgress = asFiniteNumber(blockchain?.verificationprogress);
  const initialBlockDownload = asBoolean(blockchain?.initialblockdownload);
  const mempoolTransactions = asNonNegativeInt(mempool?.size);
  const mempoolBytes = asNonNegativeInt(mempool?.bytes);

  const status = safeStatusBase({
    configured: true,
    connected: true,
    network: networkName,
    version,
    blocks,
    headers,
    verificationProgress,
    initialBlockDownload,
    connections,
    mempoolTransactions,
    mempoolBytes,
    freshness: 'live',
  });

  if (version !== undefined && version < MINIMUM_LITECOIN_CORE_VERSION) {
    status.warning = {
      code: 'unsupported_version',
      message:
        'Litecoin Core version is below the reviewed minimum. Upgrade Litecoin Core to continue relying on this monitor.',
    };
    console.info('litecoin.monitor.unsupported_version', {
      version,
      minimum: MINIMUM_LITECOIN_CORE_VERSION,
    });
  } else if (networkName !== 'main') {
    status.warning = {
      code: 'unexpected_network',
      message:
        networkName === 'unknown'
          ? 'Connected Litecoin node reports an unrecognized network. It is not presented as mainnet monitoring.'
          : `Connected Litecoin node is on ${networkName}, not mainnet.`,
    };
  }

  return status;
}

function mapFailure(code) {
  const messages = {
    not_configured: 'Litecoin monitoring is not configured.',
    invalid_configuration: 'Litecoin monitoring configuration is invalid.',
    cookie_unavailable: 'Litecoin cookie file is unavailable or unreadable.',
    authentication_failed: 'Litecoin RPC authentication failed.',
    connection_refused: 'Litecoin Core is not reachable on the configured loopback endpoint.',
    timeout: 'Litecoin RPC request timed out.',
    invalid_response: 'Litecoin RPC returned an invalid response.',
    unsupported_network: 'Litecoin node network is not supported for monitoring.',
    unsupported_version: 'Litecoin Core version is not supported.',
    unavailable: 'Litecoin monitoring is temporarily unavailable.',
  };
  return safeStatusBase({
    configured: code !== 'not_configured',
    connected: false,
    freshness: 'unavailable',
    error: {
      code: messages[code] ? code : 'unavailable',
      message: messages[code] || messages.unavailable,
    },
  });
}

function defaultLoadSettings() {
  // Lazy load so unit tests can import pure validators without the ESM
  // settings module. Webpack still bundles this for the main process.
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const settingsModule = require('./settings');
  return settingsModule.loadSettingsFromFile();
}

async function probeOnce({
  settings: providedSettings,
  readCookie = readCookieFile,
  rpcCall = callAllowlistedSequence,
} = {}) {
  const settings = providedSettings || defaultLoadSettings();
  if (!settings.litecoinMonitoringEnabled) {
    return mapFailure('not_configured');
  }

  const hostResult = validateHost(settings.litecoinMonitoringHost);
  const portResult = validatePort(settings.litecoinMonitoringRpcPort);
  const cookiePathResult = validateCookiePath(settings.litecoinMonitoringCookiePath);

  if (!hostResult.ok || !portResult.ok) {
    console.info('litecoin.monitor.invalid_config', {
      hostOk: hostResult.ok,
      portOk: portResult.ok,
    });
    return mapFailure('invalid_configuration');
  }
  if (!cookiePathResult.ok) {
    return mapFailure(cookiePathResult.reason);
  }

  console.info('litecoin.monitor.probe.begin', {
    host: hostResult.host,
    port: portResult.port,
  });

  const cookie = readCookie(cookiePathResult.cookiePath);
  if (!cookie.ok) {
    console.info('litecoin.monitor.probe.failed', { code: cookie.code });
    return mapFailure(cookie.code || 'cookie_unavailable');
  }

  try {
    const result = await rpcCall({
      host: hostResult.host,
      port: portResult.port,
      username: cookie.username,
      password: cookie.password,
    });
    // Clear cookie material from this frame ASAP.
    cookie.username = undefined;
    cookie.password = undefined;
    const status = normalizeProbeResult(result);
    console.info('litecoin.monitor.probe.ok', {
      network: status.network,
      version: status.version,
      blocks: status.blocks,
      connections: status.connections,
    });
    return status;
  } catch (error) {
    const code =
      error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'unavailable';
    console.info('litecoin.monitor.probe.failed', {
      code: ['authentication_failed', 'connection_refused', 'timeout', 'invalid_response', 'unavailable'].includes(
        code
      )
        ? code
        : 'unavailable',
    });
    return mapFailure(code);
  }
}

async function getLitecoinNodeStatus({
  bypassCache = false,
  settings,
  readCookie,
  rpcCall,
} = {}) {
  const now = Date.now();
  if (!bypassCache && cache.status && cache.expiresAt > now) {
    return cache.status;
  }
  if (cache.inflight) {
    return cache.inflight;
  }

  cache.inflight = probeOnce({ settings, readCookie, rpcCall })
    .then((status) => {
      const backoff =
        status.connected && status.freshness === 'live'
          ? SUCCESS_CACHE_MS
          : FAILURE_BACKOFF_MS;
      cache = {
        status,
        expiresAt: Date.now() + backoff,
        inflight: null,
      };
      return status;
    })
    .catch(() => {
      cache.inflight = null;
      console.info('litecoin.monitor.probe.failed', { code: 'unavailable' });
      return mapFailure('unavailable');
    });

  return cache.inflight;
}

function resetLitecoinMonitorCache() {
  cache = { status: null, expiresAt: 0, inflight: null };
}

module.exports = {
  ALLOWED_HOSTS,
  ALLOWED_RPC_METHODS,
  MINIMUM_LITECOIN_CORE_VERSION,
  classifyNetwork,
  getLitecoinNodeStatus,
  mapFailure,
  normalizeProbeResult,
  parseCookieContents,
  resetLitecoinMonitorCache,
  validateCookiePath,
  validateHost,
  validatePort,
};
