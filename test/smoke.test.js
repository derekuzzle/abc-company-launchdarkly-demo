const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { SignJWT } = require('jose');
const { TestData } = require('@launchdarkly/node-server-sdk');
const { createApp } = require('../server');
const { createFlagEvaluator, FLAG_KEY } = require('../flag');

const run = promisify(execFile);
const origin = 'http://localhost:3000';
const secret = 'test-session-secret-with-at-least-32-chars';
const environment = {
  APP_PUBLIC_ORIGIN: origin, APP_SESSION_SECRET: secret,
  MANUS_PROJECT_ID: 'sample-project', MANUS_OAUTH_PORTAL_URL: 'https://login.example',
  MANUS_OAUTH_API_URL: 'https://auth.example', CHAT_ALLOWED_EMAILS: 'owner@example.com',
  LD_SDK_KEY: '', OPENAI_API_KEY: '', LAUNCHDARKLY_CLIENT_SIDE_ID: ''
};
const servers = [];
after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

async function serve(options) {
  const app = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function sessionCookie(email = 'owner@example.com', expiration = '4h') {
  const token = await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' })
    .setSubject('test-openid').setIssuer('abc-company-chat').setAudience('sample-project')
    .setIssuedAt().setExpirationTime(expiration).sign(new TextEncoder().encode(secret));
  return `webdev_app_session=${token}`;
}

function chat(base, body, cookie, requestOrigin = origin) {
  return fetch(`${base}/api/chat`, { method: 'POST', headers: {
    'content-type': 'application/json', origin: requestOrigin, ...(cookie ? { cookie } : {})
  }, body: JSON.stringify(body) });
}
const validBody = { userKey: 'alex-free', message: 'Hello' };

test('health, landing page, routes manifest, and self-hosted SDK load', async () => {
  const base = await serve({ env: environment });
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
  assert.match(await (await fetch(base)).text(), /Good support/);
  assert.deepEqual((await (await fetch(`${base}/manus-routes.json`)).json()).routes.map((item) => item.path), ['/']);
  const sdk = await fetch(`${base}/vendor/launchdarkly.js`);
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /createClient/);
});

test('public config and session status never reveal private credentials', async () => {
  const base = await serve({ env: { ...environment, LAUNCHDARKLY_CLIENT_SIDE_ID: 'public-test-id' } });
  const raw = await (await fetch(`${base}/api/config`)).text();
  const data = JSON.parse(raw);
  assert.equal(data.users.length, 5);
  assert.ok(data.users.every((user) => ['key', 'name', 'email', 'plan', 'region', 'role', 'betaTester'].every((field) => field in user)));
  assert.equal(data.clientSideId, 'public-test-id');
  assert.doesNotMatch(raw, /LD_SDK_KEY|OPENAI_API_KEY|APP_SESSION_SECRET|CHAT_ALLOWED_EMAILS/);
  assert.deepEqual(await (await fetch(`${base}/api/auth/session`)).json(),
    { configured: true, authenticated: false, email: null });
});

test('chat requires an authenticated and allowlisted Manus session and exact origin', async () => {
  const base = await serve({ env: environment, evaluateFlag: async () => true });
  assert.equal((await chat(base, validBody)).status, 401);
  const cookie = await sessionCookie();
  assert.equal((await chat(base, validBody, cookie, 'https://evil.example')).status, 403);
  assert.equal((await chat(base, validBody, await sessionCookie('unknown@example.com'))).status, 401);
  assert.equal((await chat(base, validBody, `${cookie}tampered`)).status, 401);
  assert.equal((await chat(base, validBody, await sessionCookie('owner@example.com', '-1s'))).status, 401);
  const authenticated = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
  assert.equal((await authenticated.json()).email, 'owner@example.com');
});

test('Preview session JWT must be signed, unexpired, for this project, and allowlisted', async () => {
  const previewSecret = 'separate-platform-test-secret';
  const base = await serve({ env: { ...environment, MANUS_JWT_SECRET: previewSecret },
    evaluateFlag: async () => true, inspectAiConfig: async () => null });
  async function previewCookie(appId, email) {
    const token = await new SignJWT({ appId, openId: 'preview-openid', email })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(previewSecret));
    return `webdev_app_session=${token}`;
  }
  assert.equal((await chat(base, validBody, await previewCookie('sample-project', 'owner@example.com'))).status, 200);
  assert.equal((await chat(base, validBody, await previewCookie('wrong-project', 'owner@example.com'))).status, 401);
  assert.equal((await chat(base, validBody, await previewCookie('sample-project', 'stranger@example.com'))).status, 401);
});

test('chat rejects unknown contexts and invalid messages after authentication', async () => {
  const base = await serve({ env: environment, evaluateFlag: async () => true });
  const cookie = await sessionCookie();
  assert.equal((await chat(base, { userKey: 'impostor', message: 'Hi' }, cookie)).status, 400);
  assert.equal((await chat(base, { userKey: 'alex-free', message: ' ' }, cookie)).status, 400);
  assert.equal((await chat(base, { userKey: 'alex-free', message: 'x'.repeat(501) }, cookie)).status, 400);
});

