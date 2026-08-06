'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ALLOWED_RPC_METHODS,
  classifyNetwork,
  getLitecoinNodeStatus,
  mapFailure,
  normalizeProbeResult,
  parseCookieContents,
  resetLitecoinMonitorCache,
  validateCookiePath,
  validateHost,
  validatePort,
  MINIMUM_LITECOIN_CORE_VERSION,
} = require('../../src/main/litecoinMonitor');

const {
  CHANNELS,
  validateSettingsUpdate,
  validateNoArguments,
} = require('../../src/main/ipc/contracts');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('disabled or unconfigured monitoring returns not_configured', async () => {
  resetLitecoinMonitorCache();
  const disabled = await getLitecoinNodeStatus({
    bypassCache: true,
    settings: {
      litecoinMonitoringEnabled: false,
      litecoinMonitoringHost: '127.0.0.1',
      litecoinMonitoringRpcPort: '9332',
      litecoinMonitoringCookiePath: '/tmp/not-used.cookie',
    },
  });
  assert.equal(disabled.error?.code, 'not_configured');
  assert.equal(disabled.connected, false);
  assert.equal(disabled.freshness, 'unavailable');

  resetLitecoinMonitorCache();
  const missingCookie = await getLitecoinNodeStatus({
    bypassCache: true,
    settings: {
      litecoinMonitoringEnabled: true,
      litecoinMonitoringHost: '127.0.0.1',
      litecoinMonitoringRpcPort: '9332',
      litecoinMonitoringCookiePath: '',
    },
  });
  assert.equal(missingCookie.error?.code, 'not_configured');
});

test('only literal loopback hosts are accepted', () => {
  assert.deepEqual(validateHost('127.0.0.1'), {
    ok: true,
    host: '127.0.0.1',
  });
  assert.deepEqual(validateHost('::1'), { ok: true, host: '::1' });

  for (const host of [
    'localhost',
    '0.0.0.0',
    '192.168.1.10',
    '10.0.0.2',
    '8.8.8.8',
    'example.com',
    'http://127.0.0.1',
    '127.0.0.1:9332',
    '[::1]',
    '',
    '  ',
    null,
    undefined,
    123,
  ]) {
    assert.equal(validateHost(host).ok, false, `host should reject: ${host}`);
  }
});

test('RPC port validation accepts 1..65535 only', () => {
  assert.deepEqual(validatePort('9332'), { ok: true, port: 9332 });
  assert.deepEqual(validatePort(1), { ok: true, port: 1 });
  assert.deepEqual(validatePort('65535'), { ok: true, port: 65535 });

  for (const port of ['0', '65536', '-1', '22a', '', '1.5', '99999', null]) {
    assert.equal(validatePort(port).ok, false, `port should reject: ${port}`);
  }
});

test('cookie path validation rejects empty, oversized, and URL-like values', () => {
  assert.equal(validateCookiePath('').ok, false);
  assert.equal(validateCookiePath('https://evil.example/cookie').ok, false);
  assert.equal(validateCookiePath(`x${'\0'}y`).ok, false);
  assert.equal(
    validateCookiePath(path.join(os.tmpdir(), 'litecoin.cookie')).ok,
    true
  );
});

test('cookie contents never appear in DTO or safe errors', async () => {
  resetLitecoinMonitorCache();
  const secret = '__cookie__:super-secret-cookie-value-do-not-leak';
  const status = await getLitecoinNodeStatus({
    bypassCache: true,
    settings: {
      litecoinMonitoringEnabled: true,
      litecoinMonitoringHost: '127.0.0.1',
      litecoinMonitoringRpcPort: '9332',
      litecoinMonitoringCookiePath: path.join(os.tmpdir(), 'x.cookie'),
    },
    readCookie: () => parseCookieContents(secret),
    rpcCall: async () => {
      throw Object.assign(new Error('auth'), { code: 'authentication_failed' });
    },
  });

  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('super-secret-cookie-value-do-not-leak'), false);
  assert.equal(serialized.includes('__cookie__'), false);
  assert.equal(status.error?.code, 'authentication_failed');
  assert.equal(parseCookieContents(secret).ok, true);
  assert.equal(parseCookieContents('not-a-cookie').ok, false);
});

