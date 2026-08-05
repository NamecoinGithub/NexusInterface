'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertExternalUrl,
  assertRelativeModulePath,
  validateClipboardText,
  validateCoreRpcRequest,
  validateCoreRpcUrl,
  validateModuleDownloadRequest,
  validateNoArguments,
  validateTrackEventRequest,
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
    { endpoint: 'evil/get/info' },
    { endpoint: 'shell/exec' },
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

test('Core RPC URL validation enforces relative paths and namespaces', () => {
  assert.equal(validateCoreRpcUrl('system/get/info'), 'system/get/info');
  assert.equal(validateCoreRpcUrl('/finance/list/any'), 'finance/list/any');
  assert.equal(
    validateCoreRpcUrl('finance/get/any?name=default'),
    'finance/get/any?name=default'
  );
  assert.equal(
    validateCoreRpcUrl('names/get/name/user:alice'),
    'names/get/name/user:alice'
  );

  for (const value of [
    'http://127.0.0.1/system/get/info',
    '../system/get/info',
    'system/../../etc/passwd',
    'evil/get/info',
    'System/get/info',
    'system/get/info#frag',
    'system/get/info?redirect=https://evil.example',
    '',
  ]) {
    assert.throws(() => validateCoreRpcUrl(value), TypeError);
  }
});

test('clipboard and analytics validators enforce bounds', () => {
  assert.equal(validateClipboardText('address'), 'address');
  assert.throws(() => validateClipboardText('x'.repeat(1000001)), TypeError);

  assert.deepEqual(validateTrackEventRequest({ eventName: 'login' }), {
    eventName: 'login',
    props: undefined,
  });
  assert.deepEqual(
    validateTrackEventRequest({
      eventName: 'send',
      props: { amount: 1, token: 'NXS' },
    }),
    { eventName: 'send', props: { amount: 1, token: 'NXS' } }
  );
  for (const request of [
    { eventName: '' },
    { eventName: 'bad name' },
    { eventName: 'login', props: [] },
    {
      eventName: 'login',
      props: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`k${index}`, index])
      ),
    },
  ]) {
    assert.throws(() => validateTrackEventRequest(request), TypeError);
  }
});
