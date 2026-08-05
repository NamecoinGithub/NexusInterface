import checkDiskSpace from 'check-disk-space';
import fs from 'fs';
import https from 'https';
import path from 'path';
import unzip from 'unzip-stream';

import {
  coreBinaryExists,
  isCoreRunning,
  killCoreProcess,
  startConfiguredCore,
} from './core';
import { callCoreRpc } from './coreRpc';
import { loadSettingsFromFile } from './settings';

const BOOTSTRAP_URL = 'https://bootstrap.nexus.io/tritium.zip';
const MIN_FREE_SPACE = 15 * 1000 * 1000 * 1000;
const MAX_ARCHIVE_SIZE = 50 * 1000 * 1000 * 1000;

let activeBootstrap;

function emitStatus(send, step, details) {
  send({ step, details });
}

async function moveFile(source, destination) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.promises.rename(source, destination);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await fs.promises.copyFile(source, destination);
    await fs.promises.unlink(source);
  }
}

async function moveDirectoryContents(source, destination) {
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  await fs.promises.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await moveDirectoryContents(sourcePath, destinationPath);
      await fs.promises.rm(sourcePath, { recursive: true, force: true });
    } else if (entry.isFile()) {
      await moveFile(sourcePath, destinationPath);
    }
  }
}

async function stopCore() {
  try {
    await callCoreRpc({ endpoint: 'system/stop' });
  } catch {
    // A disconnected Core cannot receive a graceful shutdown request.
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await isCoreRunning())) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (await isCoreRunning()) await killCoreProcess();
}

function downloadAndExtract(extractDir, onProgress) {
  return new Promise((resolve, reject) => {
    const request = https.get(BOOTSTRAP_URL, (response) => {
      if (
        !response.statusCode ||
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        response.resume();
        reject(new Error(`Bootstrap server returned ${response.statusCode}`));
        return;
      }
      const totalSize = Number(response.headers['content-length']);
      if (Number.isFinite(totalSize) && totalSize > MAX_ARCHIVE_SIZE) {
        response.destroy();
        reject(new Error('Bootstrap archive is too large'));
        return;
      }

      let downloaded = 0;
      const extractor = unzip.Extract({ path: extractDir });
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (downloaded > MAX_ARCHIVE_SIZE) {
          request.destroy(new Error('Bootstrap archive is too large'));
          return;
        }
        onProgress({ downloaded, totalSize: Number.isFinite(totalSize) ? totalSize : undefined });
      });
      response.once('error', reject);
      extractor.once('error', reject);
      extractor.once('close', () => resolve());
      response.pipe(extractor);
    });
    request.setTimeout(180000, () =>
      request.destroy(new Error('Bootstrap request timed out'))
    );
    request.once('error', reject);
    activeBootstrap.request = request;
  });
}

export function abortBootstrap() {
  if (activeBootstrap) {
    activeBootstrap.aborted = true;
    activeBootstrap.request?.destroy();
  }
}

export async function startBootstrap(sendStatus) {
  if (activeBootstrap) throw new Error('Bootstrap is already running');
  const settings = loadSettingsFromFile();
  if (settings.manualDaemon) {
    throw new Error('Bootstrap is unavailable for a manually configured Core');
  }
  const extractDir = path.join(settings.coreDataDir, 'recent');
  activeBootstrap = { aborted: false, request: undefined };

  let shouldRestartCore = false;
  try {
    await fs.promises.mkdir(settings.coreDataDir, { recursive: true });
    const diskSpace = await checkDiskSpace(settings.coreDataDir);
    if (diskSpace.free < MIN_FREE_SPACE) {
      throw new Error('At least 15GB of free space is required for bootstrap');
    }

    emitStatus(sendStatus, 'preparing');
    await fs.promises.rm(extractDir, { recursive: true, force: true });
    emitStatus(sendStatus, 'stopping_core');
    await stopCore();
    shouldRestartCore = true;
    if (activeBootstrap.aborted) return { aborted: true };

    emitStatus(sendStatus, 'downloading', { downloaded: 0 });
    await downloadAndExtract(extractDir, (details) =>
      emitStatus(sendStatus, 'downloading', details)
    );
    if (activeBootstrap.aborted) return { aborted: true };

    emitStatus(sendStatus, 'moving_db');
    await moveDirectoryContents(extractDir, settings.coreDataDir);
    if (activeBootstrap.aborted) return { aborted: true };

    emitStatus(sendStatus, 'restarting_core');
    if (coreBinaryExists()) {
      await startConfiguredCore();
      shouldRestartCore = false;
    }
    emitStatus(sendStatus, 'cleaning_up');
    await fs.promises.rm(extractDir, { recursive: true, force: true });
    return { aborted: false };
  } catch (error) {
    if (activeBootstrap?.aborted) return { aborted: true };
    throw error;
  } finally {
    if (shouldRestartCore && coreBinaryExists()) {
      try {
        await startConfiguredCore();
      } catch {
        // Preserve the bootstrap error; the renderer will surface it.
      }
    }
    activeBootstrap = undefined;
    emitStatus(sendStatus, 'idle');
  }
}

export const bootstrapConstants = Object.freeze({
  BOOTSTRAP_URL,
  MIN_FREE_SPACE,
  MAX_ARCHIVE_SIZE,
});
