'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const {
  getModuleProxyConfig,
  isAllowedModuleRequest,
} = require('../../src/main/ipc/moduleNetworkPolicy');

const domain = 'http://127.0.0.1:43123';

test('production module sessions can request only their local module assets', () => {
  const policy = { moduleName: 'demo', development: false };

  for (const url of [
    `${domain}/modules/demo/index.html`,
    `${domain}/modules/demo/assets/app.js?version=1`,
    'data:image/png;base64,AAAA',
    'blob:http://127.0.0.1:43123/id',
    'about:blank',
  ]) {
    assert.equal(isAllowedModuleRequest(url, policy, domain), true, url);
  }

  for (const url of [
    `${domain}/modules/other/index.html`,
    `${domain}/modules/demo-evil/index.html`,
    'http://127.0.0.1:8080/private',
    'https://example.com/collect',
    'wss://example.com/socket',
    'file:///etc/passwd',
  ]) {
    assert.equal(isAllowedModuleRequest(url, policy, domain), false, url);
  }
});

test('development module sessions can request only files under their root', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-module-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const root = path.join(temporaryRoot, 'module');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), '');
  const policy = { moduleName: 'demo', development: true, root };

  assert.equal(
    isAllowedModuleRequest(
      pathToFileURL(path.join(root, 'index.html')).toString(),
      policy,
      domain
    ),
    true
  );
  assert.equal(
    isAllowedModuleRequest(
      pathToFileURL(path.join(root, 'assets', 'app.js')).toString(),
      policy,
      domain
    ),
    true
  );
  assert.equal(
    isAllowedModuleRequest(
      pathToFileURL(path.resolve(root, '..', 'other', 'secret')).toString(),
      policy,
      domain
    ),
    false
  );
  assert.equal(
    isAllowedModuleRequest('https://example.com/collect', policy, domain),
    false
  );
});

test('development module requests cannot escape through symlinks', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-module-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const root = path.join(temporaryRoot, 'module');
  const outside = path.join(temporaryRoot, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret'), 'secret');
  fs.symlinkSync(
    outside,
    path.join(root, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  assert.equal(
    isAllowedModuleRequest(
      pathToFileURL(path.join(root, 'link', 'secret')).toString(),
      { moduleName: 'demo', development: true, root },
      domain
    ),
    false
  );
});

test('module proxy blackholes external traffic and bypasses only production assets', () => {
  const production = getModuleProxyConfig(
    { moduleName: 'demo', development: false },
    domain
  );
  assert.match(production.proxyRules, /127\.0\.0\.1:9/);
  assert.match(production.proxyBypassRules, /<-loopback>/);
  assert.match(production.proxyBypassRules, /127\.0\.0\.1:43123/);

  const development = getModuleProxyConfig(
    { moduleName: 'demo', development: true },
    domain
  );
  assert.equal(development.proxyBypassRules, '<-loopback>');
});
