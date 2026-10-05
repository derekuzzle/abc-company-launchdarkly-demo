const LaunchDarkly = require('@launchdarkly/node-server-sdk');

const FLAG_KEY = 'release-support-chat';

function createFlagEvaluator(sdkKey, options = {}) {
  if (!sdkKey) return async () => { throw new Error('LaunchDarkly server SDK key is not configured'); };
  // Keep one server-side SDK client for the process. Never create one per chat request.
  const client = LaunchDarkly.init(sdkKey, options);
  let ready = false;
  const evaluate = async (context) => {
    if (!ready) {
      await client.waitForInitialization({ timeout: 3 });
      ready = true;
    }
    // The fallback is false. If the flag is off, not targeted, or missing, no AI runs.
    return (await client.variation(FLAG_KEY, context, false)) === true;
  };
  evaluate.client = client;
  evaluate.close = () => client.close();
  return evaluate;
}

module.exports = { createFlagEvaluator, FLAG_KEY };
