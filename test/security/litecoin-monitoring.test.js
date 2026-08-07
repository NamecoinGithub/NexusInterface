'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ALLOWED_RPC_METHODS,
  MAX_RESPONSE_BYTES,
  MINIMUM_LITECOIN_CORE_VERSION,
  MINIMUM_LITECOIN_CORE_VERSION_LABEL,
  REQUEST_TIMEOUT_MS,
  buildConfigKey,
  classifyNetwork,
  getLitecoinNodeStatus,
  mapFailure,
  normalizeProbeResult,
  parseCookieContents,
  resetLitecoinMonitorCache,
  settingsAffectLitecoinMonitor,
  validateCookiePath,
  validateHost,
  validatePort,
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

function baseSettings(overrides = {}) {
  return {
    litecoinMonitoringEnabled: true,
    litecoinMonitoringHost: '127.0.0.1',
    litecoinMonitoringRpcPort: '9332',
    litecoinMonitoringCookiePath: path.join(os.tmpdir(), 'ltc-test.cookie'),
    ...overrides,
  };
}

test('disabled or unconfigured monitoring returns not_configured', async () => {
  resetLitecoinMonitorCache();
  const disabled = await getLitecoinNodeStatus({
    bypassCache: true,
    settings: baseSettings({ litecoinMonitoringEnabled: false }),
  });
  assert.equal(disabled.error?.code, 'not_configured');
  assert.equal(disabled.connected, false);
  assert.equal(disabled.freshness, 'unavailable');

  resetLitecoinMonitorCache();
  const missingCookie = await getLitecoinNodeStatus({
    bypassCache: true,
    settings: baseSettings({ litecoinMonitoringCookiePath: '' }),
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
    settings: baseSettings(),
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
  assert.match(mainSource, /settingsAffectLitecoinMonitor|resetLitecoinMonitorCache/);
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
      settings: baseSettings(),
      readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
      rpcCall: async () => {
        throw Object.assign(new Error('x'), { code: throwCode });
      },
    });
    assert.equal(status.error?.code, expected);
    assert.equal(status.connected, false);
    assert.equal(status.freshness, 'unavailable');
  }

  assert.equal(mapFailure('invalid_response').error.code, 'invalid_response');
  assert.equal(mapFailure('authentication_failed').error.code, 'authentication_failed');
});

test('network classification and version/network warnings', () => {
  assert.equal(classifyNetwork('main'), 'main');
  assert.equal(classifyNetwork('mainnet'), 'main');
  assert.equal(classifyNetwork('test'), 'test');
  assert.equal(classifyNetwork('testnet4'), 'test');
  assert.equal(classifyNetwork('regtest'), 'regtest');
  assert.equal(classifyNetwork('signet'), 'unknown');
  assert.equal(classifyNetwork(''), 'unknown');

  assert.equal(MINIMUM_LITECOIN_CORE_VERSION, 210506);
  assert.equal(MINIMUM_LITECOIN_CORE_VERSION_LABEL, '0.21.5.6');

  const mainOk = normalizeProbeResult({
    blockchain: {
      chain: 'main',
      blocks: 10,
      headers: 10,
      verificationprogress: 1,
      initialblockdownload: false,
    },
    network: {
      version: Math.max(MINIMUM_LITECOIN_CORE_VERSION, 210506),
      connections: 8,
    },
    mempool: { size: 2, bytes: 100 },
    connections: 8,
  });
  assert.equal(mainOk.connected, true);
  assert.equal(mainOk.network, 'main');
  assert.equal(mainOk.warning, undefined);
  assert.equal(mainOk.blocks, 10);
  assert.equal(mainOk.mempoolTransactions, 2);
  assert.equal(mainOk.freshness, 'live');

  const testnet = normalizeProbeResult({
    blockchain: { chain: 'test', blocks: 1, headers: 1, verificationprogress: 0.5 },
    network: { version: MINIMUM_LITECOIN_CORE_VERSION, connections: 1 },
    mempool: null,
    connections: 1,
  });
  assert.equal(testnet.connected, true);
  assert.equal(testnet.network, 'test');
  assert.equal(testnet.warning?.code, 'unexpected_network');

  const old = normalizeProbeResult({
    blockchain: { chain: 'main', blocks: 1, headers: 1, verificationprogress: 1 },
    network: { version: MINIMUM_LITECOIN_CORE_VERSION - 1, connections: 0 },
    mempool: null,
    connections: 0,
  });
  assert.equal(old.connected, true);
  assert.equal(old.warning?.code, 'unsupported_version');
  assert.match(JSON.stringify(old), /Upgrade Litecoin Core/);
  assert.match(old.warning.message, /0\.21\.5\.6/);

  const unknownVersion = normalizeProbeResult({
    blockchain: { chain: 'main', blocks: 1, headers: 1, verificationprogress: 1 },
    network: { connections: 0 },
    mempool: null,
    connections: 0,
  });
  assert.equal(unknownVersion.connected, true);
  assert.equal(unknownVersion.warning?.code, 'unknown_version');

  const malformed = normalizeProbeResult({
    blockchain: { chain: 'main' },
    network: { version: MINIMUM_LITECOIN_CORE_VERSION },
    mempool: null,
    connections: 0,
  });
  assert.equal(malformed.connected, false);
  assert.equal(malformed.freshness, 'unavailable');
  assert.equal(malformed.error?.code, 'invalid_response');
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

  assert.equal(
    settingsAffectLitecoinMonitor({ litecoinMonitoringRpcPort: '9333' }),
    true
  );
  assert.equal(settingsAffectLitecoinMonitor({ locale: 'en' }), false);
});

