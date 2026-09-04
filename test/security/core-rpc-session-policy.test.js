'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCoreRpcSessionPolicy,
} = require('../../src/main/ipc/coreRpcSessionPolicy');

test('ordinary Core RPC calls use only the main-owned active session', () => {
  const policy = createCoreRpcSessionPolicy();
  const createRequest = {
    endpoint: 'sessions/create/local',
    params: { username: 'alice', password: 'secret', pin: '1234' },
  };
  policy.observe(createRequest, { session: 'active-session-01' });

  assert.deepEqual(
    policy.authorize({
      endpoint: 'finance/get/balances',
      params: { session: 'victim-session-01' },
    }),
    {
      endpoint: 'finance/get/balances',
      params: { session: 'active-session-01' },
    }
  );
});

test('explicit sessions remain limited to session-management endpoints', () => {
  const policy = createCoreRpcSessionPolicy();
  const request = policy.authorize({
    endpoint: 'sessions/status/local',
    params: { session: 'selected-session-01' },
  });

  assert.deepEqual(request, {
    endpoint: 'sessions/status/local',
    params: { session: 'selected-session-01' },
  });
  policy.observe(request, { username: 'alice' });
  assert.deepEqual(
    policy.authorize({ endpoint: 'profiles/status/master' }),
    {
      endpoint: 'profiles/status/master',
      params: { session: 'selected-session-01' },
    }
  );
});

test('stale session selection responses cannot replace a newer session', () => {
  const policy = createCoreRpcSessionPolicy();
  const olderRequest = policy.authorize({
    endpoint: 'sessions/status/local',
    params: { session: 'older-session-01' },
  });
  const newerRequest = policy.authorize({
    endpoint: 'sessions/status/local',
    params: { session: 'newer-session-01' },
  });

  policy.observe(newerRequest, { username: 'bob' });
  policy.observe(olderRequest, { username: 'alice' });

  assert.equal(
    policy.authorize({ endpoint: 'finance/get/balances' }).params.session,
    'newer-session-01'
  );
});

test('session lists initialize the main-owned session deterministically', () => {
  const policy = createCoreRpcSessionPolicy();
  policy.observe(
    { endpoint: 'sessions/list/local' },
    [
      { session: 'older-session-01', accessed: 10 },
      { session: 'latest-session-01', accessed: 20 },
    ]
  );

  assert.deepEqual(policy.authorize({ endpoint: 'finance/get/balances' }), {
    endpoint: 'finance/get/balances',
    params: { session: 'latest-session-01' },
  });
});

test('session lists reconcile stale main-owned sessions', () => {
  const policy = createCoreRpcSessionPolicy();
  policy.observe(
    {
      endpoint: 'sessions/create/local',
      params: { username: 'alice', password: 'secret', pin: '1234' },
    },
    { session: 'stale-session-01' }
  );

  policy.observe(
    { endpoint: 'sessions/list/local' },
    [
      { session: 'older-session-01', accessed: 10 },
      { session: 'latest-session-01', accessed: 20 },
    ]
  );
  assert.equal(
    policy.authorize({ endpoint: 'finance/get/balances' }).params.session,
    'latest-session-01'
  );

  policy.observe({ endpoint: 'sessions/list/local' }, []);
  assert.deepEqual(policy.authorize({ endpoint: 'finance/get/balances' }), {
    endpoint: 'finance/get/balances',
    params: undefined,
  });
});

test('reset clears the main-owned session when the Core instance changes', () => {
  const policy = createCoreRpcSessionPolicy();
  policy.observe(
    {
      endpoint: 'sessions/create/local',
      params: { username: 'alice', password: 'secret', pin: '1234' },
    },
    { session: 'stale-session-01' }
  );

  policy.reset();
  assert.deepEqual(policy.authorize({ endpoint: 'finance/get/balances' }), {
    endpoint: 'finance/get/balances',
    params: undefined,
  });
});
