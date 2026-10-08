# Registry release cleanup

Approved scope: complete the release cleanup from the readiness assessment, retaining version 1.0.0 and the current runtime behavior.

- [x] Set the exact registered publisher ID supplied by the user.
- [x] Reference LICENSE in metadata and ship license, icon, and README demo assets.
- [x] Render the existing icon design at 400 by 400.
- [x] Replace obsolete appearance assertions; allow browser tests to use installed assets.
- [x] Build and extract the ZIP into an isolated ComfyUI base; verify server discovery and run all browser suites sequentially in both renderers.
- [x] Run unit tests, inspect packaging and screenshots, and record verification.

Publishing remains a separate final action once the verified package and publisher configuration are ready.
