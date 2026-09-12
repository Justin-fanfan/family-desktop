'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  HttpFamilyLinkAdapter,
  normalizeBaseUrl
} = require('../src/main/adapters/http-family-link-adapter');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : null;
}

test('base URL accepts HTTP(S) and rejects embedded credentials', () => {
  assert.equal(normalizeBaseUrl('http://10.0.0.8:8787/'), 'http://10.0.0.8:8787');
  assert.throws(
    () => normalizeBaseUrl('http://root:secret@10.0.0.8:8787'),
    (error) => error.code === 'CONFIGURATION_ERROR'
  );
  assert.throws(
    () => normalizeBaseUrl('ssh://10.0.0.8'),
    (error) => error.code === 'CONFIGURATION_ERROR'
  );
});

test('HTTP adapter sends bearer token and settings revision contract', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'PATCH');
    assert.equal(request.url, '/api/v1/settings');
    assert.equal(request.headers.authorization, 'Bearer pairing-token');
    assert.equal(request.headers['x-longpet-client'], 'family-desktop/0.1');
    assert.deepEqual(await readJson(request), { volume: 74, expectedRevision: 2 });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ volume: 74, revision: 3 }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    const result = await adapter.updateSettings({ volume: 74, expectedRevision: 2 });
    assert.equal(result.revision, 3);
  });
});

test('HTTP adapter unwraps reminder collection', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/api/v1/reminders');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ items: [{ id: 9, title: '测试提醒' }] }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl });
    const reminders = await adapter.listReminders();
    assert.deepEqual(reminders, [{ id: 9, title: '测试提醒' }]);
  });
});

test('HTTP adapter maps reminder create, update and delete contracts', async () => {
  const requests = [];
  await withServer(async (request, response) => {
    const body = await readJson(request);
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(request.method === 'POST' ? 201 : 200,
      { 'Content-Type': 'application/json' });
    if (request.method === 'POST') {
      response.end(JSON.stringify({ id: 12, ...body, revision: 1 }));
    } else if (request.method === 'PUT') {
      response.end(JSON.stringify({ id: 12, ...body, revision: 2 }));
    } else {
      response.end(JSON.stringify({ deleted: true, id: 12 }));
    }
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    const draft = {
      type: 'water', title: '下午喝水', timeOfDay: '15:00',
      scheduledDate: '2026-08-29', repeatRule: 'daily', enabled: true
    };
    const created = await adapter.createReminder(draft);
    const updated = await adapter.updateReminder(created.id, {
      ...draft, title: '下午补水', expectedRevision: created.revision
    });
    const deleted = await adapter.deleteReminder(updated.id, updated.revision);
    assert.equal(deleted.deleted, true);
  });

  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
    { method: 'POST', url: '/api/v1/reminders' },
    { method: 'PUT', url: '/api/v1/reminders/12' },
    { method: 'DELETE', url: '/api/v1/reminders/12?expectedRevision=2' }
  ]);
  assert.equal(requests[0].body.title, '下午喝水');
  assert.equal(requests[1].body.expectedRevision, 1);
  assert.equal(requests[2].body, null);
});

test('HTTP adapter preserves structured device conflicts', async () => {
  await withServer((_request, response) => {
    response.writeHead(409, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      error: {
        code: 'REVISION_CONFLICT',
        message: '设置版本冲突',
        details: { currentRevision: 4 }
      }
    }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl });
    await assert.rejects(
      adapter.updateSettings({ volume: 20, expectedRevision: 1 }),
      (error) => error.code === 'REVISION_CONFLICT'
        && error.status === 409
        && error.details.currentRevision === 4
    );
  });
});

test('HTTP adapter maps video call state and action endpoints', async () => {
  const requests = [];
  await withServer(async (request, response) => {
    const body = await readJson(request);
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      callId: 'call-9',
      state: request.method === 'POST' ? 'connected' : 'outgoing_ringing',
      revision: request.method === 'POST' ? 2 : 1
    }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    const call = await adapter.getVideoCall();
    await adapter.startVideoCall({ mode: 'voice' });
    const accepted = await adapter.applyVideoCallAction({
      callId: call.callId,
      action: 'accept',
      expectedRevision: call.revision
    });
    assert.equal(accepted.state, 'connected');
  });

  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/v1/video-call', body: null },
    { method: 'POST', url: '/api/v1/video-call', body: { mode: 'voice' } },
    {
      method: 'POST',
      url: '/api/v1/video-call/actions',
      body: { callId: 'call-9', action: 'accept', expectedRevision: 1 }
    }
  ]);
});

test('HTTP adapter creates an authenticated AI view session', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/vision-monitor/sessions');
    assert.equal(request.headers.authorization, 'Bearer pairing-token');
    assert.equal(await readJson(request), null);
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      sessionId: 'view-1', sessionToken: 'ephemeral', port: 8789,
      protocolVersion: 1, frameRate: 7
    }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    const session = await adapter.createVisionMonitorSession();
    assert.equal(session.port, 8789);
    assert.equal(session.sessionToken, 'ephemeral');
  });
});

test('HTTP adapter creates an authenticated motion control session', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/motion-control/sessions');
    assert.equal(request.headers.authorization, 'Bearer pairing-token');
    assert.equal(await readJson(request), null);
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      sessionId: 'motion-1', sessionToken: 'ephemeral-motion', port: 8790,
      protocolVersion: 1, refreshIntervalMs: 150, leaseTimeoutMs: 350
    }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    const session = await adapter.createMotionControlSession();
    assert.equal(session.port, 8790);
    assert.equal(session.leaseTimeoutMs, 350);
  });
});

test('HTTP adapter reads and updates automatic head tracking', async () => {
  const requests = [];
  await withServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, body: await readJson(request) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      enabled: request.method === 'PUT',
      active: request.method === 'PUT',
      state: request.method === 'PUT' ? 'SEARCHING' : 'DISABLED'
    }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    assert.equal((await adapter.getAutomaticHeadTracking()).enabled, false);
    assert.equal((await adapter.setAutomaticHeadTracking({ enabled: true })).state,
      'SEARCHING');
  });
  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/v1/automatic-head-tracking', body: null },
    { method: 'PUT', url: '/api/v1/automatic-head-tracking', body: { enabled: true } }
  ]);
});

test('HTTP adapter reads and updates automatic person-follow mode', async () => {
  const requests = [];
  await withServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, body: await readJson(request) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      mode: request.method === 'PUT' ? 'PERSON_FOLLOW' : 'DISABLED',
      followState: request.method === 'PUT' ? 'ACQUIRING' : 'DISABLED'
    }));
  }, async (baseUrl) => {
    const adapter = new HttpFamilyLinkAdapter({ baseUrl, token: 'pairing-token' });
    assert.equal((await adapter.getAutomaticTracking()).mode, 'DISABLED');
    assert.equal((await adapter.setAutomaticTracking({ mode: 'PERSON_FOLLOW' })).followState,
      'ACQUIRING');
  });
  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/v1/automatic-tracking', body: null },
    { method: 'PUT', url: '/api/v1/automatic-tracking', body: { mode: 'PERSON_FOLLOW' } }
  ]);
});
