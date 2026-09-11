'use strict';

// 开发模式启动器：先起 Vite dev server，就绪后再启动 Electron 并指向 dev URL。
// 不依赖 concurrently / wait-on / cross-env，仅用 Node 内置模块。
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const DEV_URL = process.env.LONGPET_FAMILY_DEV_URL || 'http://127.0.0.1:5173';
const VITE_ROOT = path.join(__dirname, '..');

function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) return reject(new Error('Vite dev server 启动超时'));
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(1500, () => {
        req.destroy();
        attempt();
      });
      req.on('error', () => {
        req.destroy();
        attempt();
      });
    };
    attempt();
  });
}

async function main() {
  const vitePkgPath = require.resolve('vite/package.json', { paths: [VITE_ROOT] });
  const vitePkg = require(vitePkgPath);
  const viteBin = path.join(path.dirname(vitePkgPath), vitePkg.bin.vite);
  const vite = spawn(process.execPath, [viteBin], {
    cwd: VITE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, BROWSER: 'none' }
  });

  const shutdown = () => {
    vite.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await waitForServer(DEV_URL);
  } catch (error) {
    console.error('[dev]', error.message);
    vite.kill();
    process.exit(1);
  }

  const electronPath = require('electron', { paths: [VITE_ROOT] });
  const electron = spawn(electronPath, ['.'], {
    cwd: VITE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: DEV_URL }
  });
  electron.on('exit', () => shutdown());
  vite.on('exit', () => {
    electron.kill();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[dev]', error);
  process.exit(1);
});
