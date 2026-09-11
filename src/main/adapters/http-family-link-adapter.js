'use strict';

const { FamilyLinkError } = require('../../shared/family-link-error');

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new FamilyLinkError('CONFIGURATION_ERROR', '设备地址不是有效 URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new FamilyLinkError('CONFIGURATION_ERROR', '设备地址只支持 HTTP 或 HTTPS');
  }
  if (url.username || url.password) {
    throw new FamilyLinkError('CONFIGURATION_ERROR', '设备地址不能包含用户名或密码');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

class HttpFamilyLinkAdapter {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = String(options.token ?? '').trim();
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (typeof this.fetchImpl !== 'function') {
      throw new FamilyLinkError('CONFIGURATION_ERROR', '当前运行时不支持 fetch');
    }
  }

  async getStatus() {
    return this.request('/api/v1/status');
  }

  async getSettings() {
    return this.request('/api/v1/settings');
  }

  async updateSettings(payload) {
    return this.request('/api/v1/settings', { method: 'PATCH', body: payload });
  }

  async listReminders() {
    const response = await this.request('/api/v1/reminders');
    return response.items;
  }

  async getVideoCall() {
    return this.request('/api/v1/video-call');
  }

  async startVideoCall(payload) {
    return this.request('/api/v1/video-call', { method: 'POST', body: payload });
  }

  async applyVideoCallAction(payload) {
    return this.request('/api/v1/video-call/actions', { method: 'POST', body: payload });
  }

  async createVisionMonitorSession() {
    return this.request('/api/v1/vision-monitor/sessions', { method: 'POST' });
  }

  async createMotionControlSession() {
    return this.request('/api/v1/motion-control/sessions', { method: 'POST' });
  }

  async createReminder(payload) {
    return this.request('/api/v1/reminders', { method: 'POST', body: payload });
  }

  async updateReminder(id, payload) {
    return this.request(`/api/v1/reminders/${id}`, { method: 'PUT', body: payload });
  }

  async deleteReminder(id, expectedRevision) {
    return this.request(
      `/api/v1/reminders/${id}?expectedRevision=${encodeURIComponent(expectedRevision)}`,
      { method: 'DELETE' }
    );
  }

  async request(pathname, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      Accept: 'application/json',
      'X-LongPet-Client': 'family-desktop/0.1'
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new FamilyLinkError('REQUEST_TIMEOUT', '连接设备超时', { cause: error });
      }
      throw new FamilyLinkError('DEVICE_UNREACHABLE', '无法连接 LongPet 设备', {
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new FamilyLinkError('INVALID_RESPONSE', '设备返回了无效 JSON', {
          status: response.status,
          cause: error
        });
      }
    }

    if (!response.ok) {
      throw new FamilyLinkError(
        payload?.error?.code ?? `HTTP_${response.status}`,
        payload?.error?.message ?? `设备请求失败（HTTP ${response.status}）`,
        { status: response.status, details: payload?.error?.details ?? null }
      );
    }

    return payload;
  }
}

module.exports = { HttpFamilyLinkAdapter, normalizeBaseUrl };
