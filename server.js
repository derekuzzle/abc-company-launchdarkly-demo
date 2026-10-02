require('dotenv').config();

const express = require('express');
const path = require('path');
const users = require('./users');

const app = express();
const publicDir = path.join(__dirname, 'public');
const aiConfigKey = process.env.LAUNCHDARKLY_AI_CONFIG_KEY || 'support-chat-assistant';
const browserSdkFile = path.join(__dirname, 'node_modules/@launchdarkly/js-client-sdk/dist/index.js');

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use(express.static(publicDir));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  // Only this public client-side ID belongs in the browser. Never expose LD_SDK_KEY.
  res.json({ clientSideId: process.env.LAUNCHDARKLY_CLIENT_SIDE_ID || '', users });
});

// Serve the installed browser SDK locally, without a CDN or frontend build step.
app.get('/vendor/launchdarkly.js', (_req, res) => res.type('js').sendFile(browserSdkFile));

function promptFrom(config) {
  const messages = Array.isArray(config?.messages) ? config.messages : [];
  return messages.map(({ role, content }) => `${role}: ${content}`).join('\n') || config?.instructions || 'No prompt configured';
}

async function inspectAiConfig(context) {
  if (!process.env.LD_SDK_KEY) return null;
  const { inspectConfig } = await import('@launchdarkly/ai-node');
  // inspectConfig evaluates this AI Config for the chosen context without calling a model.
  let timer;
  try {
    return await Promise.race([
      inspectConfig(aiConfigKey, context),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/chat', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const context = users.find((user) => user.key === req.body?.userKey);
  if (!context || !message || message.length > 500) {
    return res.status(400).json({ error: 'Choose a sample user and enter 1 to 500 characters.' });
  }

  let inspected = null;
  try {
    inspected = await inspectAiConfig(context);
  } catch (error) {
    console.error('AI Config inspection unavailable:', error.name);
  }

  const aiReady = Boolean(inspected?.enabled && inspected.config);
  const details = {
    configKey: aiConfigKey,
    variation: aiReady ? (inspected.meta?.variationKey || 'unnamed variation') : 'not evaluated',
    model: aiReady ? inspected.config.model.name : 'not selected',
    prompt: aiReady ? promptFrom(inspected.config) : 'No live AI Config prompt was served'
  };

  if (!process.env.OPENAI_API_KEY || !aiReady) {
    const reason = !process.env.OPENAI_API_KEY ? 'OpenAI key not set' : 'AI Config unavailable or targeting off';
    return res.json({
      mode: 'CANNED RESPONSE',
      reply: `Sample support reply: Thanks for reaching out, ${context.name}. Our team is here to help you move forward.`,
      reason,
      ...details
    });
  }

  try {
    const { openaiMessages } = await import('@launchdarkly/ai-openai-messages');
    // openaiMessages evaluates the AI Config, selects its OpenAI model and prompt,
    // calls the provider, and records LaunchDarkly AI metrics for this context.
    const result = await openaiMessages(aiConfigKey, message, context, { variables: { user_input: message } });
    const variation = result.trackData?.variationKey || details.variation;
    const prompt = variation === details.variation
      ? details.prompt
      : 'Variation changed during this reply; inspect its current prompt in LaunchDarkly.';
    return res.json({ mode: 'LIVE AI CONFIG', reply: result.response, ...details,
      variation, model: result.trackData?.modelName || details.model, prompt });
  } catch (error) {
    console.error('AI request failed:', error.name);
    return res.status(502).json({ error: 'The live AI request failed. Check your AI Config, model access, and server logs.' });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => console.log(`ABC Company demo listening on ${port}`));
}

module.exports = app;
