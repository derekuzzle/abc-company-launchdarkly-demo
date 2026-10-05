# ABC Company: LaunchDarkly support chat demo

A small sample app for a prospective customer and a live Solutions Engineer walkthrough. A single Express-served landing page demonstrates a reversible chat release, instant flag updates, individual and attribute targeting, and an optional AgentControl AI Config. The browser is plain JavaScript. There is no frontend framework or build step.

## What to create in LaunchDarkly

| Resource | Exact key or name | Purpose |
| --- | --- | --- |
| Boolean feature flag | `release-support-chat` | Controls whether the chat widget is visible. This is the **only ordinary feature flag**. |
| Generic flag trigger | `Turn off release-support-chat` | Configured on that flag in the same environment with action **turn flag off**. Its unique URL goes only in `.env`. |
| Completion-mode AgentControl config | `support-chat-assistant` | Selects the OpenAI model and system prompt for the chat endpoint. Add `concise-support` and `guided-support` variations. |

You need a LaunchDarkly project and environment, ideally the `test` environment shown in your account. All IDs, keys, flag targeting, trigger, and AI Config targeting must refer to **that same environment**. A new account advertises a 14-day trial, but trigger and AgentControl access are plan or entitlement dependent. If either menu is unavailable, the normal flag demo still works; see the manual remediation and canned AI modes below. Do not assume the trial guarantees every add-on.

### Prerequisites and assumptions

- Node.js **18 or newer** and npm. Node 22 is recommended for the current beta AI SDK.
- Permission to create flags and, if available, flag triggers and AgentControl configs in your LaunchDarkly project.
- An OpenAI API key only if you want live generated replies. Without it, the endpoint returns an explicitly labeled canned response.
- A browser that can reach LaunchDarkly. Ad blockers or network policy may block the browser SDK. The sample contexts are illustrative and are not an authentication mechanism.
- This app does not create LaunchDarkly resources for you. Use the dashboard steps below and put credentials only into your untracked local `.env` file or a secret manager.

### 1. Create the flag and get the client-side ID

1. In LaunchDarkly, select your project and the intended environment, such as `test`. Go to **Create > Flag**. Name it `Release support chat` and set its **Key** to exactly `release-support-chat`. Choose the **Release** template with **Boolean** variations: `true` is on and `false` is off. Leave the flag off initially and make the default on and off variation `false` for the targeting walkthrough.
2. During creation, check **SDKs using client-side ID**. If you already created the flag, open the flag's **Settings** page and turn on client-side SDK availability there. Without this, the browser only gets the fallback `false` value. See [creating flags](https://launchdarkly.com/docs/home/flags/new).
3. Follow the quick SDK-key setup below to supply both credentials from the **same** environment.

### SDK keys: quick setup

