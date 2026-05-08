# OttoAuth STL Print Order Demo

This is a minimal localhost app for ordering a 3D print from an STL file through
OttoAuth hosted checkout.

```bash
cd examples/stl-print-order
npm start
```

Open `http://127.0.0.1:5179`.

The app reads an STL in the browser, estimates rough volume/bounds when possible,
then stages one short-lived localhost handoff. Pressing checkout navigates
immediately to OttoAuth, where `/checkout/import` loads the staged order,
uploads the STL into OttoAuth file storage, creates the hosted checkout, and
continues through sign-in/confirmation. The local app does not hold an OttoAuth
private key, start Connect, or manage local credentials.

The app defaults to `https://ottoauth.vercel.app`. Set
`OTTOAUTH_BASE_URL=http://127.0.0.1:3000` only when developing OttoAuth itself.
