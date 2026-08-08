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
 * Best-effort path-based read used only against an already app-owned snapshot
 * whose parents the untrusted module author cannot replace. Mutable install
 * sources must be snapshotted first via copyModuleFiles.
 */
async function readRegularFileFromTrustedSnapshot(
  filePath,
  { root, label = filePath, maxBytes = DEFAULT_MAX_FILE_BYTES } = {}
) {
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

/**
 * Read a regular file under root without following leaf or intermediate
 * symlinks. Used to safely read source files during module installation.
 *
 * On platforms without descriptor-relative no-follow opens (notably Windows),
 * path-based reads of a mutable source remain TOCTOU-prone. Prefer
 * copyModuleFiles / installModuleDirectory, which first materialize an
 * immutable app-owned snapshot before reading. Direct callers must only use
 * this helper against already-trusted roots, or accept fd-relative platforms.
 */
async function readRegularFileNoFollow(
  filePath,
  {
    root,
    label = filePath,
    maxBytes = DEFAULT_MAX_FILE_BYTES,
    allowPathFallback = false,
  } = {}
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

  // Windows and other platforms without openat-style fd paths cannot bind
  // intermediate components to directory handles. Refuse path-based reads of
  // mutable sources unless the caller explicitly opts into the trusted-
  // snapshot fallback (used only after materializeAppOwnedSourceSnapshot).
  if (!allowPathFallback) {
    throw new Error(
      `${label} secure module file reads require descriptor-relative opens or an app-owned source snapshot`
    );
  }

  return readRegularFileFromTrustedSnapshot(resolvedFile, {
    root: resolvedRoot,
    label,
    maxBytes,
  });
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

function collectUniqueModuleFiles(files) {
  // Deduplicate declared paths so exclusive wx writes cannot race on duplicates.
  return [
    'nxs_package.json',
    ...new Set(
      files
        .map((file) => String(file))
        .filter(
          (file) => file !== 'nxs_package.json' && file !== 'repo_info.json'
        )
    ),
  ];
}

async function appendOptionalRepoInfo(uniqueFiles, sourceRoot) {
  const repoInfoPath = path.join(sourceRoot, 'repo_info.json');
  try {
    await fsp.lstat(repoInfoPath);
    if (!uniqueFiles.includes('repo_info.json')) {
      uniqueFiles.push('repo_info.json');
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  return uniqueFiles;
}

/**
 * One-pass materialization of declared module files into an app-owned directory.
 * Used on platforms without descriptor-relative opens so subsequent install
 * reads never touch the mutable user-controlled source tree again.
 */
async function materializeAppOwnedSourceSnapshot(
  files,
  source,
  snapshotRoot,
  { maxBytes = DEFAULT_MAX_FILE_BYTES } = {}
) {
  const sourceRoot = path.resolve(source);
  const snapRoot = path.resolve(snapshotRoot);
  await fsp.mkdir(snapRoot, { recursive: false });

  const uniqueFiles = await appendOptionalRepoInfo(
    collectUniqueModuleFiles(files),
    sourceRoot
  );

  for (const relativeFile of uniqueFiles) {
    if (
      !relativeFile ||
      relativeFile.includes('\0') ||
      path.isAbsolute(relativeFile)
    ) {
      throw new Error(`Invalid module file path: ${relativeFile}`);
    }

    const from = path.join(sourceRoot, relativeFile);
    const to = path.join(snapRoot, relativeFile);
    if (!isPathWithinDirectory(from, sourceRoot)) {
      throw new Error(`${relativeFile} escapes module root`);
    }
    if (!isPathWithinDirectory(to, snapRoot)) {
      throw new Error(`${relativeFile} escapes snapshot destination`);
    }

    await ensureDirExists(path.dirname(to));
    // Path-based snapshot of a mutable source is inherently racy on Windows;
    // after this one-time materialize, install only reads the app-owned tree.
    const content = await readRegularFileFromTrustedSnapshot(from, {
      root: sourceRoot,
      label: relativeFile,
      maxBytes,
    });
    await fsp.writeFile(to, content, { flag: 'wx' });
  }

  return snapRoot;
}

/**
 * Copy declared module files from source to dest without following symlinks.
 * Destination files are created exclusively (wx).
 *
 * On platforms without descriptor-relative no-follow traversal (Windows), the
 * mutable source is first copied into an app-owned snapshot under the
 * destination parent so intermediate junction swaps against the user tree
 * cannot redirect later install reads.
 */
async function copyModuleFiles(
  files,
  source,
  dest,
  {
    maxBytes = DEFAULT_MAX_FILE_BYTES,
    trustedSource = false,
    // Test/override hook: force the Windows-style app-owned source snapshot
    // path even when descriptor-relative opens are available.
    forceSourceSnapshot = false,
  } = {}
) {
  const destRoot = path.resolve(dest);

  // Windows / non-fd-relative platforms: freeze the untrusted source into an
  // immutable app-owned snapshot before any destination writes.
  if ((!supportsFdRelativeOpen() || forceSourceSnapshot) && !trustedSource) {
    const snapshotPath = path.join(
      path.dirname(destRoot),
      `.source-snapshot-${crypto.randomUUID()}`
    );
    try {
      await materializeAppOwnedSourceSnapshot(files, source, snapshotPath, {
        maxBytes,
      });
      return await copyModuleFiles(files, snapshotPath, destRoot, {
        maxBytes,
        trustedSource: true,
      });
    } finally {
      await fsp.rm(snapshotPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  const sourceRoot = path.resolve(source);

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
      // Trusted snapshots are app-owned; path fallback is only for that case
      // when fd-relative opens are unavailable.
      allowPathFallback: trustedSource,
    });
    await fsp.writeFile(to, content, { flag: 'wx' });
  };

  const uniqueFiles = await appendOptionalRepoInfo(
    collectUniqueModuleFiles(files),
    sourceRoot
  );

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
