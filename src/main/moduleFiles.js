import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

import { assertRelativeModulePath, assertSafeModuleName } from './ipc/contracts';
import { modulesDir } from './paths';
import { loadSettingsFromFile } from './settings';

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function findDevelopmentModule(name) {
  for (const candidate of loadSettingsFromFile().devModulePaths || []) {
    try {
      const info = await readJson(path.join(candidate, 'nxs_package.dev.json'));
      if (info?.name === name) return path.resolve(candidate);
    } catch {
      // Invalid development module paths are reported by the module inventory.
    }
  }
  return undefined;
}

export async function resolveModuleRoot(name) {
  const moduleName = assertSafeModuleName(name);
  const installedRoot = path.resolve(modulesDir, moduleName);
  try {
    const leafStat = await fs.lstat(installedRoot);
    if (leafStat.isSymbolicLink()) {
      throw new Error(`Module root must not be a symlink: ${moduleName}`);
    }
    if (leafStat.isDirectory()) {
      const realModulesDir = await fs.realpath(modulesDir);
      const realRoot = await fs.realpath(installedRoot);
      if (
        realRoot !== realModulesDir &&
        !realRoot.startsWith(`${realModulesDir}${path.sep}`)
      ) {
        throw new Error('Module root realpath escapes modules directory');
      }
      return { root: realRoot, development: false };
    }
  } catch (error) {
    // Only fall through for missing/invalid installed roots. Symlink and
    // escape rejections must remain hard failures.
    if (
      error &&
      typeof error.message === 'string' &&
      (error.message.includes('must not be a symlink') ||
        error.message.includes('escapes modules directory'))
    ) {
      throw error;
    }
    // Check validated development module roots below.
  }
  const developmentRoot = await findDevelopmentModule(moduleName);
  if (developmentRoot) return { root: developmentRoot, development: true };
  throw new Error(`Module is not installed: ${moduleName}`);
}

/**
 * Resolve a module-relative file to a real, non-symlink path under root.
 * Rejects leaf symlinks and realpath escapes (same policy as fileServer.js).
 */
async function resolveModuleFile(root, relativePath) {
  const file = assertRelativeModulePath(relativePath);
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Module file must be inside the module directory');
  }

  const leafStat = await fs.lstat(resolved);
  if (leafStat.isSymbolicLink() || !leafStat.isFile()) {
    throw new Error(`Module file must be a regular non-symlink file: ${file}`);
  }

  const realRoot = await fs.realpath(root);
  const realFile = await fs.realpath(resolved);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('Module file realpath escapes module root');
  }

  return realFile;
}

export async function getModuleEntry(name, fileServerDomain) {
  const { root, development } = await resolveModuleRoot(name);
  const packageFile = path.join(
    root,
    development ? 'nxs_package.dev.json' : 'nxs_package.json'
  );
  const info = await readJson(packageFile);
  const entry = info?.entry || 'index.html';
  const entryPath = await resolveModuleFile(root, entry);

  if (development) return pathToFileURL(entryPath).toString();
  const encodedEntry = entry
    .split(/[\\/]/)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${fileServerDomain}/modules/${encodeURIComponent(name)}/${encodedEntry}`;
}

export async function validateModuleFiles(name, files) {
  const { root } = await resolveModuleRoot(name);
  return Promise.all(
    files.map(async (file) => {
      await resolveModuleFile(root, file);
      return file;
    })
  );
}
