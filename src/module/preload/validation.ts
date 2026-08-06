/**
 * Client-side defensive validation for the module preload bridge.
 * Main-process validators remain authoritative.
 */

const MAX_STRING = 4096;
const MAX_URL = 2048;
const MAX_COPY = 100000;
const MAX_PROVIDER_KEY = 64;
const MAX_PAIR = 32;
const MAX_AMOUNT = 64;
const MAX_OPAQUE_TOKEN = 128;
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const PAIR_PATTERN = /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/;
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertFunction(value: unknown, name: string): asserts value is Function {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} must be a function`);
  }
}

export function assertString(
  value: unknown,
  name: string,
  { min = 0, max = MAX_STRING }: { min?: number; max?: number } = {}
): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new TypeError(
      `${name} must be a string between ${min} and ${max} characters`
    );
  }
  return value;
}

export function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertOpenableUrl(value: unknown): string {
  const raw = assertString(value, 'URL', { min: 1, max: MAX_URL });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError('URL must be an absolute URL');
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'mailto:') {
    throw new TypeError('URL protocol is not allowed');
  }
  return parsed.toString();
}

export function assertCopyText(value: unknown): string {
  return assertString(value, 'text', { min: 0, max: MAX_COPY });
}

export function assertExchangeProvider(value: unknown): string {
  const provider = assertString(value, 'provider', { min: 1, max: MAX_PROVIDER_KEY });
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new TypeError('provider has invalid format');
  }
  return provider;
}

export function assertExchangePair(value: unknown): string {
  const pair = assertString(value, 'pair', { min: 3, max: MAX_PAIR });
  if (!PAIR_PATTERN.test(pair)) {
    throw new TypeError('pair has invalid format');
  }
  return pair;
}

export function assertExchangeAmount(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('amount must be a string or number');
  }
  const amount = String(value);
  if (!amount || amount.length > MAX_AMOUNT) {
    throw new TypeError(`amount must be a string between 1 and ${MAX_AMOUNT} characters`);
  }
  if (!DECIMAL_AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
    throw new TypeError('amount must be a positive decimal');
  }
  return amount;
}

export function assertExchangeOpaqueToken(value: unknown, name: string): string {
  const token = assertString(value, name, { min: 1, max: MAX_OPAQUE_TOKEN });
  if (!OPAQUE_TOKEN_PATTERN.test(token)) {
    throw new TypeError(`${name} has invalid format`);
  }
  return token;
}
