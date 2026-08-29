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
