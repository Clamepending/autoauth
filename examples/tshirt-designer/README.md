# OttoAuth T-Shirt Designer Demo

This is a zero-dependency localhost demo for testing how small an OttoAuth
checkout button can be in a creative app.

```bash
cd examples/tshirt-designer
npm start
```

Open `http://127.0.0.1:5178`.

The demo defaults to `https://ottoauth.vercel.app`, so a localhost creative app
can create real OttoAuth hosted checkout sessions against the production
fulfillment queue. Set `OTTOAUTH_BASE_URL=http://127.0.0.1:3000` only when you
are developing OttoAuth itself.

The important integration path is intentionally small:

- `POST /api/agent-design` creates a local design JSON object.
- `POST /api/ottoauth-preview` turns the design into an OttoAuth order payload
  for local inspection.
- `POST /api/buy` sends a public hosted-checkout payload with the SVG embedded
  to `POST /v1/checkout/sessions` and returns the hosted confirmation URL.

The frontend only needs to call the local `/api/buy` helper. The demo does not
hold an OttoAuth private key, start Connect, store install credentials, or manage
local login state. The browser redirects to OttoAuth, the human signs in or
creates an account there, confirms the order there, and OttoAuth creates the
fulfillment order after confirmation.
