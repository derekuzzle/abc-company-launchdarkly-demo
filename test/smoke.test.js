const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const app = require('../server');

const run = promisify(execFile);
const server = app.listen(0, '127.0.0.1');
const ready = new Promise((resolve) => server.on('listening', resolve));
const base = () => `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('health, landing page, routes manifest, and self-hosted SDK load', async () => {
  await ready;
  const health = await fetch(`${base()}/health`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const home = await fetch(base());
  assert.match(await home.text(), /Good support/);
  const manifest = await fetch(`${base()}/manus-routes.json`);
  assert.deepEqual((await manifest.json()).routes.map((item) => item.path), ['/']);
  const sdk = await fetch(`${base()}/vendor/launchdarkly.js`);
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /createClient/);
});

test('public config includes sample contexts but no private credentials', async () => {
  await ready;
  const result = await fetch(`${base()}/api/config`);
  const raw = await result.text();
  const data = JSON.parse(raw);
  assert.equal(data.users.length, 5);
  assert.ok(data.users.every((user) => ['key', 'name', 'email', 'plan', 'region', 'role', 'betaTester'].every((field) => field in user)));
  assert.equal(typeof data.clientSideId, 'string');
  assert.doesNotMatch(raw, /LD_SDK_KEY|OPENAI_API_KEY|LAUNCHDARKLY_TRIGGER_URL/);
});

test('chat rejects unknown contexts and invalid messages', async () => {
  await ready;
  const send = (body) => fetch(`${base()}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal((await send({ userKey: 'impostor', message: 'Hi' })).status, 400);
  assert.equal((await send({ userKey: 'alex-free', message: ' ' })).status, 400);
  assert.equal((await send({ userKey: 'alex-free', message: 'x'.repeat(501) })).status, 400);
});

test('missing keys produce an explicitly labeled canned reply', async () => {
  await ready;
  const oldLd = process.env.LD_SDK_KEY;
  const oldOpenai = process.env.OPENAI_API_KEY;
  process.env.LD_SDK_KEY = '';
  process.env.OPENAI_API_KEY = '';
  try {
    const response = await fetch(`${base()}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userKey: 'alex-free', message: 'Hello' })
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.mode, 'CANNED RESPONSE');
    assert.equal(data.variation, 'not evaluated');
    assert.match(data.reply, /Alex Rivera/);
  } finally {
    if (oldLd === undefined) delete process.env.LD_SDK_KEY;
    else process.env.LD_SDK_KEY = oldLd;
    if (oldOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenai;
  }
});

test('host-assigned PORT wins over a local .env default', () => {
  const oldPort = process.env.PORT;
  process.env.PORT = '31991';
  try {
    require('dotenv').config();
    assert.equal(process.env.PORT, '31991');
  } finally {
    if (oldPort === undefined) delete process.env.PORT;
    else process.env.PORT = oldPort;
  }
});

test('kill switch POSTs to a configured trigger without printing its URL', async () => {
  let method;
  const trigger = http.createServer((req, res) => { method = req.method; res.writeHead(204); res.end(); });
  await new Promise((resolve) => trigger.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${trigger.address().port}/secret-test-token`;
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join(__dirname, '../scripts/kill-switch.js')], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, LAUNCHDARKLY_TRIGGER_URL: url }
    });
    assert.equal(method, 'POST');
    assert.match(stdout, /Kill switch sent/);
    assert.doesNotMatch(stdout + stderr, /secret-test-token/);
  } finally {
    trigger.close();
  }
});

test('kill switch fails clearly when a trigger URL is missing', async () => {
  await assert.rejects(run(process.execPath, [path.join(__dirname, '../scripts/kill-switch.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, LAUNCHDARKLY_TRIGGER_URL: '' }
  }), (error) => {
    assert.match(error.stderr, /Set LAUNCHDARKLY_TRIGGER_URL/);
    return true;
  });
});
