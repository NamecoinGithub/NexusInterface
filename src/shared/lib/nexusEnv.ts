/**
 * Safe accessor for `window.nexusEnv`, which is exposed by the preload
 * script (see src/main/preload.js). Renderer code should read platform/env
 * information through this module instead of the `process` global, since
 * `process` is unavailable in the renderer's main world when
 * contextIsolation is enabled and nodeIntegration is disabled.
 */
export interface NexusEnv {
  /** Mirrors `process.env.NODE_ENV` from the main process. */
  NODE_ENV: string;
  /** Dev server port, only meaningful when `NODE_ENV === 'development'`. */
  PORT: string;
  /** Mirrors `process.platform` from the main process. */
  platform: NodeJS.Platform;
  /** Mirrors `process.arch` from the main process. */
  arch: string;
  /** Mirrors `process.env.HOME`; populated on macOS/Linux. */
  HOME: string;
  /** Mirrors `process.env.USERPROFILE`; populated on Windows. */
  USERPROFILE: string;
}

const fallbackNexusEnv: NexusEnv = {
  NODE_ENV: 'production',
  PORT: '',
  platform: 'linux',
  arch: '',
  HOME: '',
  USERPROFILE: '',
};

const injectedNexusEnv: NexusEnv | undefined = (window as any).nexusEnv;
if (!injectedNexusEnv) {
  // window.nexusEnv should always be set by the preload script
  // (src/main/preload.js). If it's missing, fall back to safe defaults but
  // log loudly so the misconfiguration doesn't silently masquerade as Linux.
  console.error(
    'window.nexusEnv is not available; the preload bridge may not have run. ' +
      'Falling back to default platform/env values, which may be incorrect.'
  );
}

const nexusEnv: NexusEnv = injectedNexusEnv || fallbackNexusEnv;

export default nexusEnv;

export const isDevelopment = nexusEnv.NODE_ENV === 'development';
export const platform = nexusEnv.platform;
