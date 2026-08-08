'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  STAGING_DIR_INFIX,
  copyModuleFiles,
  installModuleDirectory,
  readRegularFileNoFollow,
} = require('../../src/main/ipc/safeCopy');

const root = path.resolve(__dirname, '../..');
const read = (...segments) =>
  fs.readFileSync(path.join(root, ...segments), 'utf8');

async function makeTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeModuleTree(moduleRoot, files) {
  await fsp.mkdir(moduleRoot, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(moduleRoot, relativePath);
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, contents);
  }
}

test('module asset and entry resolvers reject symlinks and realpath escapes', () => {
  const fileAssets = read('src', 'main', 'fileAssets.js');
  const moduleFiles = read('src', 'main', 'moduleFiles.js');
  const fileServer = read('src', 'main', 'fileServer.js');
  const safeCopy = read('src', 'main', 'ipc', 'safeCopy.js');

  for (const [name, source] of [
    ['fileAssets.js', fileAssets],
    ['moduleFiles.js', moduleFiles],
    ['fileServer.js', fileServer],
    ['safeCopy.js', safeCopy],
  ]) {
    assert.match(source, /lstat/, `${name} must lstat before reading`);
    assert.match(
      source,
      /isSymbolicLink/,
      `${name} must reject symbolic links`
    );
    assert.match(source, /realpath/, `${name} must verify real paths`);
    assert.match(
      source,
      /realpath escapes module root|escapes module root/,
      `${name} must reject realpath escapes`
    );
  }

  assert.match(fileAssets, /assertRelativeModulePath/);
  assert.match(fileAssets, /readModuleIcon/);
  assert.match(fileAssets, /readRegularFileNoFollow/);
  assert.match(fileAssets, /data:image\/png;base64/);
  assert.match(moduleFiles, /resolveModuleFile/);
  assert.match(
    moduleFiles,
    /Module root must not be a symlink/,
    'installed module roots must reject directory symlinks'
  );
  assert.match(
    moduleFiles,
    /escapes modules directory/,
    'installed module roots must stay under modulesDir'
  );
  assert.match(safeCopy, /assertNoSymlinkComponents/);
  assert.match(safeCopy, /installModuleDirectory/);
});

