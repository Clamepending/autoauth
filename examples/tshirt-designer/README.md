# OttoAuth T-Shirt Designer Demo

This is a zero-dependency localhost demo for testing a Stripe-style OttoAuth
checkout button in a creative app.

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

- The page loads `https://ottoauth.vercel.app/checkout.js`.
- The checkout button calls `OttoAuth.buy(...)`.
- The helper serializes the SVG, creates the hosted checkout session, and
  redirects the browser to OttoAuth.

The demo server only serves static files and injects the OttoAuth base URL for
local development. It does not hold an OttoAuth private key, start Connect,
store install credentials, proxy files, create checkout sessions, or manage
local login state. The browser redirects to OttoAuth, the human signs in or
creates an account there, confirms the order there, and OttoAuth creates the
fulfillment order after confirmation.

The shape app developers should see is:

```html
<script src="https://ottoauth.vercel.app/checkout.js"></script>
<button id="buy">Buy</button>
<script>
  buy.onclick = () => OttoAuth.buy({
    app: "my-local-app",
    title: "Custom T-shirt print",
    task: "Order this shirt with the attached front-print artwork.",
    merchant: "Custom Ink",
    max: 2000,
    files: ["#artwork"]
  });
</script>
```
