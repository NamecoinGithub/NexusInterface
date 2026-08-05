# Context-isolation inventory

This document is the acceptance matrix for renderer privilege boundaries. A
surface is not marked complete merely because it has no direct Node import:
the compiled renderer must also pass the renderer build boundary below.

| Surface | Node integration | Context isolation | Sandbox | Privileged interface | Status |
| --- | --- | --- | --- | --- | --- |
| Main wallet window | Disabled | Enabled | Not enabled | `window.nexusElectron`, exposed by `src/main/preload.js` | Complete for the current migration phase |
| Virtual keyboard window | Disabled | Enabled | Enabled | `src/keyboard/preload.js` | Complete |
| Production module WebViews | Disabled | Disabled | Disabled | Module preload and authorized module-file origin | Deferred compatibility milestone |
| Development module WebViews | Enabled for local development modules only | Disabled | Disabled | Module preload and local developer-selected directory | Deferred compatibility milestone |
| Main-process IPC | N/A | N/A | N/A | Named channels in `src/main/ipc/contracts.js`, registered in `src/main/main.js` | Complete |
| Renderer bundle | N/A | N/A | N/A | Browser-safe Electron bridge alias | Complete |

## Main-window acceptance criteria

- `src/main/renderer.js` sets `nodeIntegration: false`,
  `contextIsolation: true`, and `enableRemoteModule: false`.
- `src/main/preload.js` exposes an allowlisted, typed operation surface rather
  than raw `ipcRenderer`, Node modules, or Electron modules.
- Every registered operation validates its request before invoking a
  main-process service. Operations with no request reject supplied arguments.
- `npm run build-renderer` uses
  `configs/webpack.config.base.renderer.babel.js`, which disables Node and
  Electron externals and resolves browser package conditions. A Node-core
  import in the live renderer graph therefore fails the build rather than
  becoming a runtime `require`.
- `npm run test:security` verifies the URL, path, Core transport, and archive
  boundaries. `test/security/startup.test.js` also checks
  the main and keyboard window hardening configuration.

The main-window sandbox remains an explicit follow-up: the current preload
uses Electron clipboard support and the Aptabase renderer integration, both of
which need a compatibility migration to IPC-safe alternatives before
`sandbox: true` can be enabled without changing behavior.

## Module-WebView deferral

Module WebViews are intentionally not included in the main-window isolation
completion. They retain their existing bridge behavior until React, Emotion,
the module preload, and both production and development modules have a
dedicated compatibility and smoke-test milestone. `src/main/webviewSecurity.js`
still enforces authorized entry URLs, restricts navigation, disables the
remote module, and denies `window.open`; it does **not** claim the isolation
properties of the main wallet window.

## Bootstrap artifact integrity prerequisite

Bootstrap extraction now preflights every ZIP entry and rejects traversal,
duplicate paths, links, encryption, excessive entry counts, excessive
expansion, and unsafe compression ratios before it writes any destination
path. The archive is downloaded to a private temporary file and extracted only
after that preflight completes.

A cryptographic bootstrap-artifact verification cannot safely be enabled until
the bootstrap service publishes a stable, authenticated digest or signed
manifest and its signing contract is supplied to the client. No such artifact
is defined by this repository. Inventing an endpoint or a digest would either
silently provide no assurance or disable bootstrap for existing users, so that
server-side prerequisite remains explicitly outstanding.

## Required validation commands

```sh
npm run test:security
npm run build-renderer
npm run build-main
npm run build-preload
```

The repository workflow at `.github/workflows/security.yml` runs these checks
on pull requests and pushes. A full GUI launch smoke test remains a separate
environment-dependent release check because it requires Electron display and
Core fixtures.
