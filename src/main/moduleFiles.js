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
    const stat = await fs.stat(installedRoot);
    if (stat.isDirectory()) return { root: installedRoot, development: false };
  } catch {
    // Check validated development module roots below.
  }
  const developmentRoot = await findDevelopmentModule(moduleName);
  if (developmentRoot) return { root: developmentRoot, development: true };
  throw new Error(`Module is not installed: ${moduleName}`);
}

function resolveModuleFile(root, relativePath) {
  const file = assertRelativeModulePath(relativePath);
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Module file must be inside the module directory');
  }
  return resolved;
}

export async function getModuleEntry(name, fileServerDomain) {
  const { root, development } = await resolveModuleRoot(name);
  const packageFile = path.join(
    root,
    development ? 'nxs_package.dev.json' : 'nxs_package.json'
  );
  const info = await readJson(packageFile);
  const entry = info?.entry || 'index.html';
  const entryPath = resolveModuleFile(root, entry);
  const stat = await fs.stat(entryPath);
  if (!stat.isFile()) throw new Error('Module entry file does not exist');

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
      const absoluteFile = resolveModuleFile(root, file);
      const stat = await fs.stat(absoluteFile);
      if (!stat.isFile()) throw new Error(`Module file is not a regular file: ${file}`);
      return file;
    })
  );
}