test('server flag denies off and unavailable states before AI, independent of browser widget', async () => {
  let inspected = 0;
  let enabled = false;
  const base = await serve({ env: environment, evaluateFlag: async () => enabled,
    inspectAiConfig: async () => { inspected += 1; return null; } });
  const cookie = await sessionCookie();
  assert.equal((await chat(base, validBody, cookie)).status, 403);
  assert.equal(inspected, 0);
  enabled = true;
  assert.equal((await chat(base, validBody, cookie)).status, 200);
  assert.equal(inspected, 1);
  const noSdk = await serve({ env: environment });
  assert.equal((await chat(noSdk, validBody, cookie)).status, 503);
  const unavailable = await serve({ env: environment, evaluateFlag: async () => { throw Error('offline'); },
    inspectAiConfig: async () => { inspected += 1; } });
  assert.equal((await chat(unavailable, validBody, cookie)).status, 503);
  assert.equal(inspected, 1);
});

test('real server SDK re-evaluates off, targeted and updated flag rules', async () => {
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

test('enabled flag with no provider key produces a labeled canned reply', async () => {
  const base = await serve({ env: environment, evaluateFlag: async () => true, inspectAiConfig: async () => null });
  const response = await chat(base, validBody, await sessionCookie());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.mode, 'CANNED RESPONSE');
  assert.equal(data.variation, 'not evaluated');
  assert.match(data.reply, /Alex Rivera/);
});

test('a kill switch during AI Config inspection denies the pending response', async () => {
  let enabled = true;
  const base = await serve({ env: environment, evaluateFlag: async () => enabled,
    inspectAiConfig: async () => { enabled = false; return null; } });
  const response = await chat(base, validBody, await sessionCookie());
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /switched off/);
});

test('independent server emergency switch denies chat even if a cached flag is true', async () => {
  let evaluated = false;
  const base = await serve({ env: { ...environment, CHAT_EMERGENCY_OFF: 'true' },
    evaluateFlag: async () => { evaluated = true; return true; } });
  const response = await chat(base, validBody, await sessionCookie());
  assert.equal(response.status, 403);
  assert.equal(evaluated, false);
  assert.match((await response.json()).error, /emergency switch/);
});

test('chat rate limit and in-flight limit respond 429 with Retry-After', async () => {
  const cookie = await sessionCookie();
  const base = await serve({ env: environment, evaluateFlag: async () => true, inspectAiConfig: async () => null });
  for (let i = 0; i < 12; i++) assert.equal((await chat(base, validBody, cookie)).status, 200);
  const blocked = await chat(base, validBody, cookie);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);

  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let count = 0;
  const slow = await serve({ env: environment, evaluateFlag: async () => true, inspectAiConfig: async () => {
    count += 1;
    if (count === 2) enter();
    await barrier;
    return null;
  } });
  const a = chat(slow, validBody, cookie);
  const b = chat(slow, validBody, cookie);
  await entered;
  const busy = await chat(slow, validBody, cookie);
  assert.equal(busy.status, 429);
  release();
  assert.deepEqual([(await a).status, (await b).status], [200, 200]);
});

test('OAuth binds state to a single browser nonce and allowlisted email', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => url.endsWith('ExchangeToken') ? { accessToken: 'test-token' } :
      { openId: 'test-openid', email: 'owner@example.com' } };
  };
  const base = await serve({ env: environment, fetcher });
  const start = await fetch(`${base}/api/auth/start?origin=${encodeURIComponent(origin)}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const nonce = start.headers.get('set-cookie').split(';')[0];
  const redirect = new URL(start.headers.get('location'));
  assert.equal(redirect.searchParams.get('redirectUri'), `${origin}/api/auth/callback`);
  const callback = `${base}/api/auth/callback?code=example&state=${encodeURIComponent(redirect.searchParams.get('state'))}`;
  assert.equal((await fetch(callback, { redirect: 'manual' })).status, 400);
  const success = await fetch(callback, { redirect: 'manual', headers: { cookie: nonce } });
  assert.equal(success.status, 303);
  assert.match(success.headers.get('set-cookie'), /webdev_app_session=/);
  assert.equal((await fetch(callback, { redirect: 'manual', headers: { cookie: nonce } })).status, 400);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.redirectUri, `${origin}/api/auth/callback`);
  assert.equal((await fetch(`${base}/api/auth/start?origin=https%3A%2F%2Fevil.example`, { redirect: 'manual' })).status, 400);
});

test('OAuth refuses users outside the allowlist and uses Secure cookies on HTTPS', async () => {
  const hostedOrigin = 'https://demo.example';
  const fetcher = async (url) => ({ ok: true, json: async () => url.endsWith('ExchangeToken') ?
    { accessToken: 'test-token' } : { openId: 'other-id', email: 'stranger@example.com' } });
  const base = await serve({ env: { ...environment, APP_PUBLIC_ORIGIN: hostedOrigin }, fetcher });
  const start = await fetch(`${base}/api/auth/start?origin=${encodeURIComponent(hostedOrigin)}`, { redirect: 'manual' });
  assert.match(start.headers.get('set-cookie'), /SameSite=None; Secure/);
  const nonce = start.headers.get('set-cookie').split(';')[0];
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const denied = await fetch(`${base}/api/auth/callback?code=example&state=${encodeURIComponent(state)}`,
    { redirect: 'manual', headers: { cookie: nonce } });
  assert.equal(denied.status, 403);
  assert.doesNotMatch(denied.headers.get('set-cookie'), /webdev_app_session=/);
});

test('OAuth sign-in initiation is limited per connection', async () => {
  const base = await serve({ env: environment });
  for (let i = 0; i < 12; i++) {
    const response = await fetch(`${base}/api/auth/start?origin=${encodeURIComponent(origin)}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
  }
  const blocked = await fetch(`${base}/api/auth/start?origin=${encodeURIComponent(origin)}`, { redirect: 'manual' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
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
