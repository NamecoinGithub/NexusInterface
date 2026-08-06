'use strict';

function trimConfValue(value) {
  return typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : value;
}

function fromKeyValues(contents) {
  if (!contents) return {};
  // Strip a leading UTF-8 BOM from the file contents so the first key is not
  // poisoned (e.g. "\uFEFFapiuser"). Value-level trim still removes embedded BOM.
  const normalized = String(contents).replace(/^\uFEFF/, '');
  return normalized.split(/\r?\n/).reduce((config, line) => {
    const trimmedLine = line.trim();
    if (
      !trimmedLine ||
      trimmedLine.startsWith('#') ||
      trimmedLine.startsWith(';')
    ) {
      return config;
    }
    const separator = trimmedLine.indexOf('=');
    if (separator > 0) {
      const key = trimmedLine.slice(0, separator).trim();
      const value = trimConfValue(trimmedLine.slice(separator + 1));
      if (key) {
        config[key] = value;
      }
    }
    return config;
  }, {});
}

function toKeyValues(config) {
  return Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseBooleanFlag(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return fallback;
}

function confBooleanString(value) {
  return value ? '1' : '0';
}

function resolveApiPortSSL(config, fallback) {
  return (
    trimConfValue(config?.apiportssl) ||
    trimConfValue(config?.apisslport) ||
    fallback
  );
}

/**
 * Resolve the embedded-Core connection settings the wallet should use and the
 * nexus.conf mutations required so Core's next start matches.
 *
 * Historical behavior (pre-isolation loadNexusConf): credentials come from
 * conf; SSL/port preferences from wallet settings overlay conf values.
 */
function resolveEmbeddedCoreConnection(configInput, settings = {}) {
  const config = { ...(configInput || {}) };

  if (
    (config.apiportssl === undefined || config.apiportssl === '') &&
    config.apisslport
  ) {
    config.apiportssl = trimConfValue(config.apisslport);
  }

  const useSSL = settings.embeddedCoreUseNonSSL ? false : true;
  const desiredPort = String(
    settings.embeddedCoreApiPort || config.apiport || '8080'
  );
  const desiredPortSSL = String(
    settings.embeddedCoreApiPortSSL || resolveApiPortSSL(config, '7080')
  );

  const defaults = {
    apiuser: 'apiserver',
    // Caller supplies a generated password when missing.
    apipassword: settings.generatedApiPassword,
    apissl: confBooleanString(useSSL),
    apiport: desiredPort,
    apiportssl: desiredPortSSL,
  };

  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (value === undefined) continue;
    if (config[key] === undefined || config[key] === '') {
      config[key] = value;
      changed = true;
    }
  }

  const desiredConf = {
    apissl: confBooleanString(useSSL),
    apiport: desiredPort,
    apiportssl: desiredPortSSL,
  };
  for (const [key, value] of Object.entries(desiredConf)) {
    if (String(config[key]) !== String(value)) {
      config[key] = value;
      changed = true;
    }
  }

  if (config.apisslport !== undefined) {
    delete config.apisslport;
    changed = true;
  }

  return {
    changed,
    conf: config,
    connection: {
      ip: '127.0.0.1',
      apiSSL: useSSL,
      apiPort: desiredPort,
      apiPortSSL: desiredPortSSL,
      apiUser: trimConfValue(config.apiuser) || 'apiserver',
      apiPassword: trimConfValue(config.apipassword),
      txExpiry: Number.parseInt(config.txexpiry, 10) || undefined,
    },
  };
}

module.exports = {
  confBooleanString,
  fromKeyValues,
  parseBooleanFlag,
  resolveApiPortSSL,
  resolveEmbeddedCoreConnection,
  toKeyValues,
  trimConfValue,
};
