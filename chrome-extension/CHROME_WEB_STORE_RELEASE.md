# Chrome Web Store Release (Minimal Steps)

This repo includes a release-packaging script and a privacy policy page so the remaining work is mostly Chrome Web Store listing setup.

## 1. Final local checks

From the repo root:

```bash
cd /Users/mark/Desktop/projects/autoauth
node --check chrome-extension/mock-open-link/background.js
node --check chrome-extension/mock-open-link/sidepanel.js
npm run build
```

## 2. Build the extension ZIP

```bash
/Users/mark/Desktop/projects/autoauth/scripts/package-extension.sh
```

Output:
- `/Users/mark/Desktop/projects/autoauth/chrome-extension/ottoauth-browser-agent.zip`

## 3. Upload to Chrome Web Store

Developer dashboard:
- <https://chrome.google.com/webstore/devconsole>

Upload:
- `/Users/mark/Desktop/projects/autoauth/chrome-extension/ottoauth-browser-agent.zip`

## 4. Fill required listing/compliance fields

Required/important:
- Extension name: `OttoAuth Browser Agent`
- Short description
- Full description
- Screenshots
- Privacy policy URL: `https://ottoauth.vercel.app/privacy`
- Data usage disclosures (browser content may be sent to selected AI provider during runs)
- Permission justifications (`tabs`, `tabGroups`, `storage`, `scripting`, `sidePanel`, `notifications`)

## 5. Submit for review

Notes:
- Reviews may ask for clarification on AI/browser automation behavior and data handling.
- Be explicit that users control runs and can choose BYOK providers.

## Suggested listing description (starter)

OttoAuth Browser Agent is a Chrome side-panel browser agent that pairs with OttoAuth for cloud task routing and also supports local BYOK AI browser automation. It can generate a plan, ask for approval, and execute browser actions on the current tab with a visible activity indicator.
