// Test-only Electron entry point: execute the deterministic worker with Node
// on Windows too. No fixture capability is included in the shipped app.
const path = require('node:path');
const cp = require('node:child_process');
const fixture = path.join(__dirname, 'fake-codex.cjs');
const originalSpawn = cp.spawn;
cp.spawn = (command, args, options) => command === fixture
  ? originalSpawn(process.execPath, [fixture, ...args], { ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' } })
  : originalSpawn(command, args, options);
const { CodexRunner } = require('../../electron/codex-runner.cjs');
CodexRunner.prototype.status = async () => ({ ready: true, command: fixture, message: '集成测试' });
require('../../electron/main.cjs');
