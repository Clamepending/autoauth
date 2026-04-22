# OttoAuth Headless Worker

Small command-line OttoAuth fulfiller for headless devices such as Raspberry Pis, mini PCs, or cloud VMs with Chrome/Chromium installed.

It can:

- pair to a human account using the normal OttoAuth claim code
- poll OttoAuth for browser tasks
- fulfill tasks with Anthropic + Playwright in headless mode
- stream screenshots back to OttoAuth while a task runs
- report completion and model usage for billing
- save a local Playwright trace plus a compact task transcript

## Install

```bash
cd headless-worker
npm install
```

## One-Command Raspberry Pi Onboarding

Fresh machine, no repo clone needed:

```bash
curl -fsSL https://raw.githubusercontent.com/Clamepending/autoauth/main/headless-worker/scripts/install-remote.sh | ANTHROPIC_API_KEY=sk-ant-... bash -s -- --server https://ottoauth.vercel.app --device-id raspberry-pi-worker-1 --label "Raspberry Pi Worker" --claim-code XXXX-XXXX-XXXX
```

That downloads OttoAuth into `~/.local/share/ottoauth/autoauth`, installs the worker, pairs it, opens the worker's dedicated browser profile to Snackpass for sign-in, and then starts the background service after you close that browser window.

If the repo is already on the Pi, this also works:

```bash
cd /path/to/autoauth && ANTHROPIC_API_KEY=sk-ant-... ./headless-worker/scripts/bootstrap.sh --server https://ottoauth.vercel.app --device-id raspberry-pi-worker-1 --label "Raspberry Pi Worker" --claim-code XXXX-XXXX-XXXX
```

What the installer/bootstrap does:

- installs `headless-worker` dependencies
- pairs the device to your OttoAuth human account
- opens a visible browser window using the worker's dedicated persistent profile so you can sign in to Snackpass
- writes the Anthropic/browser config into `~/.ottoauth-headless-worker/`
- installs and starts a user `systemd` service so the worker keeps polling in the background

If you want to install from a different branch while testing, add `--repo-ref your-branch-name` to the remote installer command.

If you do not want the sign-in window during install, add `--skip-login`.

## One-Command Mac Onboarding

From this repo on your Mac:

```bash
cd headless-worker && ANTHROPIC_API_KEY=sk-ant-... ./scripts/bootstrap.sh \
  --server https://ottoauth.vercel.app \
  --device-id mac-worker-1 \
  --label "Mac Worker" \
  --claim-code XXXX-XXXX-XXXX
```

That installs dependencies, pairs the device, opens the worker browser for sign-in, writes `~/.ottoauth-headless-worker/service.env`, and installs a macOS LaunchAgent that automatically relaunches the worker if it exits.

Fastest collaborator path for a normal Mac setup:

```bash
cd headless-worker && ANTHROPIC_API_KEY=sk-ant-... npm run bootstrap:mac -- \
  --server https://ottoauth.vercel.app \
  --device-id your-name-mac-worker \
  --label "Your Name Mac Worker" \
  --claim-code XXXX-XXXX-XXXX
```

That wrapper uses the person's real Google Chrome user-data dir, pins OttoAuth to the `Default` Chrome profile, and runs the worker headful so the browser window is visible during tasks.

Recommended for a collaborator who wants OttoAuth to use their real everyday Chrome profile:

```bash
cd headless-worker && ANTHROPIC_API_KEY=sk-ant-... ./scripts/bootstrap.sh \
  --server https://ottoauth.vercel.app \
  --device-id mac-worker-1 \
  --label "Mac Worker" \
  --claim-code XXXX-XXXX-XXXX \
  --profile-dir "$HOME/Library/Application Support/Google Chrome" \
  --profile-name Default \
  --headful
```

That tells OttoAuth to reuse Chrome's real user-data dir and the `Default` profile instead of a separate worker-only profile. On macOS, if you pass `--profile-dir` and omit `--profile-name`, bootstrap defaults to `Default`.

Useful macOS files after install:

- `~/Library/LaunchAgents/com.ottoauth.headless-worker.plist`
- `~/Library/Logs/ottoauth-headless-worker/stdout.log`
- `~/Library/Logs/ottoauth-headless-worker/stderr.log`

