'use strict';

const SESSION_OVERRIDE_ENDPOINTS = new Set([
  'sessions/terminate/local',
  'sessions/unlock/local',
  'sessions/status/local',
]);
const SESSION_SELECTION_ENDPOINTS = new Set([
  'sessions/create/local',
  'sessions/unlock/local',
  'sessions/status/local',
]);

function isSessionSelectionRequest(request) {
  return (
    SESSION_SELECTION_ENDPOINTS.has(request.endpoint) &&
    (request.endpoint !== 'sessions/status/local' ||
      typeof request.params?.session === 'string')
  );
}

function createCoreRpcSessionPolicy() {
  let activeSession = null;
  let latestSessionSelection = 0;
  let sessionRevision = 0;
  const sessionSelectionRequests = new WeakMap();
  const pendingSessionSelections = new Set();
  const sessionListRequests = new WeakMap();

  function settleSessionSelection(request) {
    pendingSessionSelections.delete(sessionSelectionRequests.get(request));
  }

  return {
    reset() {
      activeSession = null;
      latestSessionSelection += 1;
      sessionRevision += 1;
      pendingSessionSelections.clear();
    },

    authorize(request) {
      const params = request.params ? { ...request.params } : undefined;
      if (SESSION_OVERRIDE_ENDPOINTS.has(request.endpoint)) {
        const authorizedRequest = { ...request, params };
        if (isSessionSelectionRequest(authorizedRequest)) {
          latestSessionSelection += 1;
          sessionSelectionRequests.set(
            authorizedRequest,
            latestSessionSelection
          );
          pendingSessionSelections.clear();
          pendingSessionSelections.add(latestSessionSelection);
        }
        return authorizedRequest;
      }

      if (params) delete params.session;
      const authorizedRequest = {
        ...request,
        params: activeSession ? { ...params, session: activeSession } : params,
      };
      if (isSessionSelectionRequest(authorizedRequest)) {
        latestSessionSelection += 1;
        sessionSelectionRequests.set(authorizedRequest, latestSessionSelection);
        pendingSessionSelections.clear();
        pendingSessionSelections.add(latestSessionSelection);
      } else if (request.endpoint === 'sessions/list/local') {
        sessionListRequests.set(authorizedRequest, {
          latestSessionSelection,
          sessionRevision,
        });
      }
      return authorizedRequest;
    },

    observe(request, result) {
      const sessionSelection = sessionSelectionRequests.get(request);
      const sessionList = sessionListRequests.get(request);
      settleSessionSelection(request);
      if (
        sessionSelection !== undefined &&
        sessionSelection !== latestSessionSelection
      ) {
        return;
      }
      if (
        sessionList &&
        (pendingSessionSelections.size > 0 ||
          sessionList.latestSessionSelection !== latestSessionSelection ||
          sessionList.sessionRevision !== sessionRevision)
      ) {
        return;
      }
      const explicitSession = request.params?.session;
      if (
        request.endpoint === 'sessions/create/local' &&
        typeof result?.session === 'string'
      ) {
        activeSession = result.session;
        sessionRevision += 1;
      } else if (
        (request.endpoint === 'sessions/status/local' ||
          request.endpoint === 'sessions/unlock/local') &&
        explicitSession
      ) {
        activeSession = explicitSession;
        sessionRevision += 1;
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
        sessionRevision += 1;
      }
    },

    cancel(request) {
      settleSessionSelection(request);
    },
  };
}

module.exports = {
  createCoreRpcSessionPolicy,
};
