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
- A server-side SDK key (`LD_SDK_KEY`) for **every** chat request. If the server cannot evaluate the release flag, it denies chat, including canned replies. An OpenAI API key is needed only for live generated replies after authorization.
- A Manus account whose email you explicitly allow in `CHAT_ALLOWED_EMAILS`, plus `APP_PUBLIC_ORIGIN` and a strong `APP_SESSION_SECRET` for chat login. Managed Manus Preview and published runtimes supply the Manus OAuth platform variables; a plain GitHub clone outside Manus needs an equivalent supported OAuth runtime before chat login can work.
- A browser that can reach LaunchDarkly. Ad blockers or network policy may block the browser SDK. The sample contexts are illustrative flag-targeting choices, **not** authentication identities.
- This app does not create LaunchDarkly resources for you. Use the dashboard steps below and put credentials only into your untracked local `.env` file or a secret manager.

### 1. Create the flag and get the client-side ID

1. In LaunchDarkly, select your project and the intended environment, such as `test`. Go to **Create > Flag**. Name it `Release support chat` and set its **Key** to exactly `release-support-chat`. Choose the **Release** template with **Boolean** variations: `true` is on and `false` is off. Leave the flag off initially and make the default on and off variation `false` for the targeting walkthrough.
2. During creation, check **SDKs using client-side ID**. If you already created the flag, open the flag's **Settings** page and turn on client-side SDK availability there. Without this, the browser only gets the fallback `false` value. See [creating flags](https://launchdarkly.com/docs/home/flags/new).
3. Follow the quick SDK-key setup below to supply both credentials from the **same** environment.

### SDK keys: quick setup

