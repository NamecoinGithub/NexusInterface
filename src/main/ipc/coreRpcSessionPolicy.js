'use strict';

const SESSION_OVERRIDE_ENDPOINTS = new Set([
  'sessions/terminate/local',
  'sessions/unlock/local',
  'sessions/status/local',
]);

function createCoreRpcSessionPolicy() {
  let activeSession = null;
  let latestSessionSelection = 0;
  const sessionSelectionRequests = new WeakMap();

  return {
    reset() {
      activeSession = null;
      latestSessionSelection += 1;
    },

    authorize(request) {
      const params = request.params ? { ...request.params } : undefined;
      if (SESSION_OVERRIDE_ENDPOINTS.has(request.endpoint)) {
        const authorizedRequest = { ...request, params };
        if (
          request.endpoint === 'sessions/status/local' ||
          request.endpoint === 'sessions/unlock/local'
        ) {
          latestSessionSelection += 1;
          sessionSelectionRequests.set(
            authorizedRequest,
            latestSessionSelection
          );
        }
        return authorizedRequest;
      }

      if (params) delete params.session;
      return {
        ...request,
        params: activeSession ? { ...params, session: activeSession } : params,
      };
    },

    observe(request, result) {
      const explicitSession = request.params?.session;
      if (
        request.endpoint === 'sessions/create/local' &&
        typeof result?.session === 'string'
      ) {
        activeSession = result.session;
      } else if (
        (request.endpoint === 'sessions/status/local' ||
          request.endpoint === 'sessions/unlock/local') &&
        explicitSession &&
        (sessionSelectionRequests.get(request) === undefined ||
          sessionSelectionRequests.get(request) === latestSessionSelection)
      ) {
        activeSession = explicitSession;
      } else if (
        request.endpoint === 'sessions/list/local' &&
        Array.isArray(result)
      ) {
        const sessions = result.filter(
          (session) => typeof session?.session === 'string'
        );
        if (!sessions.some((session) => session.session === activeSession)) {
          const latest = sessions.reduce(
            (current, session) =>
              !current || session.accessed > current.accessed ? session : current,
            null
          );
          activeSession = latest?.session || null;
        }
      } else if (
        request.endpoint === 'sessions/terminate/local' &&
        (!explicitSession || explicitSession === activeSession)
      ) {
        activeSession = null;
      }
    },
  };
}

module.exports = {
  createCoreRpcSessionPolicy,
};
