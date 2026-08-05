'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertExternalUrl,
  assertRelativeModulePath,
  validateCoreRpcRequest,
  validateModuleDownloadRequest,
  validateNoArguments,
} = require('../../src/main/ipc/contracts');

test('external URLs require an allowlisted HTTPS host', () => {
  assert.equal(
    assertExternalUrl('https://github.com/NamecoinGithub/NexusInterface'),
    'https://github.com/NamecoinGithub/NexusInterface'
  );
  assert.equal(
    assertExternalUrl('mailto:security@nexus.io', 'Contact URL', {
      mailto: true,
    }),
    'mailto:security@nexus.io'
  );

  for (const value of [
    'http://github.com/Nexus',
    'https://github.com.evil.example/Nexus',
    'https://github.com@evil.example/Nexus',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => assertExternalUrl(value), TypeError);
  }
});

test('module paths reject traversal and platform-specific absolute paths', () => {
  assert.equal(assertRelativeModulePath('assets/icon.svg'), 'assets/icon.svg');
  for (const value of [
    '../secret',
    'assets/../../secret',
    '/etc/passwd',
    '\\\\server\\share',
    'C:\\Windows\\system32',
    'assets/\0icon.svg',
  ]) {
    assert.throws(() => assertRelativeModulePath(value), TypeError);
  }
});

test('IPC request validators reject malformed and unexpected requests', () => {
  assert.deepEqual(
    validateCoreRpcRequest({ endpoint: 'system/stop', params: {} }),
    { endpoint: 'system/stop', params: {} }
  );
  assert.deepEqual(
    validateModuleDownloadRequest({
      moduleName: 'wallet_tools',
      owner: 'NamecoinGithub',
      repo: 'NexusInterface',
      releaseId: 'latest',
    }),
    {
      moduleName: 'wallet_tools',
      owner: 'NamecoinGithub',
      repo: 'NexusInterface',
      releaseId: 'latest',
    }
  );

  for (const request of [
    { endpoint: '../system/stop' },
    { endpoint: 'system//stop' },
    { endpoint: 'System/stop' },
    { endpoint: 'system/stop', params: [] },
  ]) {
    assert.throws(() => validateCoreRpcRequest(request), TypeError);
  }
  assert.throws(
    () =>
      validateModuleDownloadRequest({
        moduleName: '../wallet',
        owner: 'owner',
        repo: 'repo',
        releaseId: 1,
      }),
    TypeError
  );
  assert.equal(validateNoArguments(undefined), undefined);
  assert.throws(() => validateNoArguments({}), TypeError);
});
