'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (...segments) =>
  fs.readFileSync(path.join(root, ...segments), 'utf8');

test('window startup configuration keeps wallet and keyboard renderers isolated', () => {
  const renderer = read('src', 'main', 'renderer.js');
  const keyboard = read('src', 'main', 'keyboard.js');
  const preload = read('src', 'main', 'preload.js');

  assert.match(renderer, /nodeIntegration:\s*false/);
  assert.match(renderer, /contextIsolation:\s*true/);
  assert.match(renderer, /sandbox:\s*true/);
  assert.match(renderer, /enableRemoteModule:\s*false/);
  assert.match(keyboard, /nodeIntegration:\s*false/);
  assert.match(keyboard, /contextIsolation:\s*true/);
  assert.match(keyboard, /sandbox:\s*true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /from ['"]electron['"].*clipboard|clipboard.*from ['"]electron['"]/);
  assert.doesNotMatch(preload, /@aptabase\/electron\/renderer/);
});

test('renderer build fails rather than externalizing Node or Electron imports', () => {
  const webpackConfig = read(
    'configs',
    'webpack.config.base.renderer.babel.js'
  );

  assert.match(webpackConfig, /node:\s*false/);
  assert.match(webpackConfig, /electron:\s*false/);
  assert.match(webpackConfig, /electronRenderer:\s*false/);
  assert.match(webpackConfig, /conditionNames:.*browser/);
});

test('embedded Core start always supplies API auth and probes already-running Core', () => {
  const core = read('src', 'main', 'core.js');
  const coreRpc = read('src', 'main', 'coreRpc.js');
  const rendererCore = read('src', 'shared', 'lib', 'core.ts');
  const main = read('src', 'main', 'main.js');
  const coreConf = read('src', 'main', 'ipc', 'coreConf.js');
  const wallet = read('src', 'shared', 'lib', 'wallet.ts');

  assert.match(core, /apiuser=\$\{configuration\.apiUser\}/);
  assert.match(core, /apipassword=\$\{configuration\.apiPassword\}/);
  assert.match(core, /apissl=\$\{apiSSL \? '1' : '0'\}/);
  assert.match(core, /apisslport=\$\{configuration\.apiPortSSL\}/);
  assert.match(core, /probeCoreApi/);
  assert.match(core, /apiReachable/);
  assert.match(core, /waitForCoreApi|CORE_API_READY_TIMEOUT_MS/);
  assert.match(core, /stopEmbeddedCore/);
  assert.match(coreRpc, /probeCoreApi/);
  assert.match(coreRpc, /resolveEmbeddedCoreConnection/);
  // Core only honors apisslport in nexus.conf — never write only apiportssl.
  assert.match(coreConf, /apisslport:\s*desiredPortSSL/);
  assert.match(coreConf, /delete config\.apiportssl/);
  // Main process must stop Core on quit/exit so orphans are not left behind.
  assert.match(main, /stopEmbeddedCore|ensureEmbeddedCoreStopped|shutdownEmbeddedCoreAndAllowQuit/);
  assert.match(main, /before-quit/);
  // Menu/IPC quit must hard-exit: window close is always preventDefault'd so
  // app.quit() alone cannot terminate after allowingFinalQuit is set.
  assert.match(
    main,
    /registerOperation\(\s*CHANNELS\.app\.quit,\s*undefined,\s*async \(\) => \{\s*await shutdownEmbeddedCoreAndAllowQuit\(\);\s*app\.exit\(0\);\s*\}\)/
  );
  // Renderer stop must still force-kill when system/stop fails.
  assert.match(rendererCore, /window\.nexusElectron\.core\.kill\(\)/);
  assert.match(
    rendererCore,
    /Graceful stop request failed[\s\S]*core\.kill\(\)/
  );
  // Wallet close relies on main-process exit to stop Core (no double wait).
  assert.match(wallet, /app\.exit\(\)/);
  assert.doesNotMatch(wallet, /await stopCore\(\)/);
  // Renderer must not short-circuit before main can probe/restart a mismatched Core.
  assert.match(rendererCore, /window\.nexusElectron\.core\.start\(\)/);
  assert.doesNotMatch(
    rendererCore,
    /if \(status\.running\) \{\s*console\.info\([\s\S]*Skipping starting core/
  );
});
