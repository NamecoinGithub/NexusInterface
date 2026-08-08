'use strict';

/**
 * Safe module-file copy helpers.
 *
 * Directory installs can race between path inspection and open. O_NOFOLLOW only
 * protects the final path component, so intermediate directory symlinks must be
 * rejected as well. After open we re-check confinement using the opened fd
 * (Linux /proc/self/fd) or realpath, and only then return file bytes.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const STAGING_DIR_INFIX = '.installing-';

function isPathWithinDirectory(candidatePath, directoryPath) {
  const relativePath = path.relative(
    path.resolve(directoryPath),
    path.resolve(candidatePath)
  );
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function assertPathInsideRoot(candidatePath, rootPath, label) {
  if (!isPathWithinDirectory(candidatePath, rootPath)) {
    throw new Error(`${label} realpath escapes module root`);
  }
}

/**
 * Reject symlink path components from root through the leaf. O_NOFOLLOW alone
 * does not cover intermediate directories.
 */
async function assertNoSymlinkComponents(rootPath, targetPath, label) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  assertPathInsideRoot(resolvedTarget, resolvedRoot, label);

  const rootStat = await fsp.lstat(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`${label} module root must not be a symbolic link`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`${label} module root must be a directory`);
  }

  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  if (!relativePath) return;

  let current = resolvedRoot;
  for (const segment of relativePath.split(path.sep)) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`${label} contains an unsafe path segment`);
    }
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        throw new Error(`${label} not found`);
      }
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} path contains a symbolic link`);
    }
  }
}

async function resolveOpenedPath(handle, openPath) {
  if (process.platform === 'linux' && typeof handle.fd === 'number') {
    try {
      const fdPath = await fsp.readlink(`/proc/self/fd/${handle.fd}`);
      try {
        return await fsp.realpath(fdPath);
      } catch {
        return path.resolve(fdPath);
      }
    } catch {
      // Fall through to path-based realpath on exotic /proc setups.
    }
  }
  return fsp.realpath(openPath);
}

async function assertOpenedFileInsideRoot(handle, openPath, rootPath, label) {
  const realRoot = await fsp.realpath(rootPath);
  const openedPath = await resolveOpenedPath(handle, openPath);
  assertPathInsideRoot(openedPath, realRoot, label);

  const stat = await handle.stat();
  if (!stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return stat;
}

/**
 * Read a regular file under root without following leaf or intermediate
 * symlinks. Used to safely read source files during module installation.
 */
async function readRegularFileNoFollow(
  filePath,
  { root, label = filePath, maxBytes = DEFAULT_MAX_FILE_BYTES } = {}
) {
  if (!root) {
    throw new TypeError('readRegularFileNoFollow requires a root directory');
  }

  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  assertPathInsideRoot(resolvedFile, resolvedRoot, label);
  await assertNoSymlinkComponents(resolvedRoot, resolvedFile, label);

  const before = await fsp.lstat(resolvedFile);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (before.size > maxBytes) {
    throw new Error(`${label} exceeds the size limit`);
  }

  if (typeof fs.constants.O_NOFOLLOW === 'number') {
    const handle = await fsp.open(
      resolvedFile,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    try {
      const stat = await assertOpenedFileInsideRoot(
        handle,
        resolvedFile,
        resolvedRoot,
        label
      );
      if (stat.size > maxBytes) {
        throw new Error(`${label} exceeds the size limit`);
      }
      // Re-check components after open to shrink replacement races on
      // platforms without reliable fd path introspection.
      await assertNoSymlinkComponents(resolvedRoot, resolvedFile, label);
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  const content = await fsp.readFile(resolvedFile);
  const after = await fsp.lstat(resolvedFile);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ino !== before.ino ||
    after.dev !== before.dev
  ) {
    throw new Error(`${label} changed during install`);
  }
  await assertNoSymlinkComponents(resolvedRoot, resolvedFile, label);
  const realFile = await fsp.realpath(resolvedFile);
  const realRoot = await fsp.realpath(resolvedRoot);
  assertPathInsideRoot(realFile, realRoot, label);
  if (content.length > maxBytes) {
    throw new Error(`${label} exceeds the size limit`);
  }
  return content;
}

async function ensureDirExists(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

/**
 * Copy declared module files from source to dest without following symlinks.
 * Destination files are created exclusively (wx).
 */
async function copyModuleFiles(
  files,
  source,
  dest,
  { maxBytes = DEFAULT_MAX_FILE_BYTES } = {}
) {
  const sourceRoot = path.resolve(source);
  const destRoot = path.resolve(dest);

  const copyOne = async (file) => {
    const relativeFile = String(file);
    if (
      !relativeFile ||
      relativeFile.includes('\0') ||
      path.isAbsolute(relativeFile)
    ) {
      throw new Error(`Invalid module file path: ${relativeFile}`);
    }

    const from = path.join(sourceRoot, relativeFile);
    const to = path.join(destRoot, relativeFile);
    if (!isPathWithinDirectory(from, sourceRoot)) {
      throw new Error(`${relativeFile} escapes module root`);
    }
    if (!isPathWithinDirectory(to, destRoot)) {
      throw new Error(`${relativeFile} escapes install destination`);
    }

    await ensureDirExists(path.dirname(to));
    const content = await readRegularFileNoFollow(from, {
      root: sourceRoot,
      label: relativeFile,
      maxBytes,
    });
    await fsp.writeFile(to, content, { flag: 'wx' });
  };

  const uniqueFiles = [
    'nxs_package.json',
    ...files.filter(
      (file) => file !== 'nxs_package.json' && file !== 'repo_info.json'
    ),
  ];
  const promises = uniqueFiles.map(copyOne);

  // Optional companion metadata; readRegularFileNoFollow enforces non-symlink.
  const repoInfoPath = path.join(sourceRoot, 'repo_info.json');
  try {
    await fsp.lstat(repoInfoPath);
    promises.push(copyOne('repo_info.json'));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  return Promise.all(promises);
}

/**
 * Copy into an application-owned staging directory, then rename into place.
 * Avoids leaving a half-written destination module directory on failure.
 */
async function installModuleDirectory(
  files,
  source,
  dest,
  { maxBytes = DEFAULT_MAX_FILE_BYTES } = {}
) {
  const destPath = path.resolve(dest);
  const destParent = path.dirname(destPath);
  const destName = path.basename(destPath);
  const stagingPath = path.join(
    destParent,
    `.${destName}${STAGING_DIR_INFIX}${crypto.randomUUID()}`
  );

  await ensureDirExists(destParent);
  await fsp.mkdir(stagingPath, { recursive: false });
  try {
    await copyModuleFiles(files, source, stagingPath, { maxBytes });
    await fsp.rename(stagingPath, destPath);
  } catch (err) {
    await fsp.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  STAGING_DIR_INFIX,
  assertNoSymlinkComponents,
  copyModuleFiles,
  installModuleDirectory,
  isPathWithinDirectory,
  readRegularFileNoFollow,
};