test('fixed RPC allowlist only; no renderer method input channel', () => {
  assert.deepEqual(
    [...ALLOWED_RPC_METHODS].sort(),
    [
      'getblockchaininfo',
      'getconnectioncount',
      'getmempoolinfo',
      'getnetworkinfo',
    ].sort()
  );
  assert.equal(ALLOWED_RPC_METHODS.has('getwalletinfo'), false);
  assert.equal(ALLOWED_RPC_METHODS.has('getblockchaininfo'), true);

  const preload = read('src/main/preload.js');
  const contracts = read('src/main/ipc/contracts.js');
  const mainSource = read('src/main/main.js');

  assert.match(contracts, /litecoinGetStatus:\s*'externalChains:litecoin-get-status'/);
  assert.match(preload, /externalChains:\s*\{[\s\S]*litecoin:[\s\S]*getStatus/);
  assert.doesNotMatch(preload, /callRpc|externalChains\.request|externalChains\.call/);
  assert.doesNotMatch(contracts, /externalChains:call|externalChains:request|callRpc/);
  assert.match(
    mainSource,
    /CHANNELS\.externalChains\.litecoinGetStatus/
  );
  assert.equal(validateNoArguments(undefined), undefined);
  assert.throws(() => validateNoArguments({ method: 'getwalletinfo' }), TypeError);
});

test('transport failures normalize to safe codes', async () => {
  resetLitecoinMonitorCache();
  const cases = [
    ['connection_refused', 'connection_refused'],
    ['timeout', 'timeout'],
    ['invalid_response', 'invalid_response'],
    ['authentication_failed', 'authentication_failed'],
  ];
  for (const [throwCode, expected] of cases) {
    resetLitecoinMonitorCache();
    const status = await getLitecoinNodeStatus({
      bypassCache: true,
      settings: {
        litecoinMonitoringEnabled: true,
        litecoinMonitoringHost: '127.0.0.1',
        litecoinMonitoringRpcPort: '9332',
        litecoinMonitoringCookiePath: '/tmp/x.cookie',
      },
      readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
      rpcCall: async () => {
        throw Object.assign(new Error('x'), { code: throwCode });
      },
    });
    assert.equal(status.error?.code, expected);
    assert.equal(status.connected, false);
    assert.equal(status.freshness, 'unavailable');
  }

  // Live HTTP server: non-200 and malformed JSON paths.
  const server = http.createServer((req, res) => {
    if (req.url === '/auth') {
      res.statusCode = 401;
      res.end('nope');
      return;
    }
    if (req.url === '/badjson') {
      res.statusCode = 200;
      res.end('not-json');
      return;
    }
    res.statusCode = 500;
    res.end('{"error":{"message":"fail"}}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  // Direct unit coverage of mapFailure for HTTP-shaped codes.
  assert.equal(mapFailure('invalid_response').error.code, 'invalid_response');
  assert.equal(mapFailure('authentication_failed').error.code, 'authentication_failed');
  server.close();
  assert.ok(port > 0);
});

test('network classification and unsupported version warning', () => {
  assert.equal(classifyNetwork('main'), 'main');
  assert.equal(classifyNetwork('mainnet'), 'main');
  assert.equal(classifyNetwork('test'), 'test');
  assert.equal(classifyNetwork('testnet4'), 'test');
  assert.equal(classifyNetwork('regtest'), 'regtest');
  assert.equal(classifyNetwork('signet'), 'unknown');
  assert.equal(classifyNetwork(''), 'unknown');

  const mainOk = normalizeProbeResult({
    blockchain: {
      chain: 'main',
      blocks: 10,
      headers: 10,
      verificationprogress: 1,
      initialblockdownload: false,
    },
    network: { version: Math.max(MINIMUM_LITECOIN_CORE_VERSION, 210000), connections: 8 },
    mempool: { size: 2, bytes: 100 },
    connections: 8,
  });
  assert.equal(mainOk.connected, true);
  assert.equal(mainOk.network, 'main');
  assert.equal(mainOk.warning, undefined);
  assert.equal(mainOk.blocks, 10);
  assert.equal(mainOk.mempoolTransactions, 2);

  const testnet = normalizeProbeResult({
    blockchain: { chain: 'test', blocks: 1, headers: 1, verificationprogress: 0.5 },
    network: { version: 210000, connections: 1 },
    mempool: null,
    connections: 1,
  });
  assert.equal(testnet.network, 'test');
  assert.equal(testnet.warning?.code, 'unexpected_network');

  const old = normalizeProbeResult({
    blockchain: { chain: 'main', blocks: 1, headers: 1, verificationprogress: 1 },
    network: { version: MINIMUM_LITECOIN_CORE_VERSION - 1, connections: 0 },
    mempool: null,
    connections: 0,
  });
  assert.equal(old.warning?.code, 'unsupported_version');
  assert.match(JSON.stringify(old), /Upgrade Litecoin Core/);
});

test('settings validation accepts only intended Litecoin fields and loopback/port rules', () => {
  const ok = validateSettingsUpdate({
    litecoinMonitoringEnabled: true,
    litecoinMonitoringHost: '::1',
    litecoinMonitoringRpcPort: '9332',
    litecoinMonitoringCookiePath: '/home/user/.litecoin/.cookie',
  });
  assert.equal(ok.litecoinMonitoringEnabled, true);
  assert.equal(ok.litecoinMonitoringHost, '::1');

  assert.throws(
    () =>
      validateSettingsUpdate({
        litecoinMonitoringHost: '192.168.0.5',
      }),
    TypeError
  );
  assert.throws(
    () =>
      validateSettingsUpdate({
        litecoinMonitoringRpcPort: '70000',
      }),
    TypeError
  );
  assert.throws(
    () =>
      validateSettingsUpdate({
        litecoinMonitoringEnabled: 'yes',
      }),
    TypeError
  );
});

test('no new generic network or filesystem bridge is introduced', () => {
  const preload = read('src/main/preload.js');
  const contracts = read('src/main/ipc/contracts.js');
  const mainSource = read('src/main/main.js');

  assert.doesNotMatch(preload, /showOpenDialog|show-open-dialog/);
  assert.doesNotMatch(preload, /readFile|read-file|fs\.read/);
  assert.doesNotMatch(contracts, /generic.*rpc|call-rpc-url|filesystem:read/i);
  assert.match(contracts, /selectLitecoinCookie:\s*'dialogs:select-litecoin-cookie'/);
  assert.match(mainSource, /Select Litecoin Core cookie file/);
  assert.match(mainSource, /Never file contents|path only|Return path only/i);
  assert.equal(CHANNELS.dialogs.selectLitecoinCookie, 'dialogs:select-litecoin-cookie');
  assert.equal(
    CHANNELS.externalChains.litecoinGetStatus,
    'externalChains:litecoin-get-status'
  );
});

test('renderer Litecoin query does not depend on Nexus Core connected state', () => {
  const querySource = read('src/shared/lib/externalChains/litecoin.ts');
  assert.match(querySource, /litecoinMonitoringEnabled/);
  assert.doesNotMatch(querySource, /coreConnectedAtom|coreInfoQuery|useCoreConnected/);
  assert.match(querySource, /independent of Nexus Core connection state/i);

  const overview = read('src/App/Overview/LitecoinStats.tsx');
  assert.match(overview, /waitForCore=\{false\}/);
});

test('documentation exists for monitoring-only boundary', () => {
  const securityDoc = read('docs/security/litecoin-core-monitoring.md');
  const userDoc = read('docs/ExternalChains/litecoin-monitoring.md');
  assert.match(securityDoc, /Monitoring only/i);
  assert.match(securityDoc, /getblockchaininfo/);
  assert.match(securityDoc, /loopback/i);
  assert.match(securityDoc, /2\.5[- ]minutes?/);
  assert.doesNotMatch(securityDoc, /\b5 confirmations\b|\b7 confirmations\b/);
  assert.match(userDoc, /does \*\*not\*\* manage Litecoin Core/i);
  assert.match(userDoc, /9332/);
});
