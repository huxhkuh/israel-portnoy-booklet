# Vendored PDF.js

Version: **6.5.438** (`pdfjs-dist`).

Official source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz

Project: https://github.com/mozilla/pdf.js

The files under `legacy/build/` and `legacy/web/` are copied unchanged from the corresponding `package/legacy/` paths in the official npm tarball. They include the official compatibility polyfills for newer JavaScript APIs. The viewer, main library and worker use the same version. Shared cmaps, fonts, WASM and ICC assets remain in their existing directories.

License: Apache-2.0; see `LICENSE` in this directory and notices retained in each module.

Verified SHA-256 values:

- `legacy/build/pdf.mjs`: `2792b7c390ad6d5f4245d326b70deebbc990fa4bcac691412f6df886abb9e867` (1098939 bytes).
- `legacy/build/pdf.worker.mjs`: `8336aabf764cb08c818555a2fd2545e4fed10837146de927564875c93b3c4f83` (2436164 bytes).
- `legacy/web/pdf_viewer.mjs`: `ea80bb58e03d4065b8739a6d7fee884745ba4064b8e007f7f26ff35c948a9538` (485327 bytes).
