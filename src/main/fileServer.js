/**
 * Express server serving static files for modules.
 * Only manifest-listed, path-normalized module files are reachable.
 */
import path, { normalize, sep } from 'path';
import express from 'express';
import log from 'electron-log';

import { modulesDir } from './paths';
import { assertRelativeModulePath, assertSafeModuleName } from './ipc/contracts';

const server = express();
let port = null;

/** @type {Map<string, Set<string>>} moduleName -> allowed relative file paths */
const allowedFilesByModule = new Map();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function normalizeRelativeFile(file) {
  let filePath = normalize(String(file)).replace(/\\/g, '/');
  while (filePath.startsWith('/')) filePath = filePath.slice(1);
  return assertRelativeModulePath(filePath);
}

function setSecurityHeaders(res) {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }
}

server.use('/modules/:moduleName', (req, res, next) => {
  setSecurityHeaders(res);

  let moduleName;
  try {
    moduleName = assertSafeModuleName(req.params.moduleName);
  } catch {
    return res.status(400).end('Invalid module');
  }

  const allow = allowedFilesByModule.get(moduleName);
  if (!allow || !allow.size) {
    return res.status(404).end('Module files not prepared');
  }

  let relative;
  try {
    const rawPath = decodeURIComponent(req.path || '');
    relative = normalizeRelativeFile(rawPath.replace(/^\/+/, ''));
  } catch {
    return res.status(400).end('Invalid path');
  }

  if (!allow.has(relative)) {
    return res.status(404).end('Not found');
  }

  const absolute = path.resolve(modulesDir, moduleName, relative);
  const moduleRoot = path.resolve(modulesDir, moduleName);
  if (
    absolute !== moduleRoot &&
    !absolute.startsWith(`${moduleRoot}${sep}`)
  ) {
    return res.status(400).end('Invalid path');
  }

  return res.sendFile(absolute, (error) => {
    if (error) {
      if (!res.headersSent) res.status(404).end('Not found');
    }
  });
});

const listener = server.listen(() => {
  port = listener.address().port;
  log.info(`File server listening on port ${port}!`);
});

export function getDomain() {
  return `http://localhost:${port}`;
}

/**
 * Authorize a module's static files for serving.
 * @param {string[]} files paths like `${moduleName}/${relativeFile}`
 */
export function serveModuleFiles(files) {
  /** @type {Map<string, Set<string>>} */
  const next = new Map();

  for (const file of files || []) {
    const normalized = normalize(String(file)).replace(/\\/g, '/');
    const parts = normalized.replace(/^\/+/, '').split('/');
    if (parts.length < 2) continue;
    const moduleName = assertSafeModuleName(parts[0]);
    const relative = normalizeRelativeFile(parts.slice(1).join('/'));
    if (!next.has(moduleName)) next.set(moduleName, new Set());
    next.get(moduleName).add(relative);
  }

  allowedFilesByModule.clear();
  for (const [moduleName, set] of next) {
    allowedFilesByModule.set(moduleName, set);
  }
}

export function getAllowedModuleFiles(moduleName) {
  const set = allowedFilesByModule.get(moduleName);
  return set ? [...set] : [];
}
