Nexus LLL-TAO Node 5.1.7-rc6 build 1 (x86_64)

This is a release candidate, not a production-ready release. Back up wallet
and node data before testing or upgrading. Compatibility of existing Windows
legacy wallets with the included Berkeley DB 5.3 build has not been verified.

Verify the archive's adjacent .sha256 checksum before extracting, and verify
the files against SHA256SUMS.txt after extraction. BUILD-INFO.txt identifies
the exact source commit and build workflow. Third-party notices are in
licenses/. The node is a command-line executable: start nexus on Linux/macOS
or nexus.exe on Windows from a terminal.

nexus.conf.example is a Windows-oriented localhost mining example; its Windows
path comments do not apply on Unix. It is not automatically loaded. Before
copying it to your Nexus data directory and using it, replace every
REPLACE_WITH_* credential with a unique, secure value, review all settings,
and keep the configuration private. See the node's documentation:
https://github.com/NamecoinGithub/LLL-TAO/blob/NODE5/docs/reference/nexus.conf.md

Linux: the executable requires glibc 2.17 or newer. macOS: Intel x86_64,
targeting macOS 10.13 or newer; the binary is unsigned and unnotarized, so
Gatekeeper may block it. Windows: x64 executable is unsigned and may trigger
SmartScreen. No signing credentials are included.
