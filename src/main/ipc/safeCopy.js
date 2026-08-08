'use strict';

/**
 * Safe module-file copy helpers.
 *
 * Directory installs can race between path inspection and open. O_NOFOLLOW only
 * protects the final path component, so intermediate directory symlinks must be
 * rejected as well. Files are opened via descriptor-relative no-follow traversal
 * wherever the platform supports it, then re-checked for confinement using the
 * opened fd before bytes are returned.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const STAGING_DIR_INFIX = '.installing-';
const COPY_CONCURRENCY = 1;

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

function hasNoFollowOpen() {
  return typeof fs.constants.O_NOFOLLOW === 'number';
}

function hasDirectoryOpen() {
  return typeof fs.constants.O_DIRECTORY === 'number';
}

/**
 * Path that refers to an open directory fd so child opens are descriptor-
 * relative (openat-style) rather than re-walking a mutable path string.
 */
function directoryFdPath(fd) {
  if (typeof fd !== 'number' || fd < 0) {
    throw new Error('Invalid directory file descriptor');
  }
  if (process.platform === 'linux') {
    return `/proc/self/fd/${fd}`;
  }
  // macOS / BSD
  return `/dev/fd/${fd}`;
}

function supportsFdRelativeOpen() {
  return (
    hasNoFollowOpen() &&
    hasDirectoryOpen() &&
    (process.platform === 'linux' ||
      process.platform === 'darwin' ||
      process.platform === 'freebsd' ||
      process.platform === 'openbsd')
  );
}

/**
 * Reject symlink path components from root through the leaf. Used as a fast
 * pre-check and as a fallback on platforms without fd-relative open.
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
  if (typeof handle.fd === 'number') {
    if (process.platform === 'linux') {
      try {
        const fdPath = await fsp.readlink(`/proc/self/fd/${handle.fd}`);
        try {
          return await fsp.realpath(fdPath);
        } catch {
          return path.resolve(fdPath);
        }
      } catch {
        // Fall through.
      }
    } else if (
      process.platform === 'darwin' ||
      process.platform === 'freebsd' ||
      process.platform === 'openbsd'
    ) {
      // Prefer handle identity via /dev/fd rather than the mutable open path.
      try {
        return await fsp.realpath(`/dev/fd/${handle.fd}`);
      } catch {
        try {
          const fdPath = await fsp.readlink(`/dev/fd/${handle.fd}`);
          return path.resolve(fdPath);
        } catch {
          // Fall through.
        }
      }
    }
  }
  // Last resort: never treat this as a strong binding on its own.
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
  return { stat, openedPath, realRoot };
}

function splitRelativeSegments(rootPath, targetPath, label) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  assertPathInsideRoot(resolvedTarget, resolvedRoot, label);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a file inside the module root`);
  }
  const segments = relativePath.split(path.sep).filter(Boolean);
  if (
    !segments.length ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  return { resolvedRoot, resolvedTarget, segments };
}

/**
 * Open a file under root using descriptor-relative O_NOFOLLOW opens for every
 * path component so intermediate directory swaps cannot redirect the walk.
 */
