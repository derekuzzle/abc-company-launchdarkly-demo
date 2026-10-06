const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { TestData } = require('@launchdarkly/node-server-sdk');
const { createApp } = require('../server');
const { createFlagEvaluator, FLAG_KEY } = require('../flag');

const run = promisify(execFile);
const credentials = { LAUNCHDARKLY_CLIENT_SIDE_ID: 'public-test-id', LD_SDK_KEY: 'sdk-test-only', OPENAI_API_KEY: '' };
const validBody = { userKey: 'alex-free', message: 'Hello' };
const servers = [];
after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

async function serve(options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

function chat(base, body = validBody) {
  return fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

test('importing the server with SDK keys set exits without starting an SDK connection', async () => {
  const { stdout } = await run(process.execPath, ['-e', "require('./server'); console.log('loaded')"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, LD_SDK_KEY: 'sdk-local-test-placeholder' }, timeout: 2500
  });
  assert.match(stdout, /loaded/);
});

test('Express serves the page, health, route manifest and browser SDK bundle', async () => {
  const base = await serve({ env: {}, evaluateFlag: async () => false });
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
  const html = await (await fetch(base)).text();
  assert.match(html, /Good support/);
  assert.match(html, /<span class="brand-mark" aria-hidden="true">ABC<\/span>/);
  assert.deepEqual((await (await fetch(`${base}/manus-routes.json`)).json()).routes.map((route) => route.path), ['/']);
  const sdk = await fetch(`${base}/vendor/launchdarkly.js`);
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /createClient/);
  assert.equal((await fetch(`${base}/api/auth/session`)).status, 404);
});

test('browser config contains only the public ID, passcode-required boolean and sample contexts', async () => {
  const base = await serve({ env: { ...credentials, DEMO_PASSCODE: 'private-test-value' }, evaluateFlag: async () => true });
  const raw = await (await fetch(`${base}/api/config`)).text();
  const data = JSON.parse(raw);
  assert.equal(data.clientSideId, 'public-test-id');
  assert.equal(data.passcodeRequired, true);
  assert.equal(data.users.length, 5);
  assert.ok(data.users.every((user) => ['key', 'name', 'email', 'plan', 'region', 'role', 'betaTester'].every((key) => key in user)));
  assert.doesNotMatch(raw, /private-test-value|sdk-test-only|OPENAI_API_KEY/);
  const open = await serve({ env: credentials, evaluateFlag: async () => true });
  assert.equal((await (await fetch(`${open}/api/config`)).json()).passcodeRequired, false);
});

test('only the two SDK credentials are needed for an open, labeled canned chat reply', async () => {
  const base = await serve({ env: credentials, evaluateFlag: async () => true });
  const response = await chat(base);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.mode, 'CANNED RESPONSE');
  assert.equal(data.reason, 'OpenAI key not set');
  assert.equal(data.variation, 'not evaluated');
  assert.match(data.reply, /Alex Rivera/);
});

test('optional DEMO_PASSCODE rejects missing or wrong values and accepts the right one', async () => {
  const base = await serve({ env: { ...credentials, DEMO_PASSCODE: 'reviewer-only' }, evaluateFlag: async () => true });
  const missing = await chat(base);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('X-Demo-Passcode-Accepted'), null);
  assert.equal((await chat(base, { ...validBody, passcode: 'wrong' })).status, 401);
  const correct = await chat(base, { ...validBody, passcode: 'reviewer-only' });
  assert.equal(correct.status, 200);
  assert.equal(correct.headers.get('X-Demo-Passcode-Accepted'), 'true');
  assert.equal((await correct.json()).mode, 'CANNED RESPONSE');
  assert.equal((await chat(base)).status, 401);
  const off = await serve({ env: { ...credentials, DEMO_PASSCODE: 'reviewer-only' }, evaluateFlag: async () => false });
  const denied = await chat(off, { ...validBody, passcode: 'reviewer-only' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('X-Demo-Passcode-Accepted'), 'true');
});

