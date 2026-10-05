const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { SignJWT, jwtVerify } = require('jose');

const SESSION_COOKIE = 'webdev_app_session';
const NONCE_COOKIE = 'abc_oauth_nonce';
const SESSION_SECONDS = 4 * 60 * 60;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter((pair) => pair.length === 2));
}

function sameValue(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

function validOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  } catch { return false; }
}

function createAuth(env, fetcher = fetch) {
  const origin = env.APP_PUBLIC_ORIGIN || '';
  const secret = env.APP_SESSION_SECRET || '';
  const projectId = env.MANUS_PROJECT_ID || '';
  const allowed = new Set((env.CHAT_ALLOWED_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
  const configured = validOrigin(origin) && secret.length >= 32 && Boolean(projectId &&
    env.MANUS_OAUTH_PORTAL_URL && env.MANUS_OAUTH_API_URL && allowed.size);
  const signingKey = new TextEncoder().encode(secret);
  const secure = origin.startsWith('https:');
  const cookieOptions = `HttpOnly; Path=/; SameSite=${secure ? 'None; Secure' : 'Lax'}`;
  const nonceOptions = `HttpOnly; Path=/api/auth; SameSite=${secure ? 'None; Secure' : 'Lax'}`;
  const pendingNonces = new Map();

  function sameOrigin(req) {
    return configured && req.get('origin') === origin;
  }

  function cookie(name, value, age, options) {
    return `${name}=${value}; Max-Age=${age}; ${options}`;
  }

  function signNonce(nonce) {
    return createHmac('sha256', secret).update(nonce).digest('base64url');
  }

  async function session(req) {
    if (!configured) return null;
    const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    if (!token || token.length > 4096) return null;
    try {
      const { payload } = await jwtVerify(token, signingKey, {
        algorithms: ['HS256'], issuer: 'abc-company-chat', audience: projectId
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' ||
        !allowed.has(payload.email.toLowerCase())) return null;
      return { openId: payload.sub, email: payload.email };
    } catch {
      // Preview may supply its own project JWT. Never trust its claims without HS256 verification.
      if (!env.MANUS_JWT_SECRET) return null;
      try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(env.MANUS_JWT_SECRET),
          { algorithms: ['HS256'] });
        if (!Number.isInteger(payload.exp) || payload.appId !== projectId ||
          typeof payload.openId !== 'string' || typeof payload.email !== 'string' ||
          !allowed.has(payload.email.toLowerCase())) return null;
        return { openId: payload.openId, email: payload.email };
      } catch { return null; }
    }
  }

  async function start(req, res) {
    if (!configured) return res.status(503).send('Chat access is not configured. Set the app origin, allowed emails and session secret.');
    if (req.query.origin !== origin) return res.status(400).send('Invalid application origin.');
    const now = Date.now();
    for (const [key, expiry] of pendingNonces) if (expiry <= now) pendingNonces.delete(key);
    if (pendingNonces.size >= 10000) return res.status(429).send('Too many sign-in attempts. Try again later.');
    const nonce = randomBytes(32).toString('base64url');
    pendingNonces.set(nonce, now + 300000);
    const redirectUri = `${origin}/api/auth/callback`;
    const state = Buffer.from(JSON.stringify({ nonce, redirectUri, issuedAt: now })).toString('base64url');
    res.set('Cache-Control', 'no-store');
    res.set('Set-Cookie', cookie(NONCE_COOKIE, `${nonce}.${signNonce(nonce)}`, 300, nonceOptions));
    const url = new URL(`${env.MANUS_OAUTH_PORTAL_URL.replace(/\/$/, '')}/app-auth`);
    url.searchParams.set('appId', projectId);
    url.searchParams.set('redirectUri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('responseType', 'code');
    return res.redirect(302, url.toString());
  }

  async function callback(req, res) {
    res.set('Cache-Control', 'no-store');
    const stored = parseCookies(req.get('cookie'))[NONCE_COOKIE];
    res.set('Set-Cookie', cookie(NONCE_COOKIE, '', 0, nonceOptions));
    if (!configured || typeof req.query.code !== 'string' || typeof req.query.state !== 'string' ||
      req.query.code.length > 2048 || req.query.state.length > 2048 || !stored || stored.length > 256) {
      return res.status(400).send('Login state is missing or invalid. Start sign-in again.');
    }
    let state;
    try { state = JSON.parse(Buffer.from(req.query.state, 'base64url').toString('utf8')); }
    catch { return res.status(400).send('Invalid login state.'); }
    const [nonce, signature] = stored.split('.');
    if (!state || typeof state !== 'object' || typeof state.nonce !== 'string' ||
      !nonce || !signature || !sameValue(signature, signNonce(nonce)) ||
      !sameValue(state.nonce, nonce) || state.redirectUri !== `${origin}/api/auth/callback` ||
      !Number.isFinite(state.issuedAt) || Date.now() - state.issuedAt > 300000 ||
      state.issuedAt > Date.now() + 30000 || (pendingNonces.get(nonce) || 0) <= Date.now()) {
      return res.status(400).send('Login state expired or did not match this browser.');
    }
    pendingNonces.delete(nonce);

    async function post(endpoint, data) {
      const response = await fetcher(`${env.MANUS_OAUTH_API_URL.replace(/\/$/, '')}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`OAuth service returned ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error('OAuth service rejected the request');
      return result;
    }

    try {
      const tokens = await post('webdev.v1.WebDevAuthPublicService/ExchangeToken', {
        clientId: projectId, grantType: 'authorization_code', code: req.query.code,
        redirectUri: state.redirectUri
      });
      if (typeof tokens.accessToken !== 'string') throw new Error('OAuth token missing');
      const identity = await post('webdev.v1.WebDevAuthPublicService/GetUserInfo', {
        accessToken: tokens.accessToken
      });
      const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
      if (!allowed.has(email) || !identity.openId) return res.status(403).send('This Manus account is not allowed to use chat.');
      const token = await new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(identity.openId)
        .setIssuer('abc-company-chat').setAudience(projectId)
        .setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(signingKey);
      res.append('Set-Cookie', cookie(SESSION_COOKIE, token, SESSION_SECONDS, cookieOptions));
      return res.redirect(303, '/#demo');
    } catch (error) {
      console.error('Manus login failed:', error.name);
      return res.status(502).send('Sign-in could not be completed. Retry or check the server configuration.');
    }
  }

  function logout(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
    res.set('Set-Cookie', cookie(SESSION_COOKIE, '', 0, cookieOptions));
    return res.json({ authenticated: false });
  }

  return { configured, origin, sameOrigin, session, start, callback, logout };
}

module.exports = { createAuth };
