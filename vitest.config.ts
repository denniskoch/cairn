import { defineConfig } from 'vitest/config'

// Unit tests for pure logic (address parsing, date formatting, etc.).
// Node environment — the functions under test don't touch the DOM or
// Electron APIs. Tests live next to their subject as *.test.ts.
//
// Tests that need the renderer DOM or main-process Electron mocks would
// want a different environment / setup; none exist yet, so keep this
// minimal and node-only.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
