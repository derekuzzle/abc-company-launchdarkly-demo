require('dotenv').config();

const express = require('express');
const path = require('node:path');
const users = require('./users');
const { createAuth } = require('./auth');
const { createFlagEvaluator } = require('./flag');
const { createLimiter, createConcurrencyLimit } = require('./limits');

const publicDir = path.join(__dirname, 'public');
const browserSdkFile = path.join(__dirname, 'node_modules/@launchdarkly/js-client-sdk/dist/index.js');

function promptFrom(config) {
  const messages = Array.isArray(config?.messages) ? config.messages : [];
  return messages.map(({ role, content }) => `${role}: ${content}`).join('\n') || config?.instructions || 'No prompt configured';
}

function createApp({ env = process.env, fetcher = fetch, evaluateFlag, inspectAiConfig } = {}) {
  const app = express();
  const auth = createAuth(env, fetcher);
  const flag = evaluateFlag || createFlagEvaluator(env.LD_SDK_KEY);
  const aiConfigKey = env.LAUNCHDARKLY_AI_CONFIG_KEY || 'support-chat-assistant';
  const chatIpLimit = createLimiter({ limit: 60, windowMs: 15 * 60 * 1000 });
  const chatUserLimit = createLimiter({ limit: 12, windowMs: 15 * 60 * 1000 });
  const loginLimit = createLimiter({ limit: 12, windowMs: 15 * 60 * 1000 });
  const concurrent = createConcurrencyLimit(2);
  let aiClientReady;

  async function inspect(context) {
    if (inspectAiConfig) return inspectAiConfig(context);
    if (!env.LD_SDK_KEY) return null;
    const { initClient, inspectConfig } = await import('@launchdarkly/ai-node');
    let timer;
    try {
      return await Promise.race([
        (async () => {
          if (flag.client) {
            // The AI SDK shares the server flag client and its chosen environment.
            aiClientReady ||= initClient(flag.client).catch((error) => {
              aiClientReady = null;
              throw error;
            });
            await aiClientReady;
          }
          return inspectConfig(aiConfigKey, context);
        })(),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); })
      ]);
    } finally { clearTimeout(timer); }
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    // Only the public client-side ID belongs in the browser. Never expose LD_SDK_KEY.
    res.json({ clientSideId: env.LAUNCHDARKLY_CLIENT_SIDE_ID || '', users });
  });
  app.get('/vendor/launchdarkly.js', (_req, res) => res.type('js').sendFile(browserSdkFile));

  app.get('/api/auth/session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const identity = await auth.session(req);
    res.json({ configured: auth.configured, authenticated: Boolean(identity), email: identity?.email || null });
  });
  app.get('/api/auth/start', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!loginLimit(req.socket.remoteAddress || 'unknown', res)) return;
    try { await auth.start(req, res); } catch (error) { next(error); }
  });
  app.get('/api/auth/callback', async (req, res, next) => {
    try { await auth.callback(req, res); } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', (req, res) => auth.logout(req, res));

  app.post('/api/chat', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!chatIpLimit(req.socket.remoteAddress || 'unknown', res)) return;
    if (!auth.configured) return res.status(503).json({ error: 'Chat access is not configured.' });
    if (!auth.sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
    const identity = await auth.session(req);
    if (!identity) return res.status(401).json({ error: 'Sign in with an allowed Manus account to use chat.' });
    if (!chatUserLimit(identity.email, res)) return;

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const context = users.find((user) => user.key === req.body?.userKey);
    if (!context || !message || message.length > 500) {
      return res.status(400).json({ error: 'Choose a sample user and enter 1 to 500 characters.' });
    }
    if (env.CHAT_EMERGENCY_OFF === 'true') {
      return res.status(403).json({ error: 'Chat is disabled by the server emergency switch.' });
    }
    if (!concurrent.acquire(identity.email, res)) return;
    try {
      let enabled;
      try { enabled = await flag(context); }
      catch (error) {
        console.error('LaunchDarkly flag evaluation unavailable:', error.name);
        return res.status(503).json({ error: 'Chat is unavailable until the server can verify the release flag.' });
      }
      if (!enabled) return res.status(403).json({ error: 'Chat is off for this selected visitor.' });

      let inspected = null;
      try { inspected = await inspect(context); }
      catch (error) { console.error('AI Config inspection unavailable:', error.name); }
      try { enabled = await flag(context); }
      catch (error) {
        console.error('LaunchDarkly flag recheck unavailable:', error.name);
        return res.status(503).json({ error: 'Chat is unavailable until the server can verify the release flag.' });
      }
      if (!enabled) return res.status(403).json({ error: 'Chat was switched off before this reply.' });
      const aiReady = Boolean(inspected?.enabled && inspected.config);
      const details = {
        configKey: aiConfigKey,
        variation: aiReady ? (inspected.meta?.variationKey || 'unnamed variation') : 'not evaluated',
        model: aiReady ? (inspected.config.model?.name || 'not selected') : 'not selected',
        prompt: aiReady ? promptFrom(inspected.config) : 'No live AI Config prompt was served'
      };
      if (!env.OPENAI_API_KEY || !aiReady) {
        const reason = !env.OPENAI_API_KEY ? 'OpenAI key not set' : 'AI Config unavailable or targeting off';
        return res.json({ mode: 'CANNED RESPONSE',
          reply: `Sample support reply: Thanks for reaching out, ${context.name}. Our team is here to help you move forward.`,
          reason, ...details });
      }

      try {
        const { openaiMessages } = await import('@launchdarkly/ai-openai-messages');
        // The AI SDK evaluates its config, chooses the provider model/prompt, and tracks usage.
        const result = await openaiMessages(aiConfigKey, message, context, { variables: { user_input: message } });
        const variation = result.trackData?.variationKey || details.variation;
        const prompt = variation === details.variation ? details.prompt :
          'Variation changed during this reply; inspect its current prompt in LaunchDarkly.';
        return res.json({ mode: 'LIVE AI CONFIG', reply: result.response, ...details,
          variation, model: result.trackData?.modelName || details.model, prompt });
      } catch (error) {
        console.error('AI request failed:', error.name);
        return res.status(502).json({ error: 'The live AI request failed. Check your AI Config, model access, and server logs.' });
      }
    } finally { concurrent.release(identity.email); }
  });
  return app;
}

const app = createApp();
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => console.log(`ABC Company demo listening on ${port}`));
}
module.exports = app;
module.exports.createApp = createApp;