In LaunchDarkly, click the **gear icon > Organization settings > Security > SDK keys**, then select the right project and environment. Copy its **Client-side ID** to `LAUNCHDARKLY_CLIENT_SIDE_ID` and its **SDK key** (reveal with the eye icon) to `LD_SDK_KEY` in your untracked `.env` file. The client-side ID is browser-safe and controls the widget. The private key starts with `sdk-` and is used by the server for **both** `release-support-chat` enforcement and `support-chat-assistant`. Use credentials from the **same environment** as flag and AI Config targeting. For hosted deployment, set the values in protected runtime environment settings instead of committing `.env`. Restart after changes. The flag also needs **SDKs using client-side ID** enabled. See [LaunchDarkly's SDK key instructions](https://launchdarkly.com/docs/home/account/environment/keys).

### 2. Set local environment and run

```sh
cp .env.example .env
# Edit .env with your own values; keep it out of Git.
npm install
npm start
```

Open `http://localhost:3000`. `PORT` is optional. The public page starts with no credentials, but chat **fails closed** until `LAUNCHDARKLY_CLIENT_SIDE_ID`, `LD_SDK_KEY`, `APP_PUBLIC_ORIGIN`, `CHAT_ALLOWED_EMAILS`, and `APP_SESSION_SECRET` are configured, along with platform-provided Manus OAuth variables. A plain local clone does not automatically receive Manus OAuth variables, so it can serve the page and run tests but cannot sign visitors in without a supported Manus runtime. `OPENAI_API_KEY` and `LAUNCHDARKLY_TRIGGER_URL` are optional for their respective demos. `LAUNCHDARKLY_AI_CONFIG_KEY` defaults to `support-chat-assistant`. Existing process values take precedence over `.env`. `GET /health` returns `{ "status": "ok" }`.

The installed `@launchdarkly/js-client-sdk` browser bundle is served at `/vendor/launchdarkly.js`. Its public `createClient`, `start`, `waitForInitialization`, `variation`, and `identify` calls are used in `public/app.js`. A separate server-side LaunchDarkly SDK independently enforces the same flag for each selected sample context before the AI SDK can make a provider call. Private keys never appear in `/api/config`.

### 3. Demo Part 1: release and remediate

1. On the flag's **Targeting** tab in your selected environment, turn the flag **On** and set the **default rule** to serve `true`. Click **Review and save**. The chat widget appears and the status panel logs the new value without a page reload. To actually send a message, sign in with an allowlisted Manus account in the widget; the server independently checks the same flag again.
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
5. Put the server-side SDK key in `LD_SDK_KEY` and your provider key in `OPENAI_API_KEY`. Set the Manus access variables as described below and restart `npm start` after editing `.env`. Turn `release-support-chat` On for the chosen user, sign in, and send a message. Each reply lists **mode, config key, actual variation key, selected model, and prompt template**. Switch to Jordan and compare. The AI SDK handles the provider call and AI metrics. The app does not expose an OpenAI key to the browser.

If `OPENAI_API_KEY` is empty, **authenticated, targeted** replies show `CANNED RESPONSE` and a reason. A missing server SDK key, unavailable flag evaluation, or off variation never returns a canned reply. If the AI Config is reachable, the reply still shows its resolved model, variation, and prompt; otherwise those fields say not evaluated. If a live provider request fails, the endpoint returns a clear error rather than silently passing a canned reply off as AI. The Node AI SDK is in [open beta](https://launchdarkly.com/docs/sdk/ai/node-js); its pinned versions are intentional. The prompt field shows the served template; visitor input is sent separately.

## Chat access and safety settings

This sample protects provider-backed chat with **Manus OAuth**, not the sample-user dropdown. In `.env` for a supported Manus development runtime, or in your host's protected runtime settings for deployment, set:

| Name | Required for chat | Value and scope |
| --- | --- | --- |
| `LAUNCHDARKLY_CLIENT_SIDE_ID` | For the browser widget | Public ID for the chosen LaunchDarkly environment. |
| `LD_SDK_KEY` | Yes | Private SDK key for that **same** environment. Never put it in browser code. |
| `APP_PUBLIC_ORIGIN` | Yes | Exact browser-visible URL origin with no trailing slash, for example `http://localhost:3000`, the HTTPS Preview origin for development, or the final HTTPS published origin for production. The OAuth callback is this origin plus `/api/auth/callback`. |
| `CHAT_ALLOWED_EMAILS` | Yes | Comma-separated email addresses of Manus accounts allowed to chat. Start with only your own Manus account email. |
| `APP_SESSION_SECRET` | Yes | A new random secret, at least 32 characters, distinct for development and production. Generate locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never send it in chat. |
| `CHAT_EMERGENCY_OFF` | No | Set to `true` and restart the server to deny new chat requests independent of cached LaunchDarkly flag values. Defaults to `false`. |
| `OPENAI_API_KEY` | For live AI only | Private provider key. Without it, authorized, flag-enabled requests return a labeled canned reply. |
| `LAUNCHDARKLY_AI_CONFIG_KEY` | For live AI only | Defaults to `support-chat-assistant`. |
| `LAUNCHDARKLY_TRIGGER_URL` | For scripted kill switch only | Private URL used by `npm run kill-switch`; the website does not need it. |

The managed Manus server injects `MANUS_PROJECT_ID`, `MANUS_OAUTH_PORTAL_URL`, `MANUS_OAUTH_API_URL`, and `MANUS_JWT_SECRET` automatically. Do not commit or invent these platform values. A standalone GitHub clone can show the landing page but cannot complete Manus login without the corresponding supported OAuth runtime and redirect policy. Browser login opens a new tab, which avoids OAuth redirects inside the embedded Preview iframe. If the browser blocks cross-site cookies in the iframe, use the standalone Preview URL instead. `GET /api/auth/session` reports whether access is configured and whether the current browser is signed in, without returning any key.

The chat endpoint requires a signed, allowlisted session and the exact configured request origin. It then evaluates `release-support-chat` with a single server-side SDK client for the **selected demo context**. All five contexts are **synthetic**: an allowlisted presenter may choose any of them, including one targeted to a more expensive model. Only invite trusted presenters. This selector must not be used for actual customer authorization or pricing. Off, not targeted, missing credentials, initialization failure, or an evaluation error denies chat before any AI call. Each process permits up to **12 chat attempts per authenticated email** and **60 per connecting socket peer** per 15 minutes, **12 login starts per socket peer** per 15 minutes, and **2 concurrent chat requests per email**. On managed hosting, the socket peer may be a **shared ingress proxy**, so those two peer buckets can affect several visitors. Do not trust arbitrary `X-Forwarded-For` headers as a workaround. Excess requests return HTTP 429 with `Retry-After`. Limits are in memory and **per process**; they are not a global budget across replicas or restarts. For a scaled public service, enforce limits at a trusted ingress or shared rate-limit store, add provider spending controls, and store one-use OAuth nonces in a shared TTL-backed store. The current in-memory nonce design assumes **one app instance** during a login flow; a restart or non-sticky load-balanced callback requires the user to retry sign-in.

The server SDK serves cached flag values after initialization. If it loses connectivity later, a previously cached `true` value can persist until updates resume; a LaunchDarkly-triggered kill switch is therefore not a substitute for independent emergency infrastructure controls. If necessary, set `CHAT_EMERGENCY_OFF=true` at the runtime and restart to deny new chat requests. A request already in progress at the provider may finish after a flag is turned off. The AI SDK is an **open beta** that LaunchDarkly does not recommend for production use; treat live AI as a protected staging or panel demo, not an unrestricted commercial production service.

### Live deployment and proof checklist

1. Complete the LaunchDarkly resource setup above in one environment: `release-support-chat` boolean with **SDKs using client-side ID** enabled; optional Generic off trigger; and `support-chat-assistant` with two Completion variations. Copy the client-side ID and server SDK key from **Organization settings > Security > SDK keys** for that environment. Do not use the mobile key or a LaunchDarkly API access token.
2. In the Manus website project's protected runtime settings, supply `LAUNCHDARKLY_CLIENT_SIDE_ID`, `LD_SDK_KEY`, `CHAT_ALLOWED_EMAILS`, and `APP_SESSION_SECRET` for development. Set `APP_PUBLIC_ORIGIN` to the exact HTTPS Preview origin reported by the project. Restart the development server to load new values. The site can be previewed without them, but chat deliberately stays closed.
3. Before enabling live AI, publish the fail-closed version to obtain its HTTPS site URL if a published origin has not yet been assigned. Set **published-runtime** values for those five names, with `APP_PUBLIC_ORIGIN` set to that exact published origin and a *different* `APP_SESSION_SECRET`; then publish the updated checkpoint. Only add `OPENAI_API_KEY` for a restricted staging or panel demonstration, not unrestricted production traffic, because the AI SDK is open beta. A secret setting or GitHub push by itself does not restart a server or publish a website.
4. On the deployed origin, check `GET /health` returns `{"status":"ok"}`, `GET /api/config` contains the public client-side ID but no private keys, and `GET /api/auth/session` reports `configured:true`. Without signing in, a same-origin POST to `/api/chat` must return 401. Sign in from the widget with an allowlisted Manus account. If the OAuth callback is rejected, confirm `APP_PUBLIC_ORIGIN` exactly matches the browser origin and the project's redirect policy accepts that callback.
5. With flag default `true`, select Alex and send one message. With no provider key it must be explicitly **CANNED RESPONSE**. Turn the flag globally **Off** and observe the widget disappear without reload. Even if a stale browser tries a direct chat request, the server must return 403 and make no AI call. Turn the flag On again, set default `false`, then test the `alex-free` individual target and `plan = enterprise` / boolean `betaTester = true` rules with the five contexts. If a Generic trigger exists, run `npm run kill-switch` from an environment where its private URL is configured and watch the widget close.
6. In a staging environment, verify anonymous, denied-email, cross-origin and expired-session requests fail, and confirm the 13th same-email chat request within 15 minutes returns 429 with `Retry-After`. Do this **before** adding a billable provider key; `npm test` covers these cases without external secrets. Avoid consuming your production demo quota during the panel.
7. If AgentControl is available, set `OPENAI_API_KEY` as a protected **staging or restricted panel-demo runtime** value, publish/restart if hosting the panel demo, and send a message as Alex and Jordan while both are targeted by the flag. Expect `LIVE AI CONFIG`, distinct `concise-support` and `guided-support` variations, the configured model, and the prompt template in each reply. If a request shows **CANNED RESPONSE**, inspect its reason and config targeting; never describe a canned response as live AI.

## Design and code map

`server.js` serves static assets, a browser-safe config endpoint, health check, OAuth endpoints, and the guarded chat API. `auth.js` validates Manus OAuth, a one-use state nonce, an allowlist, and signed sessions. `flag.js` keeps one server-side flag client; `limits.js` provides request and in-flight limits. `users.js` holds five demo contexts for both browser and server targeting. `public/app.js` handles SDK lifecycle, live flag changes, `identify`, the activity log, and login state. `scripts/kill-switch.js` sends the secret trigger request. The user dropdown is illustrative, never a production authorization boundary.

## Troubleshooting and clean-install check

- **Widget stays hidden:** Confirm the flag key, environment, client-side ID, flag targeting On, client-side SDK availability, and the selected context's rule. Inspect the on-page status. A fallback `false` is not proof that the flag is off in LaunchDarkly.
- **Switching users does not change the result:** Confirm the flag is globally On, the default and individual targets do not override your custom rules, attribute type for `betaTester` is boolean, and the server and browser target the same environment.
- **Widget appears but chat says access is not configured:** Confirm `APP_PUBLIC_ORIGIN`, `CHAT_ALLOWED_EMAILS`, `APP_SESSION_SECRET`, and the managed Manus OAuth environment variables. A local clone outside Manus will not receive platform OAuth settings.
- **Sign-in opens but chat remains locked:** Use the standalone site tab after completing OAuth, check that your Manus email is allowlisted, and confirm your browser accepts the HTTPS session cookie. Embedded Preview third-party cookie restrictions may prevent the iframe from sharing the standalone tab's login.
- **Chat request returns 403 or 503:** 403 means the request origin was wrong or the server-side flag is off for that selected context; 503 means the server could not verify the flag or access configuration. A visible browser widget does not override server denial.
- **Trigger command fails:** Verify trigger access, copied URL, action `turn flag off`, and `.env`. The script never prints the URL. A manual dashboard Off toggle is still valid for the release demonstration.
- **AI returns canned:** Check whether the response says no provider key or unavailable AI Config. Both are intentional fallback modes. Check config key, server SDK key, targeting, model/provider compatibility, and OpenAI key for a live reply.

A fresh-clone reproduction, from the repository root, should work with only these steps:

```sh
cp .env.example .env
# Fill both LaunchDarkly SDK credentials and Manus access settings for live chat.
npm install
npm start
```

In a second terminal, try `curl -f http://localhost:3000/health` and open the page. Run `npm test` for self-contained smoke tests. No account keys are committed. Without LaunchDarkly or Manus OAuth values, the page still runs but the chat endpoint fails closed; live account behavior awaits runtime configuration.

## GitHub checks and deployment readiness

Source: [derekuzzle/abc-company-launchdarkly-demo](https://github.com/derekuzzle/abc-company-launchdarkly-demo). `.github/workflows/ci.yml` runs `npm ci`, `npm test`, JavaScript syntax checks, and a production-dependency audit on pushes to `main` and pull requests using Node 18 and 22. CI needs **no** LaunchDarkly or provider secrets and cannot prove live account integration. GitHub holds the source, not a deployed website; passing CI does not publish the app.

Before a live LaunchDarkly demo, set the two SDK credentials, create and expose the boolean flag to client-side SDKs, test On/Off streaming without reload, exercise the five sample contexts and rules, and test the trigger if your plan supports it. If demonstrating live AI, also configure `support-chat-assistant`, a provider key, and both variations, then verify a reply for a free and an enterprise context. Confirm these against the **deployed runtime**, not just a local `.env`.

**Public deployment boundary:** The endpoint now requires an allowlisted Manus session, exact request origin, independent server-side flag evaluation, and per-process rate and concurrency limits. The sample-user dropdown remains *deliberately selectable* for targeting demonstrations; it is not tied to the signed-in identity. A multi-replica or long-lived commercial service still needs distributed limits, ongoing provider budget controls, monitoring, and a proper user/permissions model. Never commit SDK keys, provider keys, or trigger URLs.

## Documentation verified for this sample

The implementation follows the current [browser JavaScript SDK](https://launchdarkly.com/docs/sdk/client-side/javascript), [Node server SDK](https://launchdarkly.com/docs/sdk/server-side/node-js), [Node AI SDK](https://launchdarkly.com/docs/sdk/ai/node-js), and [flag trigger creation](https://launchdarkly.com/docs/home/releases/triggers-create). It pins the browser SDK at 4.11.0, server SDK at 9.14.2, Node AI SDK at 0.2.0, and OpenAI messages handler at 0.3.0 in `package.json` and `package-lock.json`.
