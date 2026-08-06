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
    .filter(([, value]) => value !== undefined && value !== null)
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
  // Nexus Core only honors `apisslport` in nexus.conf / CLI. Older wallet builds
  // wrote the non-functional alias `apiportssl`, which Core silently ignores and
  // then binds the SSL API on its default port 8443.
  return (
    trimConfValue(config?.apisslport) ||
    trimConfValue(config?.apiportssl) ||
    fallback
  );
}

/**
 * Resolve the embedded-Core connection settings the wallet should use and the
 * nexus.conf mutations required so Core's next start matches.
 *
 * Historical behavior (pre-isolation loadNexusConf): credentials come from
 * conf; SSL/port preferences from wallet settings overlay conf values.
 *
 * IMPORTANT: Core's recognized SSL API port key is `apisslport` (verified
 * against the bundled nexus binary). Writing only `apiportssl` leaves Core on
 * 8443 while the GUI connects to 7080 → permanent "Connecting to Nexus Core…".
 */
function resolveEmbeddedCoreConnection(configInput, settings = {}) {
  const config = { ...(configInput || {}) };

  // Migrate the historical wallet-only alias to the Core-recognized key.
  if (
    (config.apisslport === undefined || config.apisslport === '') &&
    config.apiportssl
  ) {
    config.apisslport = trimConfValue(config.apiportssl);
  }

  const useSSL = !settings.embeddedCoreUseNonSSL;
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
    apisslport: desiredPortSSL,
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
    apisslport: desiredPortSSL,
  };
  for (const [key, value] of Object.entries(desiredConf)) {
    if (String(config[key]) !== String(value)) {
      config[key] = value;
      changed = true;
    }
  }

  // Drop the non-functional alias so conf matches what Core actually reads.
  if (config.apiportssl !== undefined) {
    delete config.apiportssl;
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
