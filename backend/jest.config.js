'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // setupFiles runs before the test framework installs — safe for env vars.
  setupFiles: ['<rootDir>/__tests__/env.js'],
  clearMocks: true,
  testTimeout: 15000,
  collectCoverageFrom: [
    'controllers/**/*.js',
    'services/**/*.js',
    'repositories/**/*.js',
    'admin/controllers/**/*.js',
    '!**/__tests__/**',
    '!**/*.config.js',
  ],
  coverageReporters: ['text', 'lcov'],
};
