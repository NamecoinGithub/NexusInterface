'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fromKeyValues,
  parseBooleanFlag,
  resolveApiPortSSL,
  resolveEmbeddedCoreConnection,
  toKeyValues,
} = require('../../src/main/ipc/coreConf');

test('fromKeyValues trims Windows newlines and ignores comments', () => {
  const conf = fromKeyValues(
    'apiuser=apiserver\r\napipassword=secret\r\n# comment\r\napissl=1\r\n'
  );
  assert.deepEqual(conf, {
    apiuser: 'apiserver',
    apipassword: 'secret',
    apissl: '1',
  });
});

test('fromKeyValues strips a leading UTF-8 BOM from the first key', () => {
  const conf = fromKeyValues('\uFEFFapiuser=apiserver\napipassword=secret\n');
  assert.equal(conf.apiuser, 'apiserver');
  assert.equal(conf.apipassword, 'secret');
  assert.equal(conf['\uFEFFapiuser'], undefined);
});

test('resolveApiPortSSL accepts both conf key spellings', () => {
  assert.equal(resolveApiPortSSL({ apiportssl: '7080' }, '8443'), '7080');
  assert.equal(resolveApiPortSSL({ apisslport: '7099' }, '8443'), '7099');
  assert.equal(resolveApiPortSSL({}, '7080'), '7080');
});

test('parseBooleanFlag accepts Core-style 0/1 and true/false', () => {
  assert.equal(parseBooleanFlag('0', true), false);
  assert.equal(parseBooleanFlag('false', true), false);
  assert.equal(parseBooleanFlag('1', false), true);
  assert.equal(parseBooleanFlag(true, false), true);
  assert.equal(parseBooleanFlag(undefined, true), true);
});

test('settings overlay forces SSL/port alignment even when conf is stale', () => {
  const resolved = resolveEmbeddedCoreConnection(
    {
      apiuser: 'apiserver',
      apipassword: 'existing-secret',
      // Stale conf that would make the GUI open plain HTTP while Core is
      // started with -apissl=1 (historical wallet launch flags).
      apissl: '0',
      apiport: '18080',
      // Core CLI-style key only — must be recognized and canonicalized.
      apisslport: '8443',
    },
    {
      embeddedCoreUseNonSSL: false,
      embeddedCoreApiPort: undefined,
      embeddedCoreApiPortSSL: undefined,
      generatedApiPassword: 'should-not-replace',
    }
  );

  assert.equal(resolved.changed, true);
  assert.equal(resolved.connection.apiSSL, true);
  assert.equal(resolved.connection.apiPort, '18080');
  // Existing conf SSL port is preserved when settings do not override it.
  assert.equal(resolved.connection.apiPortSSL, '8443');
  assert.equal(resolved.connection.apiPassword, 'existing-secret');
  assert.equal(resolved.conf.apiportssl, '8443');
  assert.equal(resolved.conf.apissl, '1');
  assert.equal(resolved.conf.apisslport, undefined);

  // Serialized conf keeps a single SSL port key the GUI and Core both understand.
  const serialized = toKeyValues(resolved.conf);
  assert.match(serialized, /apiportssl=8443/);
  assert.doesNotMatch(serialized, /apisslport=/);
});

test('wallet SSL port setting overrides a default Core 8443 conf value', () => {
  const resolved = resolveEmbeddedCoreConnection(
    {
      apiuser: 'apiserver',
      apipassword: 'secret',
      apissl: '1',
      apiport: '8080',
      apiportssl: '8443',
    },
    {
      embeddedCoreUseNonSSL: false,
      embeddedCoreApiPortSSL: '7080',
      generatedApiPassword: 'unused',
    }
  );

  assert.equal(resolved.connection.apiPortSSL, '7080');
  assert.equal(resolved.conf.apiportssl, '7080');
});

test('missing credentials are created so Core enables its API server', () => {
  const resolved = resolveEmbeddedCoreConnection(
    {},
    {
      embeddedCoreUseNonSSL: false,
      generatedApiPassword: 'generated-secret',
    }
  );

  assert.equal(resolved.changed, true);
  assert.equal(resolved.connection.apiUser, 'apiserver');
  assert.equal(resolved.connection.apiPassword, 'generated-secret');
  assert.equal(resolved.connection.apiSSL, true);
  assert.equal(resolved.connection.apiPort, '8080');
  assert.equal(resolved.connection.apiPortSSL, '7080');
});