## Collaborator Quickstart

If someone else on your team wants to add their laptop as a fulfiller, these are the only steps they should need:

1. Clone the repo and `cd headless-worker`.
2. Generate a claim code from the OttoAuth dashboard.
3. Run the Mac bootstrap command above with their Anthropic key, claim code, and a unique `--device-id`.
4. When Chrome opens, sign into the sites OttoAuth should reuse.
5. Fully quit normal Chrome after sign-in if the worker is sharing that same real Chrome profile.
6. Confirm the device shows up in the OttoAuth dashboard and run `npm run status` if they want a local check.

Recommended naming:

- `--device-id jane-macbook-worker`
- `--label "Jane MacBook Worker"`

If a collaborator does not want OttoAuth touching their everyday Chrome profile, they can skip `npm run bootstrap:mac` and use the plain `./scripts/bootstrap.sh ...` command instead. That uses the worker's own dedicated profile under `~/.ottoauth-headless-worker/profile`.

## Fulfillment Prompting Notes

The worker is most reliable when browser tasks are written as structured work orders:

```text
Platform: Snackpass
Store or merchant name: Little Plearn
Fulfillment method: pickup
Item name: Pad see ew
Order details, modifiers, and preferences: mild spice, no peanuts
Delivery address, if any: Jane Doe, 123 Main St, San Francisco, CA
Additional instructions: ask for clarification if the item is unavailable
```

For Snackpass, prefer a direct `https://order.snackpass.co/...` URL when you know it. If only the merchant name is known, include the store name and `website_url: "https://www.snackpass.co/"`; OttoAuth will tell the worker to search `"<store>" Snackpass`, prefer official `order.snackpass.co` ordering pages, and avoid the generic homepage, maps, articles, guides, and social pages.

Known Snackpass routing hints should be store-level only. Do not add item-specific hints such as a single product name or price; those change too often and can make the worker overfit the wrong order.

## Debugging A Run

The worker writes a compact transcript and Playwright trace for each task under:

```text
~/.ottoauth-headless-worker/traces/
```

Use the latest task directory when a run fails or chooses the wrong site. The useful files are usually `trace.json`, `playwright-trace.zip`, and the screenshots streamed back to the OttoAuth order page.

## Requirements

- Node 20+
- an Anthropic API key
- a local Chrome/Chromium binary

By default the worker tries common Chrome/Chromium install paths. You can override that with:

```bash
export OTTOAUTH_BROWSER_PATH=/path/to/chrome-or-chromium
```

If you want OttoAuth to reuse an existing Chrome/Chromium user data directory instead of the worker's default dedicated profile, set:

```bash
export OTTOAUTH_PROFILE_DIR=/path/to/chrome-user-data-dir
```

This should point at the browser's user data root, for example `~/.config/chromium` on many Linux systems.
The bootstrap script also accepts `--profile-dir /path/to/browser-user-data`.

If that user data dir contains multiple Chrome profiles, you can also pin a specific profile directory name:

```bash
export OTTOAUTH_PROFILE_NAME=Default
```

The bootstrap script also accepts `--profile-name Default`.

## Pair The Device

Generate a claim code from the OttoAuth dashboard, then run:

```bash
cd headless-worker
ANTHROPIC_API_KEY=sk-ant-... \
npm run pair -- \
  --server https://ottoauth.vercel.app \
  --device-id raspberry-pi-worker-1 \
  --label "Raspberry Pi Worker" \
  --claim-code XXXX-XXXX-XXXX
```

That stores the claimed device token in:

```text
~/.ottoauth-headless-worker/config.json
```

If you use the bootstrap script above, you do not need to run this pairing command separately.

## Run The Worker

```bash
cd headless-worker
ANTHROPIC_API_KEY=sk-ant-... npm run run
```

Useful flags:

- `--headful` runs Chrome visibly instead of headless
- `--browser-path /path/to/chrome`
- `--model claude-sonnet-4-5-20250929`
- `--keep-tabs` keeps old tabs open between tasks
- `--wait-ms 25000` changes long-poll wait duration

For a one-shot smoke test:

```bash
cd headless-worker
ANTHROPIC_API_KEY=sk-ant-... npm run once
```

