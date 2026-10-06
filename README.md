# ABC Company support chat: LaunchDarkly demo

A small Express app for **Part 1, release and remediate** and **Part 2, targeting**. Extra credit demonstrates an AgentControl AI Config; without an OpenAI key, chat returns a clearly labeled canned reply.

Built with AI assistance (Manus) and reviewed by me, the exercise submitter.

## Prerequisites and assumptions

- Node.js 18+ and npm. The page uses plain JavaScript without a build step.
- A LaunchDarkly project and one environment, such as `test`, where you can create a flag. Use credentials from that same environment throughout.
- Optional: access to Generic flag triggers and AgentControl. These may depend on your LaunchDarkly plan or trial entitlement.
- Optional: an OpenAI API key for live AI replies. No provider key or AI Config is needed for the canned reply.

## Setup

1. In LaunchDarkly, create a **Boolean** flag named `Release support chat` with exact key `release-support-chat`, variations `true` and `false`, and default/off variation `false`.
2. Enable **SDKs using client-side ID** for the flag, either during creation or in the flag's Settings.
3. In **Organization settings > Security > SDK keys**, select the same project and environment and locate its **Client-side ID** and private **SDK key**.
4. Clone the repository:
   ```sh
   git clone https://github.com/derekuzzle/abc-company-launchdarkly-demo.git
   ```
5. Enter the project directory:
   ```sh
   cd abc-company-launchdarkly-demo
   ```
6. Copy the environment template:
   ```sh
   cp .env.example .env
   ```
7. Put those two values in `.env` as `LAUNCHDARKLY_CLIENT_SIDE_ID` and `LD_SDK_KEY`; leave the optional values empty for now.
8. Install the pinned dependencies:
   ```sh
   npm install
   ```
9. Start the app:
   ```sh
   npm start
   ```
10. Open `http://localhost:3000` and select **Live demo**.

Keep `.env` out of Git. The client-side ID is public; the server SDK key starts with `sdk-` and must stay private.

## Part 1: release and remediate

1. In the flag's **Targeting** tab for your chosen environment, turn it **On**, serve `true` by default, then **Review and save**. The widget appears and its status log records the update without a page reload.
2. Send a chat message. With no `OPENAI_API_KEY`, the reply says **CANNED RESPONSE**.
3. Turn the flag **Off**, then **Review and save**. The widget disappears and the log records another timestamped update; new direct chat requests return HTTP 403.
4. If Generic triggers are available, create one on `release-support-chat` in that environment with action **turn flag off**. Copy its unique URL when LaunchDarkly shows it.
5. Put that URL in `.env` as `LAUNCHDARKLY_TRIGGER_URL`.
6. Turn the flag On again, then run `npm run kill-switch` to send the trigger's POST request. The widget should close without refreshing.

For a direct trigger test, use `curl -i -X POST 'PASTE_YOUR_UNIQUE_TRIGGER_URL_HERE'`. If triggers are unavailable, the manual Off toggle still demonstrates remediation.

## Part 2: targeting

The **Viewing as** selector calls LaunchDarkly `identify` and shows each sample context's attributes. Use the keys below, not the display names, when targeting individuals.

| Name | Key | plan | region | role | betaTester |
| --- | --- | --- | --- | --- | --- |
| Alex Rivera | `alex-free` | free | us | member | false |
| Maya Chen | `maya-pro` | pro | eu | admin | true |
| Jordan Lee | `jordan-enterprise` | enterprise | us | admin | false |
| Sam Patel | `sam-free-beta` | free | eu | member | true |
| Taylor Brooks | `taylor-pro` | pro | us | member | false |

All five are `kind: user` contexts and also include the corresponding `name` and `email` shown in the page inspector.

1. Turn the flag On with its default rule serving `false`.
2. Under **Targeting > Target individuals**, serve `true` to the `user` context with key `alex-free`.
3. Switch between Alex and Taylor in the app. Alex gets chat; Taylor does not, without reloading.
4. Remove Alex's individual target before testing attribute rules alone.
5. Add a custom `user` rule: `plan` **is one of** `enterprise`, serving `true`.
6. Add another custom `user` rule: `betaTester` **is one of** boolean `true`, serving `true`.
7. Switch through the five contexts. Jordan, Maya, and Sam get chat; Alex and Taylor do not.