async function openRegularFileNoFollowFdRelative(
  filePath,
  rootPath,
  label,
  maxBytes
) {
  const { resolvedRoot, segments } = splitRelativeSegments(
    rootPath,
    filePath,
    label
  );

  const rootStat = await fsp.lstat(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`${label} module root must not be a symbolic link`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`${label} module root must be a directory`);
  }

  // O_NOFOLLOW on the root open closes the lstat→open TOCTOU where the root
  // itself is replaced with a symlink and the walk would otherwise anchor
  // outside the intended module tree.
  let dirHandle;
  try {
    dirHandle = await fsp.open(
      resolvedRoot,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW
    );
  } catch (err) {
    if (
      err?.code === 'ELOOP' ||
      err?.code === 'EMLINK' ||
      err?.code === 'EINVAL'
    ) {
      throw new Error(`${label} module root must not be a symbolic link`);
    }
    throw err;
  }
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLast = index === segments.length - 1;
      const flags =
        fs.constants.O_RDONLY |
        fs.constants.O_NOFOLLOW |
        (isLast ? 0 : fs.constants.O_DIRECTORY);
      const childPath = path.join(directoryFdPath(dirHandle.fd), segment);
      let nextHandle;
      try {
        nextHandle = await fsp.open(childPath, flags);
      } catch (err) {
        if (
          err?.code === 'ELOOP' ||
          err?.code === 'EMLINK' ||
          err?.code === 'EINVAL'
        ) {
          throw new Error(`${label} path contains a symbolic link`);
        }
        if (err?.code === 'ENOENT') {
          throw new Error(`${label} not found`);
        }
        if (err?.code === 'ENOTDIR') {
          throw new Error(
            isLast
              ? `${label} must be a regular non-symlink file`
              : `${label} path contains a symbolic link`
          );
        }
        throw err;
      }
      const previousHandle = dirHandle;
      dirHandle = nextHandle;
      await previousHandle.close().catch(() => {});

      if (isLast) {
        const { stat } = await assertOpenedFileInsideRoot(
          dirHandle,
          childPath,
          resolvedRoot,
          label
        );
        if (stat.size > maxBytes) {
          throw new Error(`${label} exceeds the size limit`);
        }
        const content = await dirHandle.readFile();
        if (content.length > maxBytes) {
          throw new Error(`${label} exceeds the size limit`);
        }
        const handle = dirHandle;
        dirHandle = null;
        try {
          return content;
        } finally {
          await handle.close();
        }
      }
    }
    throw new Error(`${label} not found`);
  } finally {
    if (dirHandle) {
      await dirHandle.close().catch(() => {});
    }
  }
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

  if (supportsFdRelativeOpen()) {
    return openRegularFileNoFollowFdRelative(
      resolvedFile,
      resolvedRoot,
      label,
      maxBytes
    );
  }

  // Platforms without openat-style fd paths: best-effort component checks and
  // leaf O_NOFOLLOW when available. Parents may still race; callers that need
  // stronger guarantees should stage from a trusted snapshot first.
  await assertNoSymlinkComponents(resolvedRoot, resolvedFile, label);

  const before = await fsp.lstat(resolvedFile);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (before.size > maxBytes) {
    throw new Error(`${label} exceeds the size limit`);
  }

  if (hasNoFollowOpen()) {
    const handle = await fsp.open(
      resolvedFile,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    try {
      const { stat } = await assertOpenedFileInsideRoot(
        handle,
        resolvedFile,
        resolvedRoot,
        label
      );
      if (stat.size > maxBytes) {
        throw new Error(`${label} exceeds the size limit`);
      }
      await assertNoSymlinkComponents(resolvedRoot, resolvedFile, label);
      const content = await handle.readFile();
      if (content.length > maxBytes) {
        throw new Error(`${label} exceeds the size limit`);
      }
      return content;
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

async function mapPool(items, concurrency, worker) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
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

  // Deduplicate declared paths so exclusive wx writes cannot race on duplicates.
  const uniqueFiles = [
    'nxs_package.json',
    ...new Set(
      files
        .map((file) => String(file))
        .filter(
          (file) => file !== 'nxs_package.json' && file !== 'repo_info.json'
        )
    ),
  ];

  // Optional companion metadata; readRegularFileNoFollow enforces non-symlink.
  const repoInfoPath = path.join(sourceRoot, 'repo_info.json');
  try {
    await fsp.lstat(repoInfoPath);
    uniqueFiles.push('repo_info.json');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  // Sequential by default to bound peak memory and open file descriptors.
  await mapPool(uniqueFiles, COPY_CONCURRENCY, copyOne);
}

/**
 * Copy into an application-owned staging directory, then rename into place.
 * Avoids leaving a half-written destination module directory on failure.
 */
async function installModuleDirectory(
  files,
  source,
  dest,
  { maxBytes = DEFAULT_MAX_FILE_BYTES, verifyStaging } = {}
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
    // Validate the app-owned staging tree before publishing so a source that
    // mutates after the copy plan was captured cannot land a mismatched
    // descriptor/file set at the final install path.
    if (typeof verifyStaging === 'function') {
      await verifyStaging(stagingPath);
    }
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