test('cache is configuration-aware and labels cached/stale freshness', async () => {
  resetLitecoinMonitorCache();
  let calls = 0;
  const settingsA = baseSettings({
    litecoinMonitoringRpcPort: '9332',
    litecoinMonitoringCookiePath: '/tmp/a.cookie',
  });
  const settingsB = baseSettings({
    litecoinMonitoringRpcPort: '9333',
    litecoinMonitoringCookiePath: '/tmp/b.cookie',
  });

  assert.notEqual(buildConfigKey(settingsA), buildConfigKey(settingsB));

  const live = await getLitecoinNodeStatus({
    settings: settingsA,
    readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
    rpcCall: async () => {
      calls += 1;
      return {
        blockchain: {
          chain: 'main',
          blocks: 100,
          headers: 100,
          verificationprogress: 1,
          initialblockdownload: false,
        },
        network: { version: MINIMUM_LITECOIN_CORE_VERSION, connections: 3 },
        mempool: { size: 1, bytes: 10 },
        connections: 3,
      };
    },
  });
  assert.equal(live.freshness, 'live');
  assert.equal(live.blocks, 100);
  assert.equal(calls, 1);

  const cached = await getLitecoinNodeStatus({
    settings: settingsA,
    readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
    rpcCall: async () => {
      calls += 1;
      throw new Error('should not be called while cached');
    },
  });
  assert.equal(cached.freshness, 'cached');
  assert.equal(cached.blocks, 100);
  assert.equal(calls, 1);

  // Different configuration must not reuse the previous endpoint cache.
  const other = await getLitecoinNodeStatus({
    settings: settingsB,
    readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
    rpcCall: async () => {
      calls += 1;
      return {
        blockchain: {
          chain: 'main',
          blocks: 200,
          headers: 200,
          verificationprogress: 1,
          initialblockdownload: false,
        },
        network: { version: MINIMUM_LITECOIN_CORE_VERSION, connections: 1 },
        mempool: null,
        connections: 1,
      };
    },
  });
  assert.equal(other.freshness, 'live');
  assert.equal(other.blocks, 200);
  assert.equal(calls, 2);

  resetLitecoinMonitorCache();
  calls = 0;
  await getLitecoinNodeStatus({
    bypassCache: true,
    settings: settingsA,
    readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
    rpcCall: async () => {
      calls += 1;
      return {
        blockchain: {
          chain: 'main',
          blocks: 50,
          headers: 50,
          verificationprogress: 1,
        },
        network: { version: MINIMUM_LITECOIN_CORE_VERSION, connections: 2 },
        mempool: null,
        connections: 2,
      };
    },
  });
  assert.equal(calls, 1);

  const stale = await getLitecoinNodeStatus({
    bypassCache: true,
    settings: settingsA,
    readCookie: () => ({ ok: true, username: 'u', password: 'p' }),
    rpcCall: async () => {
      calls += 1;
      throw Object.assign(new Error('down'), { code: 'connection_refused' });
    },
  });
  assert.equal(stale.freshness, 'stale');
  // Retained metrics must not claim current reachability.
  assert.equal(stale.connected, false);
  assert.equal(stale.blocks, 50);
  assert.equal(stale.error?.code, 'connection_refused');
  assert.equal(typeof stale.fetchedAt, 'string');
  assert.equal(calls, 2);
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
  // Query identity uses a non-secret fingerprint — never raw cookie paths.
  assert.match(querySource, /litecoinMonitoringConfigFingerprint/);
  assert.match(
    querySource,
    /queryKey:[\s\S]*litecoinMonitoringConfigFingerprint\(settings\)/
  );
  assert.doesNotMatch(
    querySource,
    /queryKey:[\s\S]*litecoinMonitoringCookiePath/
  );
  assert.match(querySource, /'live' \| 'cached' \| 'stale' \| 'unavailable'/);
  assert.match(
    querySource,
    /Stale retained metrics must not count as connected/
  );

  const overview = read('src/App/Overview/LitecoinStats.tsx');
  assert.match(overview, /waitForCore=\{false\}/);
  assert.match(overview, /Stale — last successful probe/);
  assert.doesNotMatch(
    overview,
    /isLitecoinStatusConnected\(status\)[\s\S]*Connected/
  );

  const settingsUi = read('src/App/Settings/ExternalChains/index.tsx');
  assert.match(settingsUi, /Stale — last successful probe/);
  assert.match(
    settingsUi,
    /came from the last successful probe/
  );
  assert.match(
    settingsUi,
    /retained metrics, not a current connection/
  );
  assert.match(settingsUi, /persistLitecoinMonitoringSettings/);
});