An individual target takes priority over custom rules, and a globally Off flag overrides both.

## Extra credit: AI Config

These steps are optional. They use the same LaunchDarkly environment and an OpenAI key that can access your chosen models.

1. Under **Agents > Configs**, create a **Completion** config named `Support chat assistant` with exact key `support-chat-assistant`.
2. Add variation `concise-support`, provider **OpenAI**, model `gpt-4o-mini` (or an accessible model), with system message: `You are ABC Company's helpful support assistant. Answer in two concise sentences. If you do not know, say so and suggest contacting the team.`
3. Add variation `guided-support`, provider **OpenAI**, model `gpt-4o` (or an accessible model), with system message: `You are ABC Company's helpful support assistant. Give clear, practical steps, then ask one useful follow-up question. Do not invent account-specific details.`
4. In the config's **Targeting** tab, serve `concise-support` by default and `guided-support` when `user.plan` **is one of** `enterprise`.
5. Set `OPENAI_API_KEY` in `.env`.
6. Restart `npm start` to load the new key.
7. Turn `release-support-chat` On for Alex and Jordan, send a message as each, and compare **LIVE AI CONFIG**, variation, model, and prompt details under each reply.

If AgentControl or the provider key is unavailable, leave `OPENAI_API_KEY` empty. The app still demonstrates Parts 1 and 2 and returns labeled canned replies when the server flag permits chat.

## Optional hosted-copy passcode

Set `DEMO_PASSCODE` when hosting a copy with a billable `OPENAI_API_KEY`. The chat form asks for it once per page load, and the server checks it on every chat request.

## How it works

- `server.js` serves the page and `/api/config`, validates sample contexts and the optional passcode, limits `/api/chat` to 20 requests per IP per 15 minutes, and returns canned or live replies.
- `flag.js` calls server SDK `init` once, `waitForInitialization` to avoid evaluating too early, and `variation('release-support-chat', context, false)` once per chat request. Off or non-targeted contexts return HTTP 403.
- `users.js` contains the five shared sample contexts. `public/index.html`, `public/styles.css`, and `public/favicon.svg` provide the page, layout, and icon.
- `public/app.js` calls browser SDK `createClient` and `start` to connect, `waitForInitialization` to detect readiness, `variation` to show the flag, `on('change:release-support-chat')` to update without reload, and `identify` when you switch users.
- For extra credit, `server.js` calls AI SDK `initClient` with the server client, `inspectConfig` to read the selected variation, and `openaiMessages` to call the selected provider and record usage.
- `scripts/kill-switch.js` POSTs the optional trigger URL. `.env.example` lists settings; `.gitignore` keeps local `.env` out of Git.
- `package.json` and `package-lock.json` pin dependencies. `test/smoke.test.js` tests the app offline; `.github/workflows/ci.yml` runs tests on Node 18 and 22.
- `app.config.ts` and `public/manus-routes.json` are tiny files needed by the managed Manus Preview and are not needed to run the cloned app locally.

## Troubleshooting

- **Widget stays hidden:** Check the flag key, selected environment, client-side ID, **SDKs using client-side ID** setting, global On state, and targeting rule. A missing flag uses fallback `false`.
- **Browser shows chat but sending returns 403:** Confirm `LD_SDK_KEY` belongs to the same environment as the browser ID and that the chosen context gets `true`. The server checks the flag independently.
- **Sending returns 503:** The server could not initialize or evaluate its flag; check `LD_SDK_KEY` and network access.
- **Sending returns 401:** The configured `DEMO_PASSCODE` is missing or incorrect. Leave it empty for an open local demo.
- **Sending returns 429:** The IP sent more than 20 requests within 15 minutes. Wait for the window to reset.
- **Reply says CANNED RESPONSE:** No OpenAI key is set, or AI Config targeting is unavailable. The reason appears with the reply.
- **Trigger command fails:** Confirm your account supports Generic triggers and the secret URL is current. Use the manual flag Off toggle if needed.

Run `npm test` for offline checks. GitHub CI tests the code without your credentials; live account behavior requires the LaunchDarkly setup above.
