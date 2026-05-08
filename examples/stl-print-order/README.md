# OttoAuth STL Print Order Demo

This is a minimal localhost app for ordering a 3D print from an STL file through
OttoAuth hosted checkout.

```bash
cd examples/stl-print-order
npm start
```

Open `http://127.0.0.1:5179`.

The app reads an STL in the browser, estimates rough volume/bounds when possible,
then asks its tiny local server to create one OttoAuth hosted checkout session.
It does not hold an OttoAuth private key, start Connect, or manage local
credentials. OttoAuth owns sign-in, account binding, checkout confirmation, file
storage, and fulfillment routing.

The app defaults to `https://ottoauth.vercel.app`. Set
`OTTOAUTH_BASE_URL=http://127.0.0.1:3000` only when developing OttoAuth itself.
