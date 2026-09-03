'use strict';

const path = require('path');

function splitCommandParts(command) {
  const parts = [];
  let current = '';
  let quote = null;
  let started = false;

  for (const char of String(command || '')) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        parts.push(current);
        current = '';
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }

  if (started) parts.push(current);
  return parts;
}

function normalizeProcessPath(value, platform = process.platform) {
  if (typeof value !== 'string') return '';
  let raw = value.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (!raw) return '';

  const pathApi = platform === 'win32' ? path.win32 : path;
  if (platform === 'win32') raw = raw.replace(/\//g, '\\');
  let normalized = pathApi.normalize(raw);
  const root = pathApi.parse(normalized).root;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function commandUsesDataDir(command, dataDir, platform = process.platform) {
  const normalizedDataDir = normalizeProcessPath(dataDir, platform);
  if (!command || !normalizedDataDir) return false;

  return splitCommandParts(command).some((part) => {
    const match = /^[-/]datadir=(.+)$/i.exec(part);
    return (
      !!match &&
      normalizeProcessPath(match[1], platform) === normalizedDataDir
    );
  });
}

module.exports = {
  commandUsesDataDir,
  normalizeProcessPath,
  splitCommandParts,
};
