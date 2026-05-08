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
only when you are developing OttoAuth itself.

The important integration path is intentionally small:

- `POST /api/agent-design` creates a local design JSON object.
- `POST /api/ottoauth-preview` turns the design into an OttoAuth order payload
  and calls `POST /v1/orders` with `dry_run:true`.
- `POST /api/buy` creates a short-lived SVG URL, creates an OttoAuth hosted
  checkout session with `POST /v1/checkout/sessions`, and returns the hosted
  confirmation URL.

The frontend only needs to call the local `/api/buy` helper. In production, that
helper should live on the app server so the agent private key is never exposed
to browser code. The browser redirects to OttoAuth, the human confirms the
order there, and OttoAuth creates the fulfillment order after confirmation.
