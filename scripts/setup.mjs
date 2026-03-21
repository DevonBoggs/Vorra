#!/usr/bin/env node
// Cross-platform setup dispatcher
// Usage: npm run setup (or: node scripts/setup.mjs)

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const isWin = process.platform === 'win32';

const cmd = isWin
  ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'setup.ps1')], { cwd: root, stdio: 'inherit' })
  : spawn('bash', [join(root, 'setup.sh')], { cwd: root, stdio: 'inherit' });

cmd.on('close', (code) => process.exit(code || 0));
