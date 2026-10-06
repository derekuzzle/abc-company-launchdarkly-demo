require('dotenv').config();

const express = require('express');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
const users = require('./users');
const { createFlagEvaluator } = require('./flag');

const publicDir = path.join(__dirname, 'public');
const browserSdkFile = path.join(__dirname, 'node_modules/@launchdarkly/js-client-sdk/dist/index.js');

function promptFrom(config) {
  const messages = Array.isArray(config?.messages) ? config.messages : [];
  return messages.map(({ role, content }) => `${role}: ${content}`).join('\n') || config?.instructions || 'No prompt configured';
}

function matchesPasscode(value, expected) {
  if (!expected) return true;
  if (typeof value !== 'string') return false;
  const supplied = createHash('sha256').update(value).digest();
  const configured = createHash('sha256').update(expected).digest();
  return timingSafeEqual(supplied, configured);
}

function createApp({ env = process.env, evaluateFlag, inspectAiConfig } = {}) {
  const app = express();
  const flag = evaluateFlag || createFlagEvaluator(env.LD_SDK_KEY);
  const aiConfigKey = env.LAUNCHDARKLY_AI_CONFIG_KEY || 'support-chat-assistant';
  const requests = new Map();
  let aiClientReady;

  function limitChat(req, res, next) {
    const now = Date.now();
    const ip = req.ip;
    let entry = requests.get(ip);
    if (!entry || entry.reset <= now) entry = { count: 0, reset: now + 15 * 60 * 1000 };
    requests.set(ip, entry);
    if (++entry.count > 20) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many chat requests. Try again later.' });
    }
    if (requests.size > 5000) for (const [key, value] of requests) if (value.reset <= now) requests.delete(key);
    next();
  }

  async function inspect(context) {
    if (inspectAiConfig) return inspectAiConfig(context);
    const { initClient, inspectConfig } = await import('@launchdarkly/ai-node');
    let timer;
    try {
      return await Promise.race([
        (async () => {
          if (flag.client) {
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
    // Only the browser-safe client-side ID and a passcode-required boolean are public.
    res.json({ clientSideId: env.LAUNCHDARKLY_CLIENT_SIDE_ID || '', passcodeRequired: Boolean(env.DEMO_PASSCODE), users });
  });
  app.get('/vendor/launchdarkly.js', (_req, res) => res.type('js').sendFile(browserSdkFile));

  app.post('/api/chat', limitChat, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!matchesPasscode(req.body?.passcode, env.DEMO_PASSCODE)) {
      return res.status(401).json({ error: 'Incorrect demo passcode.' });
    }
    if (env.DEMO_PASSCODE) res.set('X-Demo-Passcode-Accepted', 'true');
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const context = users.find((user) => user.key === req.body?.userKey);
    if (!context || !message || message.length > 500) {
      return res.status(400).json({ error: 'Choose a sample user and enter 1 to 500 characters.' });
    }
    try {
      // Server-side variation uses the selected demo context, independently of the browser.
      if (!await flag(context)) return res.status(403).json({ error: 'Chat is off for this selected visitor.' });
    } catch (error) {
      console.error('LaunchDarkly flag evaluation unavailable:', error.name);
      return res.status(503).json({ error: 'Chat is unavailable until the server can verify the release flag.' });
    }

    const details = { configKey: aiConfigKey, variation: 'not evaluated', model: 'not selected',
      prompt: 'No live AI Config prompt was served' };
    const cannedReply = `Sample support reply: Thanks for reaching out, ${context.name}. Our team is here to help you move forward.`;
    if (!env.OPENAI_API_KEY) {
      return res.json({ mode: 'CANNED RESPONSE', reply: cannedReply, reason: 'OpenAI key not set', ...details });
    }

    let inspected = null;
    try { inspected = await inspect(context); }
    catch (error) { console.error('AI Config inspection unavailable:', error.name); }
    if (!inspected?.enabled || !inspected.config) {
      return res.json({ mode: 'CANNED RESPONSE', reply: cannedReply,
        reason: 'AI Config unavailable or targeting off', ...details });
    }
    details.variation = inspected.meta?.variationKey || 'unnamed variation';
    details.model = inspected.config.model?.name || 'not selected';
    details.prompt = promptFrom(inspected.config);
    try {
      const { openaiMessages } = await import('@launchdarkly/ai-openai-messages');
      // The AI SDK selects the model and prompt from AgentControl and records usage.
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
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '0.0.0.0', () => console.log(`ABC Company demo listening on ${port}`));
}
module.exports = { createApp };