test('documentation exists for monitoring-only boundary and version policy', () => {
  const securityDoc = read('docs/security/litecoin-core-monitoring.md');
  const userDoc = read('docs/ExternalChains/litecoin-monitoring.md');
  assert.match(securityDoc, /Monitoring only/i);
  assert.match(securityDoc, /getblockchaininfo/);
  assert.match(securityDoc, /loopback/i);
  assert.match(securityDoc, /2\.5[- ]minutes?/);
  assert.match(securityDoc, /210506/);
  assert.match(securityDoc, /0\.21\.5\.6/);
  assert.match(securityDoc, /litecoin-project\/litecoin\/releases\/tag\/v0\.21\.5\.6/);
  assert.match(securityDoc, /freshness/);
  assert.match(securityDoc, /connected:\s*false/i);
  assert.match(securityDoc, /current reachability/i);
  assert.doesNotMatch(securityDoc, /\b5 confirmations\b|\b7 confirmations\b/);
  assert.match(userDoc, /does \*\*not\*\* manage Litecoin Core/i);
  assert.match(userDoc, /9332/);
  assert.match(userDoc, /0\.21\.5\.6/);
  assert.match(userDoc, /Stale/i);
});

test('bridge DTO and sequence timeout cleanup stay in sync', () => {
  const globalDts = read('src/global.d.ts');
  assert.match(
    globalDts,
    /freshness:\s*'live'\s*\|\s*'cached'\s*\|\s*'stale'\s*\|\s*'unavailable'/
  );
  assert.match(globalDts, /unknown_version/);
  assert.match(globalDts, /connected:\s*false/);

  const monitor = read('src/main/litecoinMonitor.js');
  assert.match(monitor, /clearTimeout\(sequenceTimer\)/);
  assert.match(
    monitor,
    /asStaleFromLastGood[\s\S]*connected:\s*false[\s\S]*freshness:\s*'stale'/
  );
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function writeTempCookie(contents = '__cookie__:transport-secret-value') {
  const cookiePath = path.join(
    os.tmpdir(),
    `ltc-monitor-test-${process.pid}-${Date.now()}.cookie`
  );
  fs.writeFileSync(cookiePath, contents, 'utf8');
  return cookiePath;
}

test('transport: mock JSON-RPC server enforces auth, allowlist, and success path', async () => {
  resetLitecoinMonitorCache();
  const methods = [];
  let sawAuthorization = false;
  let leakedSecret = false;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      if (auth.startsWith('Basic ')) {
        sawAuthorization = true;
      }
      if (body.includes('transport-secret-value') || auth.includes('transport-secret-value')) {
        // Body should never include raw password; Basic auth is base64.
        leakedSecret = body.includes('transport-secret-value');
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end('bad');
        return;
      }
      methods.push(parsed.method);
      if (!ALLOWED_RPC_METHODS.has(parsed.method)) {
        res.statusCode = 500;
        res.end(JSON.stringify({ result: null, error: { message: 'denied' }, id: parsed.id }));
        return;
      }
      const results = {
        getblockchaininfo: {
          chain: 'main',
          blocks: 42,
          headers: 42,
          verificationprogress: 1,
          initialblockdownload: false,
        },
        getnetworkinfo: {
          version: MINIMUM_LITECOIN_CORE_VERSION,
          // Omit connections so fallback getconnectioncount is exercised.
        },
        getmempoolinfo: { size: 7, bytes: 99 },
        getconnectioncount: 4,
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          result: results[parsed.method],
          error: null,
          id: parsed.id,
        })
      );
    });
  });

  const port = await listen(server);
  const cookiePath = writeTempCookie();
  try {
    const status = await getLitecoinNodeStatus({
      bypassCache: true,
      settings: baseSettings({
        litecoinMonitoringRpcPort: String(port),
        litecoinMonitoringCookiePath: cookiePath,
      }),
    });

    assert.equal(status.connected, true);
    assert.equal(status.freshness, 'live');
    assert.equal(status.blocks, 42);
    assert.equal(status.connections, 4);
    assert.equal(status.mempoolTransactions, 7);
    assert.equal(sawAuthorization, true);
    assert.equal(leakedSecret, false);
    assert.deepEqual(methods, [
      'getblockchaininfo',
      'getnetworkinfo',
      'getmempoolinfo',
      'getconnectioncount',
    ]);
    assert.equal(JSON.stringify(status).includes('transport-secret-value'), false);
    assert.equal(JSON.stringify(status).includes('Authorization'), false);
  } finally {
    fs.unlinkSync(cookiePath);
    await closeServer(server);
  }
});

