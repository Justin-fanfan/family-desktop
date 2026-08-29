'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, shell } = require('electron');
const { IpcController } = require('./ipc-controller');

let mainWindow = null;
const smokeCapturePath = process.env.LONGPET_FAMILY_SMOKE_CAPTURE?.trim() || '';
const requestedSmokeView = process.env.LONGPET_FAMILY_SMOKE_VIEW?.trim() || 'dashboard';
const smokeBaseUrl = process.env.LONGPET_FAMILY_SMOKE_BASE_URL?.trim() || '';
const smokeView = new Set(['dashboard', 'settings', 'reminders']).has(requestedSmokeView)
  ? requestedSmokeView
  : 'dashboard';
const ipcController = new IpcController({
  initialBaseUrl: smokeBaseUrl,
  initialToken: process.env.LONGPET_FAMILY_SMOKE_TOKEN?.trim() || ''
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f7f5',
    title: 'LongPet 家属端',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !smokeCapturePath
    }
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!smokeCapturePath) {
      mainWindow.show();
      return;
    }
    mainWindow.setSkipTaskbar(true);
    mainWindow.setOpacity(0);
    mainWindow.showInactive();
  });
  mainWindow.webContents.once('did-finish-load', async () => {
    if (!smokeCapturePath) return;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (smokeBaseUrl) {
        await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const deadline = Date.now() + 7000;
          const poll = () => {
            const mode = document.getElementById('connection-mode')?.textContent;
            const name = document.getElementById('device-name')?.textContent;
            if (mode === '局域网设备' && name && name !== '--') return resolve(true);
            if (Date.now() >= deadline) return reject(new Error('Real device dashboard did not load'));
            setTimeout(poll, 100);
          };
          poll();
        })`);
      }
      if (smokeView !== 'dashboard') {
        const activeViewId = await mainWindow.webContents.executeJavaScript(
          `(() => {
            const target = document.querySelector('[data-view="${smokeView}"]');
            if (!target) return 'missing-navigation-target';
            target.click();
            return document.querySelector('.view.active')?.id || 'missing-active-view';
          })()`
        );
        if (activeViewId !== `view-${smokeView}`) {
          throw new Error(`Smoke navigation failed: expected view-${smokeView}, got ${activeViewId}`);
        }
        mainWindow.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const image = await mainWindow.webContents.capturePage();
      await fs.mkdir(path.dirname(smokeCapturePath), { recursive: true });
      await fs.writeFile(smokeCapturePath, image.toPNG());
      app.exit(0);
    } catch (error) {
      console.error('Smoke capture failed:', error);
      app.exit(1);
    }
  });
  void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcController.register();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => ipcController.dispose());
