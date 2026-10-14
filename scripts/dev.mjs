#!/usr/bin/env node
// Runs the API (watch mode) and the web dev server together, cross-platform —
// plus the Paper Correction service (exam-vision/) when it is configured for this machine.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function envFile() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]));
}

const procs = [];
function run(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && !opts.direct, ...opts });
  const tag = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    if (!opts.optional) shutdown();
  });
  procs.push(p);
}

run('api', npm, ['run', 'dev', '--workspace', 'backend']);
run('web', npm, ['run', 'dev', '--workspace', 'frontend']);

// Paper Correction: started here when EXAM_VISION_URL points at this machine and the
// service's Python environment exists (see exam-vision/README.md). Optional: if it stops,
// the rest keeps running and the module shows "not connected".
const env = { ...envFile(), ...process.env };
const examDir = path.join(root, 'exam-vision', 'backend');
const python = path.join(examDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (env.EXAM_VISION_URL && env.EXAM_VISION_SECRET) {
  const url = new URL(env.EXAM_VISION_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    console.log(`[exam] using the Paper Correction service at ${url.origin}`);
  } else if (!existsSync(python)) {
    console.log('[exam] Paper Correction not started: create exam-vision/backend/.venv first (see HOW-TO-RUN.txt)');
  } else {
    run('exam', python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', url.port || '8006'], {
      cwd: examDir, direct: true, optional: true,
      env: { ...process.env, EXAM_GATEWAY_SECRET: env.EXAM_VISION_SECRET, PYTHONUNBUFFERED: '1' },
    });
  }
}

function shutdown() { procs.forEach((p) => p.exitCode === null && p.kill()); }
process.on('SIGINT', () => { shutdown(); process.exit(0); });