test('transport: mandatory methods fail closed; oversized and malformed rejected', async () => {
  resetLitecoinMonitorCache();

  // Missing getblockchaininfo envelope / RPC error path via malformed JSON.
  {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end('not-json');
    });
    const port = await listen(server);
    const cookiePath = writeTempCookie();
    try {
      const status = await getLitecoinNodeStatus({
        bypassCache: true,
        settings: baseSettings({
          litecoinMonitoringRpcPort: String(port),
          litecoinMonitoringCookiePath: cookiePath,
        }),
      });
      assert.equal(status.connected, false);
      assert.equal(status.error?.code, 'invalid_response');
    } finally {
      fs.unlinkSync(cookiePath);
      await closeServer(server);
    }
  }

  // Oversized payload.
  {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      // Stream more than MAX_RESPONSE_BYTES without holding it all in one string.
      const chunk = 'a'.repeat(64 * 1024);
      let sent = 0;
      res.write('{"result":"');
      while (sent < MAX_RESPONSE_BYTES + 1024) {
        res.write(chunk);
        sent += chunk.length;
      }
      res.end('","error":null,"id":1}');
    });
    const port = await listen(server);
    const cookiePath = writeTempCookie();
    try {
      const status = await getLitecoinNodeStatus({
        bypassCache: true,
        settings: baseSettings({
          litecoinMonitoringRpcPort: String(port),
          litecoinMonitoringCookiePath: cookiePath,
        }),
      });
      assert.equal(status.connected, false);
      assert.equal(status.error?.code, 'invalid_response');
    } finally {
      fs.unlinkSync(cookiePath);
      await closeServer(server);
    }
  }

  // Malformed JSON-RPC envelope (array).
  {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end('[]');
    });
    const port = await listen(server);
    const cookiePath = writeTempCookie();
    try {
      const status = await getLitecoinNodeStatus({
        bypassCache: true,
        settings: baseSettings({
          litecoinMonitoringRpcPort: String(port),
          litecoinMonitoringCookiePath: cookiePath,
        }),
      });
      assert.equal(status.error?.code, 'invalid_response');
    } finally {
      fs.unlinkSync(cookiePath);
      await closeServer(server);
    }
  }
});

test('transport: hanging server is bounded by request timeout', async () => {
  resetLitecoinMonitorCache();
  const server = http.createServer((req, res) => {
    // Never respond.
    req.on('data', () => {});
  });
  const port = await listen(server);
  const cookiePath = writeTempCookie();
  const started = Date.now();
  try {
    const status = await getLitecoinNodeStatus({
      bypassCache: true,
      settings: baseSettings({
        litecoinMonitoringRpcPort: String(port),
        litecoinMonitoringCookiePath: cookiePath,
      }),
    });
    const elapsed = Date.now() - started;
    assert.equal(status.connected, false);
    assert.equal(status.error?.code, 'timeout');
    // Should not wait far beyond the per-request timeout + sequence ceiling.
    assert.ok(
      elapsed < REQUEST_TIMEOUT_MS + 7000,
      `timeout too slow: ${elapsed}ms`
    );
  } finally {
    fs.unlinkSync(cookiePath);
    await closeServer(server);
  }
});
