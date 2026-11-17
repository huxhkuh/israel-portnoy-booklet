'use strict';

// Browser checks are development tools, not a dependency of the static website.
try {
  module.exports = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
} catch {
  throw new Error('Playwright is required for browser checks. Set PLAYWRIGHT_MODULE to an installed Playwright module, or install Playwright in your development environment.');
}
