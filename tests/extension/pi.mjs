/**
 * The Pi the extension seam runs on: the vendored build (ADR-0006, `vendor/pi` compiled into
 * `build/node_modules` by `npm run build:runtime`), the same copy the Keeper launch, the reader
 * children and pi-backend load. Tests import Pi from here, never from the installed
 * `@earendil-works/pi-coding-agent`, so the legacy engine the suite exercises is the product's.
 * `pi-ai` is not vendored: the installed one is the only copy and both sides share it.
 */
export * from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