## Open The Controlled Login Browser Later

This opens the worker's browser through Playwright. If you are using the default worker-only profile, it opens that profile. If you configured `OTTOAUTH_PROFILE_DIR`, it opens the configured real browser profile instead. Close the browser window when you're done signing in.

```bash
cd headless-worker
npm run login -- --site snackpass
```

To sign into the dedicated worker profile for several supported services at once:

```bash
cd headless-worker
npm run login -- --site snackpass,grubhub,instacart,uber,amazon
```

You can also open an exact URL:

```bash
cd headless-worker
npm run login -- --url https://order.snackpass.co/
```

## Open The Real Browser Profile Later

If you want to sign into Chrome itself, or Google rejects the Playwright-controlled login window with `This browser or app may not be secure`, open the real browser profile directly instead:

```bash
cd headless-worker
npm run open-profile -- https://order.snackpass.co/
```

This launches plain Chrome/Chromium on the configured `OTTOAUTH_PROFILE_DIR` and `OTTOAUTH_PROFILE_NAME`, without Playwright control.

## Run The Configured Service In Foreground

For manual debugging on a Mac or desktop machine, you can run the already-configured worker in the foreground with all settings loaded from `service.env`:

```bash
cd headless-worker
npm run service:run -- --headful
```

That uses the same paired device id, Anthropic key, browser path, and profile settings as the background service.

For the local non-live verifier:

```bash
cd headless-worker
npm run verify
```

For a live local OttoAuth smoke test against a dev server on `http://127.0.0.1:3110`:

```bash
cd headless-worker
ANTHROPIC_API_KEY=sk-ant-... BASE_URL=http://127.0.0.1:3110 npm run live-local-e2e
```

## Status

```bash
cd headless-worker
npm run status
```

Useful local checks:

- `launchctl print gui/$(id -u)/com.ottoauth.headless-worker | rg state`
- `tail -f ~/Library/Logs/ottoauth-headless-worker/stdout.log`
- `tail -f ~/Library/Logs/ottoauth-headless-worker/stderr.log`

## Files On Disk

The worker keeps its state in:

```text
~/.ottoauth-headless-worker/
```

Important subfolders:

- `config.json` — paired device credentials
- `profile/` — persistent browser profile/cookies
- `traces/` — Playwright traces and compact OttoAuth task transcripts

## Notes

- This worker preserves browser login state across runs by using a persistent Chrome profile.
- If you reuse your real Chrome/Chromium user data dir with `OTTOAUTH_PROFILE_DIR`, OttoAuth can share that browser profile's site sessions.
- If you reuse a real Chrome profile on macOS, fully quit normal Chrome before OttoAuth takes over that same profile. Otherwise Chrome may print `Opening in existing browser session` and Playwright will lose control.
- Google account sign-in may reject the Playwright-controlled login window with `This browser or app may not be secure`. In that case use `npm run open-profile -- https://order.snackpass.co/` to open the same real profile in plain Chrome, sign in there, then close Chrome before restarting OttoAuth.
- By default it closes existing tabs at the start of each task so tasks start from a clean browser while keeping cookies/session state.
- OttoAuth task screenshots are still streamed back even in headless mode.
- The bootstrap script tries to enable a user `systemd` service. If your Pi image does not support `systemctl --user`, it will still pair the worker and print the manual run command instead.
- On macOS, the bootstrap script installs a LaunchAgent, so the worker auto-restarts while your user session is logged in.

## Troubleshooting

- `Opening in existing browser session`
  Fully quit Chrome with `Cmd+Q`. OttoAuth cannot safely take over the same real Chrome profile while regular Chrome is still using it.
- `This browser or app may not be secure`
  Run `npm run open-profile -- https://order.snackpass.co/`, sign in in that plain Chrome window, close Chrome, then start OttoAuth again.
- Worker is paired but no jobs are getting picked up
  Check `npm run status`, confirm the device is enabled in OttoAuth, and look at the LaunchAgent logs above.
- The worker window is not logged into the same site as normal Chrome
  Make sure `OTTOAUTH_PROFILE_DIR` and `OTTOAUTH_PROFILE_NAME` point at the exact real profile you signed into, then fully quit Chrome before OttoAuth starts.
