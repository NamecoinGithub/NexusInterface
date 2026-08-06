const CAPABILITIES_ARG_PREFIX = '--nexus-capabilities=';

function resolveCapabilitiesFromArgs(argv: string[]): Set<string> {
  try {
    const raw = argv.find((arg) => arg.startsWith(CAPABILITIES_ARG_PREFIX));
    if (!raw) return new Set();
    const encoded = raw.slice(CAPABILITIES_ARG_PREFIX.length);
    const decoded = decodeURIComponent(encoded);
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value) => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

const resolvedCapabilities = resolveCapabilitiesFromArgs(
  Array.isArray(process.argv) ? process.argv : []
);

export function hasCapability(name: string): boolean {
  return resolvedCapabilities.has(name);
}

