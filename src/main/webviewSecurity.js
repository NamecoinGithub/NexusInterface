import { app } from 'electron';
import { fileURLToPath } from 'url';

import { getDomain } from './fileServer';
import { getModulePreloadPath } from './paths';
import { resolveModuleRoot } from './moduleFiles';
import {
  registerModuleGuest,
  unregisterModuleGuest,
} from './moduleBroker';

const authorizedEntries = new Map();
const pendingPolicies = [];

function moduleUrlPrefix(moduleName) {
  return `${getDomain()}/modules/${encodeURIComponent(moduleName)}/`;
}

function isAllowedNavigation(url, policy) {
  try {
    const target = new URL(url);
    if (policy.development) {
      if (target.protocol !== 'file:') return false;
      const targetPath = fileURLToPath(target);
      return (
        targetPath === policy.root ||
        targetPath.startsWith(`${policy.root}${policy.separator}`)
      );
    }
    return target.toString().startsWith(moduleUrlPrefix(policy.moduleName));
  } catch {
    return false;
  }
}

export async function authorizeModuleEntry(moduleName, entryUrl) {
  const { root, development } = await resolveModuleRoot(moduleName);
  authorizedEntries.set(entryUrl, {
    moduleName,
    root,
    development,
    separator: process.platform === 'win32' ? '\\' : '/',
  });
}

/**
 * Force secure WebView preferences regardless of renderer-supplied attributes.
 * Production modules always run with contextIsolation + no nodeIntegration.
 * Sandbox is enabled by default; NEXUS_DISABLE_MODULE_SANDBOX=1 is diagnostics-only.
 */
export function hardenModuleWebviews(mainWindow) {
  mainWindow.webContents.on(
    'will-attach-webview',
    (event, webPreferences, params) => {
      const policy = authorizedEntries.get(params.src);
      if (!policy) {
        event.preventDefault();
        return;
      }
      authorizedEntries.delete(params.src);

      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox =
        process.env.NEXUS_DISABLE_MODULE_SANDBOX === '1' ? false : true;
      webPreferences.enableRemoteModule = false;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      webPreferences.preload = getModulePreloadPath();
      delete webPreferences.preloadURL;

      pendingPolicies.push(policy);
    }
  );
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  const policy = pendingPolicies.shift();
  if (!policy) {
    contents.close();
    return;
  }

  void registerModuleGuest({
    webContentsId: contents.id,
    moduleName: policy.moduleName,
    development: policy.development,
    enabled: true,
  }).catch((error) => {
    console.error('Failed to register module guest', error);
    try {
      contents.close();
    } catch {
      // ignore
    }
  });

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, policy)) event.preventDefault();
  });

  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, policy)) event.preventDefault();
  });

  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  contents.on('destroyed', () => {
    unregisterModuleGuest(contents.id);
  });
});
