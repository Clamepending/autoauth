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

## Requirements

- Node 20+
- an Anthropic API key
- a local Chrome/Chromium binary

By default the worker tries common Chrome/Chromium install paths. You can override that with:

```bash
export OTTOAUTH_BROWSER_PATH=/path/to/chrome-or-chromium
```

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

## Open The Login Browser Later

This opens the worker's own persistent profile, not your normal Chrome profile. Close the browser window when you're done signing in.

```bash
cd headless-worker
npm run login -- --site snackpass
```

You can also open an exact URL:

```bash
cd headless-worker
npm run login -- --url https://order.snackpass.co/
```

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
- The login window uses the dedicated worker profile, so it does not automatically import your normal laptop Chrome passwords or other sites unless you log into them inside that worker profile.
- By default it closes existing tabs at the start of each task so tasks start from a clean browser while keeping cookies/session state.
- OttoAuth task screenshots are still streamed back even in headless mode.
- The bootstrap script tries to enable a user `systemd` service. If your Pi image does not support `systemctl --user`, it will still pair the worker and print the manual run command instead.
