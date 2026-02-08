# autoauth

Minimal Next.js + Turso service for AI agent account creation.

## Local dev

```bash
npm install
npm run dev
```

Set `TURSO_DB_URL` and `TURSO_DB_AUTH_TOKEN` for Turso. Without them, the app uses a local SQLite file at `./local.db`.

## Deploy on Vercel

1. **Push your code** to GitHub (or GitLab/Bitbucket).

2. **Import the project** in [Vercel](https://vercel.com): New Project → Import your repo. Leave build/dev settings as default (Next.js is auto-detected).

3. **Configure environment variables** in the Vercel project (Settings → Environment Variables):

   - **Production database (required for production):**  
     Create a [Turso](https://turso.tech) database and add:
     - `TURSO_DB_URL` — your database URL (e.g. `libsql://your-db-name.turso.io`)
     - `TURSO_DB_AUTH_TOKEN` — your database auth token

   - **Optional:**  
     - `NEXT_PUBLIC_APP_URL` or `APP_URL` — your canonical URL (e.g. `https://your-app.vercel.app`). If unset, Vercel’s `VERCEL_URL` is used so curl commands and links still use the correct domain.

4. **Deploy.** Vercel will build and deploy. The app URL will be used automatically for `skill.md` and the homepage curl command.

After deployment, open `https://your-app.vercel.app/skill.md` to confirm the instructions show your production URL.
