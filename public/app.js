import { createClient } from '/vendor/launchdarkly.js';

const flagKey = 'release-support-chat'; // Re-create this exact boolean flag in LaunchDarkly.
const $ = (id) => document.getElementById(id);
const userSelect = $('user-select');
const chatWidget = $('chat-widget');
const chatOff = $('chat-off');
let users = [];
let activeUser;
let client;
let switchNumber = 0;
let passcodeRequired = false;
let passcode = '';
let passcodeAccepted = false;

function logEvent(text, tone = 'neutral') {
  const item = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const message = document.createElement('span');
  message.textContent = text;
  item.className = tone;
  item.append(time, message);
  $('event-log').prepend(item);
  while ($('event-log').children.length > 5) $('event-log').lastElementChild.remove();
}

function displayContext(user) {
  activeUser = user;
  $('context-details').replaceChildren();
  for (const field of ['key', 'name', 'email', 'plan', 'region', 'role', 'betaTester']) {
    const group = document.createElement('div');
    const label = document.createElement('dt');
    const value = document.createElement('dd');
    label.textContent = field;
    value.textContent = String(user[field]);
    group.append(label, value);
    $('context-details').append(group);
  }
  $('context-feedback').textContent = `Context: ${user.name}`;
}

function setFlag(value, reason) {
  const enabled = value === true;
  chatWidget.hidden = !enabled;
  chatOff.hidden = enabled;
  $('connection-chip').classList.toggle('inactive', value === null);
  $('connection-label').textContent = value === null
    ? (reason.startsWith('Re-evaluating') ? 'UPDATING' : 'NOT CONNECTED') : 'LIVE SIGNAL';
  $('flag-value').textContent = value === null ? reason : enabled ? 'ON · Widget visible' : 'OFF · Widget hidden';
  $('flag-indicator').textContent = enabled ? '✳' : '○';
  $('flag-indicator').classList.toggle('is-on', enabled);
  $('chat-off-reason').textContent = value === null
    ? reason
    : 'The chat opens when this visitor is included in the release.';
  logEvent(value === null ? reason : `${reason}: ${enabled ? 'on' : 'off'}`, enabled ? 'positive' : 'neutral');
}

function renderFlag(reason) {
  // variation evaluates the current browser context and returns false if the flag is unavailable.
  setFlag(client.variation(flagKey, false), reason);
}

async function switchUser() {
  const selected = users.find((user) => user.key === userSelect.value);
  if (!selected) return;
  const currentSwitch = ++switchNumber;
  displayContext(selected);
  $('reply-meta').hidden = true;
  if (!client) return;
  setFlag(null, 'Re-evaluating for this visitor...');
  // identify sends the selected context to LaunchDarkly and refreshes its flag values.
  const result = await client.identify(selected, { timeout: 5 });
  if (currentSwitch !== switchNumber) return;
  if (result.status === 'completed') renderFlag(`Identified ${selected.name}`);
  else setFlag(null, `Could not identify ${selected.name} (${result.status})`);
}

function addMessage(text, who) {
  const bubble = document.createElement('div');
  bubble.className = `message ${who}`;
  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = who === 'assistant' ? 'ABC SUPPORT' : 'YOU';
  const body = document.createElement('p');
  body.textContent = text;
  bubble.append(label, body);
  $('messages').append(bubble);
  $('messages').scrollTop = $('messages').scrollHeight;
  return body;
}

$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('chat-input');
  const message = input.value.trim();
  const suppliedPasscode = passcodeRequired && !passcodeAccepted ? $('demo-passcode').value : passcode;
  if (!message || !activeUser) return;
  if (passcodeRequired && !suppliedPasscode) {
    $('demo-passcode').focus();
    return;
  }
  addMessage(message, 'visitor');
  input.value = '';
  input.disabled = true;
  $('send-button').disabled = true;
  const reply = addMessage('Thinking...', 'assistant');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, userKey: activeUser.key, passcode: suppliedPasscode })
    });
    if (passcodeRequired && response.headers.get('X-Demo-Passcode-Accepted') === 'true') {
      passcode = suppliedPasscode;
      passcodeAccepted = true;
      $('demo-passcode').value = '';
      $('demo-passcode').required = false;
      $('passcode-field').hidden = true;
    }
    const data = await response.json();
    if (response.status === 401 && passcodeRequired) {
      passcode = '';
      passcodeAccepted = false;
      $('demo-passcode').value = '';
      $('passcode-field').hidden = false;
      $('demo-passcode').required = true;
    }
    if (response.status === 403 && data.error?.includes('Chat is off')) setFlag(false, 'Server flag check');
    if (!response.ok) throw new Error(data.error || 'Unable to send your message.');
    reply.textContent = data.reply;
    $('reply-meta').hidden = false;
    for (const field of ['mode', 'config', 'variation', 'model', 'prompt']) {
      $(field === 'config' ? 'meta-config' : `meta-${field}`).textContent = field === 'config' ? data.configKey : data[field];
    }
    $('meta-mode').textContent = data.reason ? `${data.mode} (${data.reason})` : data.mode;
  } catch (error) {
    reply.textContent = error.message;
  } finally {
    input.disabled = false;
    $('send-button').disabled = false;
    (passcodeRequired && !passcodeAccepted ? $('demo-passcode') : input).focus();
  }
});

async function start() {
  $('year').textContent = new Date().getFullYear();
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Could not load app configuration.');
    const config = await response.json();
    passcodeRequired = config.passcodeRequired;
    $('passcode-field').hidden = !passcodeRequired;
    $('demo-passcode').required = passcodeRequired;
    users = config.users;
    for (const user of users) userSelect.add(new Option(`${user.name} · ${user.plan}${user.betaTester ? ' · beta' : ''}`, user.key));
    displayContext(users[0]);
    userSelect.addEventListener('change', switchUser);
    if (!config.clientSideId) {
      setFlag(null, 'Not configured. Add a client-side ID to .env.');
      return;
    }
    // createClient creates one browser client for this LaunchDarkly environment and visitor.
    client = createClient(config.clientSideId, activeUser, { fetchGoals: false });
    // Register before start: this event opens streaming and re-renders the flag without a reload.
    client.on(`change:${flagKey}`, () => renderFlag('Live flag change'));
    // start connects the SDK; the timeout prevents an unreachable service from blocking the UI.
    void client.start();
    const result = await client.waitForInitialization({ timeout: 5 });
    if (result.status === 'complete') renderFlag('Initial evaluation');
    else setFlag(null, `LaunchDarkly connection ${result.status}. Check your client-side ID.`);
  } catch (error) {
    setFlag(null, `Unable to start the demo: ${error.message}`);
  }
}

start();
