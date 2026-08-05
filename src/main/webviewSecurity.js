import { app } from 'electron';
import { fileURLToPath } from 'url';

import { getDomain } from './fileServer';
import { getModulePreloadPath } from './paths';
import { resolveModuleRoot } from './moduleFiles';

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
      webPreferences.nodeIntegration = !!policy.development;
      webPreferences.contextIsolation = false;
      webPreferences.sandbox = false;
      webPreferences.enableRemoteModule = false;
      webPreferences.preload = getModulePreloadPath();
      webPreferences.webSecurity = true;
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
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, policy)) event.preventDefault();
  });
});
