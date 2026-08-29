'use strict';

const { ipcMain } = require('electron');
const { HttpFamilyLinkAdapter } = require('./adapters/http-family-link-adapter');
const { MockFamilyLinkAdapter } = require('./adapters/mock-family-link-adapter');
const { FamilyLinkService } = require('./services/family-link-service');
const { FamilyLinkError, serializeError } = require('../shared/family-link-error');

const CHANNELS = [
  'family:connection:get',
  'family:connection:configure',
  'family:dashboard:get',
  'family:settings:update',
  'family:reminders:create',
  'family:reminders:update',
  'family:reminders:delete'
];

function success(data) {
  return { ok: true, data };
}

function failure(error) {
  return { ok: false, error: serializeError(error) };
}

class IpcController {
  constructor() {
    this.connection = {
      mode: 'mock',
      baseUrl: 'http://10.188.219.51:8787',
      hasToken: false
    };
    this.service = new FamilyLinkService(new MockFamilyLinkAdapter());
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;

    this.handle('family:connection:get', async () => this.connection);
    this.handle('family:connection:configure', async (_event, request) => {
      const candidate = this.createConnection(request);
      await candidate.service.getDashboard();
      this.service = candidate.service;
      this.connection = candidate.connection;
      return this.connection;
    });
    this.handle('family:dashboard:get', async () => this.service.getDashboard());
    this.handle('family:settings:update', async (_event, request) =>
      this.service.updateSettings(request)
    );
    this.handle('family:reminders:create', async (_event, request) =>
      this.service.createReminder(request)
    );
    this.handle('family:reminders:update', async (_event, request) =>
      this.service.updateReminder(request)
    );
    this.handle('family:reminders:delete', async (_event, request) =>
      this.service.deleteReminder(request)
    );
  }

  createConnection(request) {
    if (!request || typeof request !== 'object') {
      throw new FamilyLinkError('CONFIGURATION_ERROR', '连接配置无效');
    }
    const mode = request.mode === 'mock' ? 'mock' : 'http';
    if (mode === 'mock') {
      return {
        service: new FamilyLinkService(new MockFamilyLinkAdapter()),
        connection: {
          mode,
          baseUrl: 'mock://local',
          hasToken: false
        }
      };
    }

    const adapter = new HttpFamilyLinkAdapter({
      baseUrl: request.baseUrl,
      token: request.token
    });
    return {
      service: new FamilyLinkService(adapter),
      connection: {
        mode,
        baseUrl: adapter.baseUrl,
        hasToken: Boolean(adapter.token)
      }
    };
  }

  handle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return success(await handler(event, ...args));
      } catch (error) {
        return failure(error);
      }
    });
  }

  dispose() {
    for (const channel of CHANNELS) {
      ipcMain.removeHandler(channel);
    }
    this.registered = false;
  }
}

module.exports = { IpcController, CHANNELS };
