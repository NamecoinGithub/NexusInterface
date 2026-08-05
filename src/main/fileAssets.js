import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Reader } from 'maxmind';

import { assertExternalUrl, assertSafeModuleName, assertString } from './ipc/contracts';
import { assetsDir } from './paths';
import { resolveModuleRoot } from './moduleFiles';

const locales = new Set([
  'en',
  'ar',
  'de',
  'es',
  'fi',
  'fr',
  'ja',
  'ko',
  'no',
  'nl',
  'pl',
  'pt',
  'ru',
  'sr',
  'zh-cn',
  'ro',
  'hu',
]);

let geoIpReaderPromise;

async function resolveModuleAsset(moduleName, relativePath) {
  const name = assertSafeModuleName(moduleName);
  const assetPath = assertString(relativePath, 'Module asset path', {
    min: 1,
    max: 1024,
  });
  const { root: moduleRoot } = await resolveModuleRoot(name);
  const resolvedPath = path.resolve(moduleRoot, assetPath);
  if (!resolvedPath.startsWith(`${moduleRoot}${path.sep}`)) {
    throw new Error('Module asset must be inside its installed module directory');
  }
  return resolvedPath;
}

export async function readModuleIcon(moduleName, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!['.svg', '.png'].includes(extension)) {
    throw new Error('Unsupported module icon type');
  }
  const iconPath = await resolveModuleAsset(moduleName, relativePath);
  const stat = await fs.stat(iconPath);
  if (!stat.isFile() || stat.size > 1024 * 1024) {
    throw new Error('Module icon is not a supported file');
  }
  if (extension === '.svg') return { type: 'svg', content: await fs.readFile(iconPath, 'utf8') };
  return { type: 'url', content: pathToFileURL(iconPath).toString() };
}

export async function fetchExternalIcon(url) {
  const validatedUrl = assertExternalUrl(url, 'External icon URL');
  const response = await axios.get(validatedUrl, {
    maxContentLength: 1024 * 1024,
    maxRedirects: 0,
    responseType: 'text',
    timeout: 10000,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return String(response.data);
}

export async function loadRecoveryWords() {
  const wordlistPath = path.join(assetsDir, 'misc', 'wordlist.txt');
  const contents = await fs.readFile(wordlistPath, 'utf8');
  return contents
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean);
}

async function getGeoIpReader() {
  if (!geoIpReaderPromise) {
    geoIpReaderPromise = fs
      .readFile(path.join(assetsDir, 'GeoLite2-City', 'GeoLite2-City.mmdb'))
      .then((buffer) => new Reader(buffer));
  }
  return geoIpReaderPromise;
}

export async function lookupGeoIp(addresses) {
  if (!Array.isArray(addresses) || addresses.length > 64) {
    throw new Error('Geo IP lookup requires at most 64 addresses');
  }

  const validAddresses = addresses.map((address) =>
    assertString(address, 'IP address', { min: 1, max: 64 })
  );
  const reader = await getGeoIpReader();
  return validAddresses.map((address) => {
    const record = reader.get(address);
    const location = record?.location;
    return location?.latitude !== undefined && location?.longitude !== undefined
      ? {
          address,
          latitude: location.latitude,
          longitude: location.longitude,
          timeZone: location.time_zone || '',
        }
      : null;
  });
}

export async function lookupPublicGeoIp() {
  const response = await fetch('http://ip-api.com/json/?fields=450');
  if (!response.ok) {
    throw new Error(`Public Geo IP lookup failed: ${response.status}`);
  }
  const result = await response.json();
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Public Geo IP response is invalid');
  }
  return {
    latitude,
    longitude,
    timeZone: typeof result.timezone === 'string' ? result.timezone : '',
  };
}

export function loadTranslationSync(locale) {
  const selectedLocale = assertString(locale, 'Locale', { min: 2, max: 8 });
  if (!locales.has(selectedLocale)) throw new Error('Unsupported locale');
  if (selectedLocale === 'en') return {};
  const csv = fsSync.readFileSync(
    path.join(assetsDir, 'translations', `${selectedLocale}.csv`),
    'utf8'
  );
  const records = parse(csv);
  return records.reduce((dictionary, [key, translation, context]) => {
    const contextKey = context || '';
    if (!dictionary[contextKey]) dictionary[contextKey] = {};
    dictionary[contextKey][key] = translation;
    return dictionary;
  }, {});
}

export async function loadTranslation(locale) {
  return loadTranslationSync(locale);
}
