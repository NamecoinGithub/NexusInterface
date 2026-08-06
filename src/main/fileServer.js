/**
 * Express server serving static files for modules.
 * Only manifest-listed, path-normalized module files are reachable.
 */
import path, { normalize, sep } from 'path';
import fs from 'fs';
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

// Simple per-IP token bucket for local module asset reads.
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 120;
/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

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

function allowRequest(req) {
  const key = String(req.ip || req.socket?.remoteAddress || 'local');
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

/**
 * Resolve a module file only if it is on the allowlist and stays under the
 * module root after realpath normalization (rejects symlink escapes).
 */
function resolveAuthorizedModuleFile(moduleName, relativeFile) {
  const allow = allowedFilesByModule.get(moduleName);
  if (!allow || !allow.has(relativeFile)) {
    return null;
  }

  const moduleRoot = path.resolve(modulesDir, moduleName);
  const candidate = path.resolve(moduleRoot, relativeFile);
  if (candidate !== moduleRoot && !candidate.startsWith(`${moduleRoot}${sep}`)) {
    return null;
  }

  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(moduleRoot);
    // lstat first: reject symlinks at the leaf before following them.
    const leafStat = fs.lstatSync(candidate);
    if (leafStat.isSymbolicLink()) {
      return null;
    }
    if (!leafStat.isFile()) {
      return null;
    }
    realFile = fs.realpathSync(candidate);
  } catch {
    return null;
  }

  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) {
    return null;
  }
  return realFile;
}

server.use('/modules/:moduleName', (req, res) => {
  setSecurityHeaders(res);

  if (!allowRequest(req)) {
    return res.status(429).end('Too many requests');
  }

  let moduleName;
  try {
    moduleName = assertSafeModuleName(req.params.moduleName);
  } catch {
    return res.status(400).end('Invalid module');
  }

  let relative;
  try {
    const rawPath = decodeURIComponent(req.path || '');
    relative = normalizeRelativeFile(rawPath.replace(/^\/+/, ''));
  } catch {
    return res.status(400).end('Invalid path');
  }

  const absolute = resolveAuthorizedModuleFile(moduleName, relative);
  if (!absolute) {
    return res.status(404).end('Not found');
  }

  // absolute is produced only from validated module root + allowlisted relative
  // path after realpath checks; never from raw user path segments alone.
  return res.sendFile(absolute, (error) => {
    if (error && !res.headersSent) res.status(404).end('Not found');
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