test('safeCopy rejects leaf symlinks, intermediate directory symlinks, and escapes', async () => {
  const tempRoot = await makeTempDir('module-path-safety-');
  const moduleRoot = path.join(tempRoot, 'module');
  const outsideDir = path.join(tempRoot, 'outside');
  const destRoot = path.join(tempRoot, 'dest');

  try {
    await writeModuleTree(moduleRoot, {
      'nxs_package.json': '{"name":"demo"}',
      'assets/index.html': '<html>ok</html>',
      'assets/nested/file.txt': 'payload',
    });
    await fsp.mkdir(outsideDir, { recursive: true });
    await fsp.writeFile(path.join(outsideDir, 'secret.txt'), 'SECRET');

    const good = await readRegularFileNoFollow(
      path.join(moduleRoot, 'assets', 'index.html'),
      {
        root: moduleRoot,
        label: 'assets/index.html',
        allowPathFallback: true,
      }
    );
    assert.equal(String(good), '<html>ok</html>');

    // Root itself must be opened with O_NOFOLLOW: a symlink root is rejected.
    const symlinkRoot = path.join(tempRoot, 'symlink-root');
    await fsp.symlink(moduleRoot, symlinkRoot);
    await assert.rejects(
      () =>
        readRegularFileNoFollow(path.join(symlinkRoot, 'assets', 'index.html'), {
          root: symlinkRoot,
          label: 'assets/index.html',
          allowPathFallback: true,
        }),
      /symbolic link|module root/
    );

    await fsp.symlink(
      path.join(outsideDir, 'secret.txt'),
      path.join(moduleRoot, 'assets', 'leaf-link.txt')
    );
    await assert.rejects(
      () =>
        readRegularFileNoFollow(path.join(moduleRoot, 'assets', 'leaf-link.txt'), {
          root: moduleRoot,
          label: 'assets/leaf-link.txt',
          allowPathFallback: true,
        }),
      /symbolic link|regular non-symlink/
    );

    await fsp.rm(path.join(moduleRoot, 'assets', 'nested'), {
      recursive: true,
      force: true,
    });
    await fsp.symlink(outsideDir, path.join(moduleRoot, 'assets', 'nested'));
    await assert.rejects(
      () =>
        readRegularFileNoFollow(
          path.join(moduleRoot, 'assets', 'nested', 'secret.txt'),
          {
            root: moduleRoot,
            label: 'assets/nested/secret.txt',
            allowPathFallback: true,
          }
        ),
      /symbolic link|escapes module root/
    );

    await assert.rejects(
      () =>
        readRegularFileNoFollow(path.join(outsideDir, 'secret.txt'), {
          root: moduleRoot,
          label: 'outside',
          allowPathFallback: true,
        }),
      /escapes module root/
    );

    await assert.rejects(
      () =>
        readRegularFileNoFollow(path.join(moduleRoot, 'missing.txt'), {
          root: moduleRoot,
          label: 'missing.txt',
          allowPathFallback: true,
        }),
      /not found|ENOENT/
    );

    await writeModuleTree(moduleRoot, {
      'nxs_package.json': '{"name":"demo"}',
      'index.html': '<html>ok</html>',
      'data.bin': 'abc',
    });
    // Restore assets as a real directory for a successful copy.
    await fsp.rm(path.join(moduleRoot, 'assets'), { recursive: true, force: true });

    await copyModuleFiles(['index.html', 'data.bin'], moduleRoot, destRoot);
    assert.equal(
      await fsp.readFile(path.join(destRoot, 'index.html'), 'utf8'),
      '<html>ok</html>'
    );
    assert.equal(await fsp.readFile(path.join(destRoot, 'data.bin'), 'utf8'), 'abc');
    assert.equal(
      await fsp.readFile(path.join(destRoot, 'nxs_package.json'), 'utf8'),
      '{"name":"demo"}'
    );

    await fsp.rm(destRoot, { recursive: true, force: true });
    await fsp.symlink(outsideDir, path.join(moduleRoot, 'evil-dir'));
    await assert.rejects(
      () =>
        copyModuleFiles(
          ['index.html', path.join('evil-dir', 'secret.txt')],
          moduleRoot,
          destRoot
        ),
      /symbolic link|escapes module root/
    );
    // Non-atomic copyModuleFiles may create destination dirs before failing;
    // the outside secret must never be installed.
    if (fs.existsSync(destRoot)) {
      assert.equal(
        fs.existsSync(path.join(destRoot, 'evil-dir', 'secret.txt')),
        false
      );
      assert.doesNotMatch(
        await fsp
          .readFile(path.join(destRoot, 'index.html'), 'utf8')
          .catch(() => ''),
        /SECRET/
      );
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test('installModuleDirectory stages then renames a complete module tree', async () => {
  const tempRoot = await makeTempDir('module-install-atomic-');
  const sourceRoot = path.join(tempRoot, 'source');
  const modulesHome = path.join(tempRoot, 'modules');
  const destRoot = path.join(modulesHome, 'demo');

  try {
    await writeModuleTree(sourceRoot, {
      'nxs_package.json': '{"name":"demo","files":["index.html"]}',
      'index.html': '<html>installed</html>',
      'repo_info.json': '{"ok":true}',
    });
    await fsp.mkdir(modulesHome, { recursive: true });

    await installModuleDirectory(
      ['index.html'],
      sourceRoot,
      destRoot
    );

    assert.equal(
      await fsp.readFile(path.join(destRoot, 'index.html'), 'utf8'),
      '<html>installed</html>'
    );
    assert.equal(
      await fsp.readFile(path.join(destRoot, 'repo_info.json'), 'utf8'),
      '{"ok":true}'
    );

    const leftovers = (await fsp.readdir(modulesHome)).filter((name) =>
      name.includes(STAGING_DIR_INFIX)
    );
    assert.deepEqual(leftovers, []);

    // Failed copy must not leave the destination module directory behind.
    await fsp.rm(destRoot, { recursive: true, force: true });
    await fsp.symlink(path.join(tempRoot, 'missing-target'), path.join(sourceRoot, 'bad'));
    await assert.rejects(
      () => installModuleDirectory(['index.html', 'bad'], sourceRoot, destRoot),
      /symbolic link|regular non-symlink|not found/
    );
    assert.equal(fs.existsSync(destRoot), false);
    const failedLeftovers = (await fsp.readdir(modulesHome)).filter((name) =>
      name.includes(STAGING_DIR_INFIX)
    );
    assert.deepEqual(failedLeftovers, []);

    // verifyStaging runs before rename; rejection must leave no published module.
    await fsp.rm(path.join(sourceRoot, 'bad'), { force: true });
    await assert.rejects(
      () =>
        installModuleDirectory(['index.html'], sourceRoot, destRoot, {
          verifyStaging: async () => {
            throw new Error('staging validation failed');
          },
        }),
      /staging validation failed/
    );
    assert.equal(fs.existsSync(destRoot), false);
    const verifyLeftovers = (await fsp.readdir(modulesHome)).filter((name) =>
      name.includes(STAGING_DIR_INFIX)
    );
    assert.deepEqual(verifyLeftovers, []);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test('electron-updater uses patched builder-util-runtime', () => {
  const packageJson = JSON.parse(read('package.json'));
  // Keep an exact pin so CI fails closed on accidental ranges/downgrades.
  assert.equal(packageJson.dependencies['electron-updater'], '6.8.9');

  const lock = JSON.parse(read('package-lock.json'));
  const updaterEntry = lock.packages?.['node_modules/electron-updater'];
  assert.equal(updaterEntry?.version, '6.8.9');
  assert.equal(
    updaterEntry?.dependencies?.['builder-util-runtime'],
    '9.7.0'
  );
  assert.equal(
    lock.packages?.['node_modules/electron-updater/node_modules/builder-util-runtime'],
    undefined,
    'nested vulnerable builder-util-runtime must not be present'
  );
});

test('Electron fullscreen menu role uses the built-in lowercase name', () => {
  const appMenu = read('src', 'shared', 'lib', 'appMenu.ts');
  const mainJs = read('src', 'main', 'main.js');
  assert.match(appMenu, /role:\s*['"]togglefullscreen['"]/);
  assert.doesNotMatch(appMenu, /role:\s*['"]toggleFullScreen['"]/);
  assert.match(
    mainJs,
    /allowedMenuRoles[\s\S]*['"]togglefullscreen['"]/,
    'menu sanitizer must allow the lowercase Electron role'
  );
  assert.doesNotMatch(
    mainJs,
    /allowedMenuRoles[\s\S]*['"]toggleFullScreen['"]/,
    'menu sanitizer must not require the rejected camelCase role'
  );
});

test('copyModuleFiles deduplicates declared paths and copies sequentially', async () => {
  const tempRoot = await makeTempDir('module-copy-dedupe-');
  const moduleRoot = path.join(tempRoot, 'module');
  const destRoot = path.join(tempRoot, 'dest');
  const safeCopySource = read('src', 'main', 'ipc', 'safeCopy.js');

  assert.match(safeCopySource, /new Set\(/);
  assert.match(safeCopySource, /COPY_CONCURRENCY\s*=\s*1/);
  assert.match(safeCopySource, /directoryFdPath|\/proc\/self\/fd|\/dev\/fd/);
  assert.match(safeCopySource, /materializeAppOwnedSourceSnapshot/);
  assert.match(safeCopySource, /trustedSource/);
  assert.match(safeCopySource, /source-snapshot-/);

  try {
    await writeModuleTree(moduleRoot, {
      'nxs_package.json': '{"name":"demo"}',
      'index.html': '<html>ok</html>',
      'assets/a.txt': 'a',
    });

    await copyModuleFiles(
      ['index.html', 'index.html', 'assets/a.txt', 'assets/a.txt'],
      moduleRoot,
      destRoot
    );

    assert.equal(
      await fsp.readFile(path.join(destRoot, 'index.html'), 'utf8'),
      '<html>ok</html>'
    );
    assert.equal(
      await fsp.readFile(path.join(destRoot, 'assets', 'a.txt'), 'utf8'),
      'a'
    );

    // Exercise the Windows-style app-owned source snapshot install path.
    const snapshotDest = path.join(tempRoot, 'dest-snapshot');
    await copyModuleFiles(['index.html', 'assets/a.txt'], moduleRoot, snapshotDest, {
      forceSourceSnapshot: true,
    });
    assert.equal(
      await fsp.readFile(path.join(snapshotDest, 'index.html'), 'utf8'),
      '<html>ok</html>'
    );
    assert.equal(
      await fsp.readFile(path.join(snapshotDest, 'assets', 'a.txt'), 'utf8'),
      'a'
    );
    // Snapshot dirs must be cleaned up after copy.
    const leftovers = (await fsp.readdir(tempRoot)).filter((name) =>
      name.startsWith('.source-snapshot-')
    );
    assert.deepEqual(leftovers, []);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test('readRegularFileNoFollow fails closed without fd-relative or path fallback', async () => {
  const safeCopySource = read('src', 'main', 'ipc', 'safeCopy.js');
  assert.match(
    safeCopySource,
    /allowPathFallback/
  );
  assert.match(
    safeCopySource,
    /descriptor-relative opens or an app-owned source snapshot/
  );
});

test('Build Guide documents the package engines Node/npm floor', () => {
  const buildGuide = read('docs', 'Build_Guide.md');
  const packageJson = JSON.parse(read('package.json'));

  assert.match(buildGuide, /Node\.js \(min v22\.12\.0\)/);
  assert.match(buildGuide, /NPM \(min v10\.9\.0\)/);
  assert.equal(packageJson.engines.node, '>=22.12.0');
  assert.equal(packageJson.engines.npm, '>=10.9.0');
  assert.doesNotMatch(buildGuide, /min v16\.x/);
  assert.doesNotMatch(buildGuide, /min v8\.x/);
});
