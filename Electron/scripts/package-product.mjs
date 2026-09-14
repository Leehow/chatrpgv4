#!/usr/bin/env node
// This inherited product packager cannot assemble the standalone PipiCOC runtime.
console.error('This product-packaging entry is retired. Use node pipicoc/package.mjs from the repository root.');
process.exitCode = 1;
