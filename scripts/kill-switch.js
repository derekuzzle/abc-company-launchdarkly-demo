require('dotenv').config();

async function main() {
  const triggerUrl = process.env.LAUNCHDARKLY_TRIGGER_URL;
  if (!triggerUrl) {
    throw new Error('Set LAUNCHDARKLY_TRIGGER_URL in .env before running the kill switch.');
  }
  const url = new URL(triggerUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
    throw new Error('The trigger URL must use HTTPS.');
  }

  // This secret webhook was configured in LaunchDarkly to turn release-support-chat off.
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Trigger rejected the request (HTTP ${response.status}).`);
  console.log('Kill switch sent. Watch the flag status panel for the live change.');
}

if (require.main === module) {
  main().catch((error) => {
    // Never print a network error or URL containing the secret webhook path.
    console.error(error.message.startsWith('Trigger rejected') || error.message.startsWith('Set ') ||
      error.message.startsWith('The trigger URL') ? error.message : 'Kill switch request failed. Check network access and the trigger configuration.');
    process.exitCode = 1;
  });
}

module.exports = main;
