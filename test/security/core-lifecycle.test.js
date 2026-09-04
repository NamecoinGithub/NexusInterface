'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createCoreLifecycleCoordinator,
} = require('../../src/main/coreLifecycle');
const {
  commandUsesDataDir,
  splitCommandParts,
} = require('../../src/main/coreProcessPolicy');
const {
  abortBootstrap,
  bootstrapConstants,
  startBootstrap,
} = require('../../src/main/bootstrap');

const root = path.resolve(__dirname, '../..');
const read = (...segments) =>
  fs.readFileSync(path.join(root, ...segments), 'utf8');

test('Core lifecycle coordinator serializes operations and releases after failure', async () => {
  const coordinator = createCoreLifecycleCoordinator();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.run('first', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = coordinator.run('second', async () => {
    events.push('second:start');
    throw new Error('expected');
  });
  const third = coordinator.run('third', async () => {
    events.push('third:start');
    return 'done';
  });

  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  assert.equal(coordinator.getActiveOperation(), 'first');
  releaseFirst();
  await first;
  await assert.rejects(second, /expected/);
  assert.equal(await third, 'done');
  assert.deepEqual(events, [
    'first:start',
    'first:end',
    'second:start',
    'third:start',
  ]);
  assert.equal(coordinator.getActiveOperation(), null);
});

test('Core lifecycle shutdown rejects operations queued after shutdown', async () => {
  const coordinator = createCoreLifecycleCoordinator();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.run('start', () => firstGate);
  const shutdown = coordinator.shutdown(async () => {
    events.push('shutdown');
  });
  await assert.rejects(
    coordinator.run('restart', () => events.push('restart')),
    /shutting down/
  );

  releaseFirst();
  await first;
  await shutdown;
  assert.deepEqual(events, ['shutdown']);
});

test('Core datadir matching handles quoted values and Windows case differences', () => {
  assert.deepEqual(
    splitCommandParts(
      '"C:\\Program Files\\Nexus\\nexus-win32-x64.exe" -datadir="C:\\Users\\Alice\\Nexus Data" -verbose=3'
    ),
    [
      'C:\\Program Files\\Nexus\\nexus-win32-x64.exe',
      '-datadir=C:\\Users\\Alice\\Nexus Data',
      '-verbose=3',
    ]
  );
  assert.equal(
    commandUsesDataDir(
      'nexus.exe "-datadir=C:\\Users\\Alice\\Nexus Data"',
      'c:/users/alice/nexus data/',
      'win32'
    ),
    true
  );
  assert.equal(
    commandUsesDataDir(
      'nexus -datadir=/Users/alice/Library/Application Support/Nexus -verbose=3',
      '/Users/alice/Library/Application Support/Nexus',
      'darwin'
    ),
    true
  );
  assert.equal(
    commandUsesDataDir(
      'nexus.exe -datadir="C:\\Users\\Bob\\Nexus Data"',
      'C:\\Users\\Alice\\Nexus Data',
      'win32'
    ),
    false
  );
});

test('all destructive Core operations use the lifecycle coordinator', () => {
  const main = read('src', 'main', 'main.js');
  const core = read('src', 'main', 'core.js');
  const coreRpcRegistry = read('src', 'main', 'ipc', 'coreRpcRegistry.js');
  const rendererCore = read('src', 'shared', 'lib', 'core.ts');
  const coreSettings = read(
    'src',
    'App',
    'Settings',
    'Core',
    'EmbeddedCoreSettings.tsx'
  );

  for (const label of [
    'start',
    'restart',
    'stop',
    'kill',
    'resync-lite',
    'bootstrap',
  ]) {
    assert.match(
      main,
      new RegExp(`coreLifecycle\\s*\\.run\\(\\s*['"]${label}['"]`)
    );
  }
  assert.match(main, /coreLifecycle\s*\.shutdown\(/);
  assert.match(
    main,
    /coreLifecycle\.run\('update-settings',[\s\S]*stopEmbeddedCore\(\)[\s\S]*updateSettingsFile\(updates\)/
  );
  assert.match(rendererCore, /nexusElectron\.core\.stop\(\)/);
  assert.match(rendererCore, /nexusElectron\.core\.restart\(\)/);
  assert.match(
    rendererCore,
    /resyncLiteCore[\s\S]*coreInfoPausedAtom,\s*true[\s\S]*resyncLiteDatabase\(\)[\s\S]*coreInfoPausedAtom,\s*false/
  );
  assert.doesNotMatch(rendererCore, /callAPI\(['"]system\/stop['"]/);
  assert.doesNotMatch(coreRpcRegistry, /'system\/stop':\s*defineEndpoint/);
  assert.doesNotMatch(
    coreSettings,
    /stopCore\(\)[\s\S]*resyncLiteDatabase\(\)[\s\S]*startCore\(\)/
  );
  assert.match(
    core,
    /const stopResult = await stopEmbeddedCore\(\)[\s\S]*await startConfiguredCore\(\)/
  );
  assert.match(
    core,
    /restartResult\?\.apiReachable === false/
  );
  assert.match(
    main,
    /'embeddedCoreBinaryPath'[\s\S]*coreTargetChanged[\s\S]*stopEmbeddedCore\(\)/
  );
  assert.match(
    main,
    /coreLifecycle\.run\('start',[\s\S]*startConfiguredCore\(\)[\s\S]*if \(result\?\.started\) coreRpcSessionPolicy\.reset\(\)/
  );
});

test('bootstrap fails closed until signed-manifest verification exists', async () => {
  const mainBootstrap = read('src', 'main', 'bootstrap.js');
  const rendererBootstrap = read('src', 'shared', 'lib', 'bootstrap.ts');
  const statuses = [];

  assert.equal(bootstrapConstants.enabled, false);
  assert.deepEqual(abortBootstrap(), { aborted: false, reason: 'disabled' });
  await assert.rejects(
    startBootstrap((status) => statuses.push(status)),
    /authenticated by a signed manifest/
  );
  assert.deepEqual(statuses, [{ step: 'idle', details: undefined }]);
  assert.match(mainBootstrap, /authenticated by a signed manifest/);
  assert.doesNotMatch(mainBootstrap, /https\.get|createWriteStream|extractSafeZip/);
  assert.match(rendererBootstrap, /remoteBootstrapEnabled\s*=\s*false/);
});

test('Windows Core discovery falls back from CIM to legacy WMI before tasklist', () => {
  const core = read('src', 'main', 'core.js');
  const cim = core.indexOf('Get-CimInstance Win32_Process');
  const wmi = core.indexOf('Get-WmiObject Win32_Process');
  const tasklist = core.indexOf("'tasklist'");

  assert.ok(cim >= 0);
  assert.ok(wmi > cim);
  assert.ok(tasklist > wmi);
  assert.match(core, /core\.processes\.cim\.failed/);
  assert.match(core, /core\.processes\.wmi\.failed/);
  assert.match(core, /ownership-unconfirmed/);
  assert.match(core, /ownershipUnknown/);
  assert.match(core, /commandKnown:\s*false/);
  assert.match(
    core,
    /return processState\.ownershipUnknown\s*\?\s*\{ stopped: false, reason: 'ownership-unconfirmed' \}/
  );
  assert.match(core, /trackedPidRunning/);
  assert.match(core, /killCorePid\(managedPid\)/);
});