test('chat rejects unknown sample contexts and invalid messages', async () => {
  const base = await serve({ env: credentials, evaluateFlag: async () => true });
  assert.equal((await chat(base, { userKey: 'impostor', message: 'Hi' })).status, 400);
  assert.equal((await chat(base, { userKey: 'alex-free', message: ' ' })).status, 400);
  assert.equal((await chat(base, { userKey: 'alex-free', message: 'x'.repeat(501) })).status, 400);
});

test('server checks the release flag exactly once per request and blocks off or unavailable states', async () => {
  const calls = [];
  const base = await serve({ env: credentials, evaluateFlag: async (context) => {
    calls.push(context.key);
    return context.key === 'alex-free';
  } });
  assert.equal((await chat(base)).status, 200);
  assert.equal((await chat(base, { userKey: 'taylor-pro', message: 'Hello' })).status, 403);
  assert.deepEqual(calls, ['alex-free', 'taylor-pro']);
  let checked = 0;
  const withAi = await serve({ env: { ...credentials, OPENAI_API_KEY: 'test-key' },
    evaluateFlag: async () => { checked += 1; return true; }, inspectAiConfig: async () => null });
  assert.equal((await chat(withAi)).status, 200);
  assert.equal(checked, 1);
  const noKey = await serve({ env: { ...credentials, LD_SDK_KEY: '' } });
  assert.equal((await chat(noKey)).status, 503);
  const unavailable = await serve({ env: credentials, evaluateFlag: async () => { throw Error('offline'); } });
  assert.equal((await chat(unavailable)).status, 503);
});

test('real LaunchDarkly server SDK updates targeted and global flag values offline', async () => {
  const data = new TestData();
  data.update(data.flag(FLAG_KEY).booleanFlag().variationForAll(false));
  const evaluate = createFlagEvaluator('sdk-test-only', { updateProcessor: data.getFactory() });
  const alex = { kind: 'user', key: 'alex-free' };
  const taylor = { kind: 'user', key: 'taylor-pro' };
  try {
    assert.equal(await evaluate(alex), false);
    data.update(data.flag(FLAG_KEY).booleanFlag()
      .variationForContext('user', 'alex-free', true).fallthroughVariation(false));
    assert.equal(await evaluate(alex), true);
    assert.equal(await evaluate(taylor), false);
    data.update(data.flag(FLAG_KEY).on(false));
    assert.equal(await evaluate(alex), false);
  } finally { await evaluate.close(); }
});

test('simple per-IP limit allows 20 chat requests per 15 minutes, then returns 429', async () => {
  const base = await serve({ env: credentials, evaluateFlag: async () => true });
  for (let i = 0; i < 20; i++) assert.equal((await chat(base)).status, 200);
  const blocked = await chat(base);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('a missing AI Config falls back to a labeled canned reply even with a provider key', async () => {
  const base = await serve({ env: { ...credentials, OPENAI_API_KEY: 'test-key' },
    evaluateFlag: async () => true, inspectAiConfig: async () => null });
  const data = await (await chat(base)).json();
  assert.equal(data.mode, 'CANNED RESPONSE');
  assert.match(data.reason, /AI Config unavailable/);
});

test('host-assigned PORT wins over a local .env default', () => {
  const oldPort = process.env.PORT;
  process.env.PORT = '31991';
  try { require('dotenv').config(); assert.equal(process.env.PORT, '31991'); }
  finally { if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort; }
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
  } finally { trigger.close(); }
});

test('kill switch fails clearly when a trigger URL is missing', async () => {
  await assert.rejects(run(process.execPath, [path.join(__dirname, '../scripts/kill-switch.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, LAUNCHDARKLY_TRIGGER_URL: '' }
  }), (error) => { assert.match(error.stderr, /Set LAUNCHDARKLY_TRIGGER_URL/); return true; });
});
