# Detail Document: Electron Toolchain and IPC Hardening

## Purpose

This document records the detail-level scope for the branch after updating from the recent `Merging` branch PR merges and finishing Stage 1 of the Nexus Interface GUI security upgrade.

- PR #15: analysis and implementation plan for repository issues
- PR #16: Core binary validation and process detection fixes
- PR #17: incremental Electron window IPC hardening
- PR #18: follow-up GUI security and Core binary hardening

The final branch work preserves those merged changes while closing the remaining main-renderer sandbox gap, replacing deprecated notarization tooling, pinning the requested build/runtime versions, adding deterministic CI, and documenting the security posture.

## Current Problem Areas

### Core binary configuration

The wallet can use either the bundled Nexus Core binary or an override supplied by `NEXUS_CORE_BINARY_PATH`, `NEXUS_CORE_BINARY`, or the Core settings screen. The unsafe cases are malformed paths, relative paths, directories, non-executable POSIX files, and non-`.exe` Windows targets.

The branch normalizes configured paths, handles matching shell quotes and `~` home-directory prefixes, requires absolute paths, and returns structured Core binary status data for UI and startup error messages.

### Core process detection

Core shutdown and running-state detection must identify the intended Nexus Core process without matching unrelated processes by substring. The branch parses process-list output, ignores PID 1, parses Windows CSV task output, and compares commands against the configured binary path and binary name.

### Privileged Electron IPC

Renderer-accessible IPC calls must not forward arbitrary object shapes, paths, menu templates, or protocol values directly into main-process Electron APIs. The branch adds type and allowlist checks for dialog options, app path names, menu roles, virtual keyboard options, Core parameters, updater booleans, file server inputs, context menu webContents ownership, and proxy request URLs.

The main renderer now runs with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Renderer imports of `electron` are resolved to `src/shared/lib/electronBridge.ts`, which talks to a preload-exposed bridge instead of exposing Electron directly. Privileged clipboard, shell, and Aptabase calls are routed through explicit, validated main-process IPC handlers so the sandboxed preload does not need direct access to those Electron modules.

### Toolchain determinism

The Electron/build toolchain uses exact pins for the requested high-risk packages: Electron, Electron Builder, Webpack, Webpack CLI, Webpack Dev Server, Webpack Merge, Babel Core, Babel Loader, React, and React DOM. The deprecated `electron-notarize` package has been replaced with `@electron/notarize`. CI and contributor setup use `npm ci` so `package-lock.json` is the authority for reproducible installs.

### Core binary settings UI

The Core settings screen needs an explicit way to choose an external Core binary without forcing users to type paths manually. The branch keeps the Core Binary Path field and adds a Browse button that writes the selected file path into the existing settings form field.

## Implementation Summary

- `src/main/core.js`
  - Adds Core binary path normalization and structured binary status reporting.
  - Validates file existence, absolute paths, file-vs-directory state, POSIX execute permission, and Windows executable extension.
  - Improves running-process lookup for Windows, macOS, and Linux.
  - Makes Core shutdown a no-op when no Core PID is found.

- `src/main/main.js`
  - Adds explicit sanitizers for renderer IPC inputs.
  - Restricts dialog, app path, menu, updater, file-server, Core, keyboard, webContents, and proxy request inputs before they reach privileged APIs.
  - Owns privileged clipboard, shell, and Aptabase bridge handlers used by the sandboxed renderer.

- `src/main/renderer.js`
  - Creates the main browser window with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.

- `src/main/preload.js`
  - Exposes only the allowlisted bridge surface needed by the renderer.
  - Routes shell, clipboard, analytics, app-path, and application IPC access through explicit bridge methods.

- `src/App/Settings/Core/EmbeddedCoreSettings.tsx`
  - Adds a Browse button for `embeddedCoreBinaryPath`.
  - Updates the active form field directly when a Core binary is selected.

- `package.json` and `package-lock.json`
  - Keep the runtime requirement aligned with Node `>=22.12.0` and npm `>=10.9.0`.
  - Replace `electron-notarize` with `@electron/notarize`.
  - Keep the Electron/build toolchain pins exact and regenerate the lockfile.

- `.github/workflows/build.yml`
  - Runs `npm ci` and `npm run build` on pull requests and pushes to `Merging`.

- `README.md`
  - Keeps setup instructions aligned with the current Node, npm, and Electron requirements.

## Validation Expectations

- Install dependencies with `npm ci`.
- Build production bundles with `npm run build`.
- Confirm the build includes the main, renderer, module preload, and window preload bundles.
- Treat existing dependency audit findings as pre-existing unless a dependency is added or updated.

## Review Notes

- The branch intentionally keeps a single PR scope because the merged base changes and the follow-up hardening overlap in Core startup, Core settings, and Electron IPC.
- No new runtime dependencies are required.
- The highest-risk areas for review are Core process matching edge cases and Electron IPC input compatibility with existing renderer callers.
