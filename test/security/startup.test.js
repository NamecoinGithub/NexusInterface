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

  assert.match(core, /apiuser=\$\{configuration\.apiUser\}/);
  assert.match(core, /apipassword=\$\{configuration\.apiPassword\}/);
  assert.match(core, /apissl=\$\{apiSSL \? '1' : '0'\}/);
  assert.match(core, /probeCoreApi/);
  assert.match(core, /apiReachable/);
  assert.match(coreRpc, /probeCoreApi/);
  assert.match(coreRpc, /resolveEmbeddedCoreConnection/);
  // Renderer must not short-circuit before main can probe/restart a mismatched Core.
  assert.match(rendererCore, /window\.nexusElectron\.core\.start\(\)/);
  assert.doesNotMatch(
    rendererCore,
    /if \(status\.running\) \{\s*console\.info\([\s\S]*Skipping starting core/
  );
});
