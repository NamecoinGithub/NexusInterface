'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (...segments) =>
  fs.readFileSync(path.join(root, ...segments), 'utf8');

test('module asset and entry resolvers reject symlinks and realpath escapes', () => {
  const fileAssets = read('src', 'main', 'fileAssets.js');
  const moduleFiles = read('src', 'main', 'moduleFiles.js');
  const fileServer = read('src', 'main', 'fileServer.js');

  for (const [name, source] of [
    ['fileAssets.js', fileAssets],
    ['moduleFiles.js', moduleFiles],
    ['fileServer.js', fileServer],
  ]) {
    assert.match(source, /lstat/, `${name} must lstat before reading`);
    assert.match(
      source,
      /isSymbolicLink/,
      `${name} must reject symbolic links`
    );
    assert.match(source, /realpath/, `${name} must verify real paths`);
    assert.match(
      source,
      /realpath escapes module root|escapes module root/,
      `${name} must reject realpath escapes`
    );
  }

  assert.match(fileAssets, /assertRelativeModulePath/);
  assert.match(fileAssets, /readModuleIcon/);
  assert.match(moduleFiles, /resolveModuleFile/);
});

test('Electron fullscreen menu role uses the built-in lowercase name', () => {
  const appMenu = read('src', 'shared', 'lib', 'appMenu.ts');
  assert.match(appMenu, /role:\s*['"]togglefullscreen['"]/);
  assert.doesNotMatch(appMenu, /role:\s*['"]toggleFullScreen['"]/);
});

test('Build Guide documents the package engines Node/npm floor', () => {
  const buildGuide = read('docs', 'Build_Guide.md');
  const packageJson = JSON.parse(read('package.json'));

  assert.match(buildGuide, /Node\.js \(min v22\.12\.0\)/);
  assert.match(buildGuide, /NPM \(min v10\.9\.0\)/);
  assert.equal(packageJson.engines.node, '>=22.12.0');
  assert.equal(packageJson.engines.npm, '>=10.9.0');
  assert.doesNotMatch(buildGuide, /min v16\.x/);
  assert.doesNotMatch(buildGuide, /min v8\.x/);
});