In LaunchDarkly, select your project, then **Project settings > Environments > [your environment's three-dot menu] > Show SDK keys**. Copy its **Client-side ID** to `LAUNCHDARKLY_CLIENT_SIDE_ID` and its **SDK key** to `LD_SDK_KEY` in your untracked `.env` file. The client-side ID is browser-safe and powers `release-support-chat`; the SDK key starts with `sdk-`, must stay private, and is used only by the server for `support-chat-assistant`. Use credentials from the **same environment** as the flag and AI Config targeting. For a hosted deployment, set both names as runtime environment variables in the host's secret/settings UI, rather than committing `.env`. Restart the server after changes. The flag also needs **SDKs using client-side ID** enabled. See [LaunchDarkly's key locations](https://launchdarkly.com/docs/home/account/environment/keys).

### 2. Set local environment and run

```sh
cp .env.example .env
# Edit .env with your own values; keep it out of Git.
npm install
npm start
```

Open `http://localhost:3000`. `PORT` is optional. To run against your account, at minimum fill in `LAUNCHDARKLY_CLIENT_SIDE_ID`; `LD_SDK_KEY`, `OPENAI_API_KEY`, and `LAUNCHDARKLY_TRIGGER_URL` are needed only for their respective extra flows. `LAUNCHDARKLY_AI_CONFIG_KEY` defaults to `support-chat-assistant`. Existing process environment values take precedence over `.env`, so deployment secret managers and host-assigned ports work even if a local `.env` contains blanks. With no credentials in either place, the page starts and displays an honest not-configured state. `GET /health` returns `{ "status": "ok" }`.

The installed `@launchdarkly/js-client-sdk` browser bundle is served locally at `/vendor/launchdarkly.js`. Its public `createClient`, `start`, `waitForInitialization`, `variation`, and `identify` calls are used in `public/app.js`. The server-side AI SDK is used only inside `server.js`; private credentials never appear in `/api/config`.

### 3. Demo Part 1: release and remediate

1. On the flag's **Targeting** tab in your selected environment, turn the flag **On** and set the **default rule** to serve `true`. Click **Review and save**. The chat appears and the status panel logs the new value without a page reload.
2. Turn the flag **Off** in LaunchDarkly, then review and save. The chat disappears and the panel logs a timestamped change. The browser client subscribes to `change:release-support-chat`, which opens the live stream; no refresh is needed. When disconnected, the page labels the status as unavailable instead of claiming a successful evaluation.
3. If your account supports flag triggers, open that flag's environment overflow menu (**three dots**) and choose **Configuration in environment**. In **Triggers**, click **+ Add trigger**. Select **Generic trigger**, choose the action **turn flag off**, and save. **Copy the unique trigger URL immediately**, since LaunchDarkly obscures it later. Put it in `LAUNCHDARKLY_TRIGGER_URL` in `.env`. See [creating flag triggers](https://launchdarkly.com/docs/home/releases/triggers-create).
4. Set the flag On again. To trigger the kill switch, run `npm run kill-switch`. The command makes a POST to the saved URL, reports success or a safe error, and does not print the secret URL. Alternatively, paste the URL into this ready-to-edit command:

```sh
curl -i -X POST 'PASTE_YOUR_UNIQUE_TRIGGER_URL_HERE'
```

Treat the trigger URL like a secret, including in terminal history. A trigger cannot be used until LaunchDarkly grants access and it has been created. If **Triggers** is missing, use the manual **Off** toggle for the panel demo and explain the entitlement limitation. Do not confuse a **flag trigger** (an inbound kill switch) with an ordinary LaunchDarkly webhook (an outbound notification).

### 4. Demo Part 2: target the audience

The page's **Viewing as** control calls `identify` with one of five `kind: user` contexts, then re-evaluates the flag without a reload. Its inspector displays each attribute. Use these exact keys in the dashboard, not the human-readable name:

| Name | Key | Email | Plan | Region | Role | betaTester |
| --- | --- | --- | --- | --- | --- | --- |
| Alex Rivera | `alex-free` | alex@example.com | free | us | member | false |
| Maya Chen | `maya-pro` | maya@example.com | pro | eu | admin | true |
| Jordan Lee | `jordan-enterprise` | jordan@example.com | enterprise | us | admin | false |
| Sam Patel | `sam-free-beta` | sam@example.com | free | eu | member | true |
| Taylor Brooks | `taylor-pro` | taylor@example.com | pro | us | member | false |

**Individual targeting:** Turn the flag On, but set its default rule to `false`. On **Targeting**, click **+ > Target individuals** (if hidden, click **View targeting rules**). Search for or create a `user` context with exact key `alex-free`; select the `true` variation, then **Review and save**. Switch between Alex and Taylor. Alex sees chat; Taylor does not. Remove this individual target before checking only the rule examples. See [individual targeting](https://launchdarkly.com/docs/home/flags/individual-targeting).

**Rule targeting:** With the flag still On and default `false`, click **+ > Build a custom rule** on its Targeting tab. For the first rule choose context kind `user`, attribute `plan`, operator `is one of`, value `enterprise`, and serve `true`. Review and save. Add a second custom rule with kind `user`, attribute `betaTester`, operator `is one of`, value boolean `true` (not the string `"true"`), and serve `true`. Review and save. If the UI does not list a custom attribute yet, switch to a context in the app once or enter its name manually. Jordan, Maya, and Sam should see chat; Alex and Taylor should not. LaunchDarkly evaluates individual targets before custom rules, then rules top to bottom, then the default. A globally Off flag overrides all these rules. See [targeting rules](https://launchdarkly.com/docs/home/flags/target-rules).

### 5. Extra credit: AI Config and two variations

If AgentControl is enabled in your account:

1. In the left sidebar select **Agents > Configs**, create a **Completion** config named `Support chat assistant`, click **Edit key**, and set the immutable key to exactly `support-chat-assistant`. If you chose another key, change `LAUNCHDARKLY_AI_CONFIG_KEY` in `.env`. See [create configs](https://launchdarkly.com/docs/home/agentcontrol/create).
2. On **Variations**, add a variation named `concise-support`. Select provider **OpenAI** and model `gpt-4o-mini` (or an OpenAI model your key can use). Add a **system** message: `You are ABC Company's helpful support assistant. Answer in two concise sentences. If you do not know, say so and suggest contacting the team.` Save it.
3. Add a second variation named `guided-support`, provider **OpenAI**, model `gpt-4o` (or another OpenAI model your key can use). Add a **system** message: `You are ABC Company's helpful support assistant. Give clear, practical steps, then ask one useful follow-up question. Do not invent account-specific details.` Click **Review and save**. Do not add tools or judges for this sample. See [create variations](https://launchdarkly.com/docs/home/agentcontrol/create-variation).
4. On the config's **Targeting** tab, select the same environment as the SDK key. Set the default rule to `concise-support`; add a custom rule for `user` / `plan` / `is one of` / `enterprise` that serves `guided-support`. Review and save. Targeting is on by default. See [config targeting](https://launchdarkly.com/docs/home/agentcontrol/target).
5. Put the server-side SDK key in `LD_SDK_KEY` and your provider key in `OPENAI_API_KEY`. Restart `npm start` after editing `.env`. Turn `release-support-chat` On for the chosen user, open chat, and send a message. Each reply lists **mode, config key, actual variation key, selected model, and prompt template**. Switch to Jordan and compare. The AI SDK handles the provider call and AI metrics. The app does not expose an OpenAI key to the browser.

If `OPENAI_API_KEY` is empty, replies show `CANNED RESPONSE` and a reason. If the AI Config is reachable, the reply still shows its resolved model, variation, and prompt; otherwise those fields explicitly say not evaluated. If a live provider request fails, the endpoint returns a clear error rather than silently passing a canned reply off as AI. The current Node AI SDK is in [open beta](https://launchdarkly.com/docs/sdk/ai/node-js), so the exact pinned package versions are intentional. The prompt field shows the served template; the visitor's message is sent separately as user input.

## Design and code map

`server.js` serves static assets, a browser-safe config endpoint, health check, and the chat API. `users.js` is the canonical list of five allowed demo contexts for both the page and server. `public/app.js` handles SDK lifecycle, live flag changes, `identify`, the activity log, and chat. `scripts/kill-switch.js` sends the secret trigger request. This is a demo, not an identity system: the user dropdown is for demonstration and must not be used as a production authorization boundary.

## Troubleshooting and clean-install check

- **Widget stays hidden:** Confirm the flag key, environment, client-side ID, flag targeting On, client-side SDK availability, and the selected context's rule. Inspect the on-page status. A fallback `false` is not proof that the flag is off in LaunchDarkly.
- **Switching users does not change the result:** Confirm the flag is globally On, the default and individual targets do not override your custom rules, attribute type for `betaTester` is boolean, and the server and browser target the same environment.
- **Trigger command fails:** Verify trigger access, copied URL, action `turn flag off`, and `.env`. The script never prints the URL. A manual dashboard Off toggle is still valid for the release demonstration.
- **AI returns canned:** Check whether the response says no provider key or unavailable AI Config. Both are intentional fallback modes. Check config key, server SDK key, targeting, model/provider compatibility, and OpenAI key for a live reply.

A fresh-clone reproduction, from the repository root, should work with only these steps:

```sh
cp .env.example .env
# Fill the client-side ID for the flag demo; other values are optional for basic startup.
npm install
npm start
```

In a second terminal, try `curl -f http://localhost:3000/health` and open the page. Run `npm test` for self-contained smoke tests. No account keys are committed. The app can be run locally without LaunchDarkly or OpenAI values, but live account behavior cannot be verified until the account is configured.

## GitHub checks and deployment readiness

Source: [derekuzzle/abc-company-launchdarkly-demo](https://github.com/derekuzzle/abc-company-launchdarkly-demo). `.github/workflows/ci.yml` runs `npm ci`, `npm test`, JavaScript syntax checks, and a production-dependency audit on pushes to `main` and pull requests using Node 18 and 22. CI needs **no** LaunchDarkly or provider secrets and cannot prove live account integration. GitHub holds the source, not a deployed website; passing CI does not publish the app.

Before a live LaunchDarkly demo, set the two SDK credentials, create and expose the boolean flag to client-side SDKs, test On/Off streaming without reload, exercise the five sample contexts and rules, and test the trigger if your plan supports it. If demonstrating live AI, also configure `support-chat-assistant`, a provider key, and both variations, then verify a reply for a free and an enterprise context. Confirm these against the **deployed runtime**, not just a local `.env`.

**Public production use requires additional controls.** This is a demo, not an authorization system. `/api/chat` accepts a caller-supplied sample user key and does not enforce `release-support-chat` on the server, authenticate visitors, or rate-limit provider calls. Hiding the widget with a client-side flag is not a security boundary. Add server-side enforcement, authentication and request limits before offering unrestricted public chat with a billable OpenAI key. Never commit SDK keys, provider keys, or trigger URLs.

## Documentation verified for this sample

The implementation follows the current [browser JavaScript SDK](https://launchdarkly.com/docs/sdk/client-side/javascript) and its [v4 migration guide](https://launchdarkly.com/docs/sdk/client-side/javascript/migration-3-to-4), the [Node AI SDK reference](https://launchdarkly.com/docs/sdk/ai/node-js), and [flag trigger creation](https://launchdarkly.com/docs/home/releases/triggers-create). The browser SDK is pinned at 4.11.0, the Node AI SDK at 0.2.0, and the OpenAI messages handler at 0.3.0 in `package.json` and `package-lock.json`.
