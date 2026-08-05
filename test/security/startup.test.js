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
