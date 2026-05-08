# OttoAuth T-Shirt Designer Demo

This is a zero-dependency localhost demo for testing how small an OttoAuth buy
button can be in a creative app.

```bash
cd examples/tshirt-designer
npm start
```

Open `http://127.0.0.1:5178`.

The demo defaults to `https://ottoauth.vercel.app`, so a localhost creative app
can upload files and create real OttoAuth hosted checkout sessions against the
production fulfillment queue. Set `OTTOAUTH_BASE_URL=http://127.0.0.1:3000`
only when you are developing OttoAuth itself. The Base URL field in the UI is an
override; leave it blank to use the server default.

On first checkout, the demo starts OttoAuth Connect instead of requiring a
developer key. The browser goes to OttoAuth, the user logs in or creates an
account, approves the local app install, and OttoAuth redirects back to
`/api/ottoauth/callback`. The demo stores the returned install token in
`.ottoauth-install.json` and reuses it for later uploads, quote previews, and
hosted checkout session creation. After a successful Connect callback, the demo
continues directly into the hosted checkout page. Set
`OTTOAUTH_INSTALL_STORE=/path/to/file` if you want the local install token
somewhere else.

The important integration path is intentionally small:

- `POST /api/agent-design` creates a local design JSON object.
- `POST /api/ottoauth-preview` turns the design into an OttoAuth order payload
  and calls `POST /v1/quotes` when the app is connected.
- `POST /api/buy` starts OttoAuth Connect when the app is not connected. Once
  connected, it uploads the SVG with `POST /api/sdk/files`, creates an OttoAuth
  hosted checkout session with `POST /v1/checkout/sessions`, and returns the
  hosted confirmation URL.

The frontend only needs to call the local `/api/buy` helper. In production, that
helper should live on the app server so the install token is never exposed to
browser code. The browser redirects to OttoAuth, the human confirms the order
there, and OttoAuth creates the fulfillment order after confirmation.
