# Deployment Guide

## Recommended platform

Use `Render` for the backend API and either:

- Host the landing page static file `index.html` on `Hostinger`, or
- Point the main domain to Render and serve the landing page from the Node app.

## Environment variables

Set these on Render or Railway:

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `CORS_ORIGIN`
- `CLINIC_ADMIN_EMAIL`
- `BOOKING_AGENT_API_URL`

Do not commit real values.

## Render backend deploy

1. Create a new `Web Service` in Render.
2. Connect the GitHub repository.
3. Use:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
4. Set Node version to `20+`.
5. Add the environment variables above in Render's dashboard.
6. Deploy and confirm:
   - `GET /health`
   - `POST /api/agent/handle`

## Hostinger domain connection

### Option A: API on subdomain

Recommended:

- Main site: `https://canadataxpro.me`
- API: `https://api.canadataxpro.me`

DNS on Hostinger:

- Add `CNAME` record:
  - Host: `api`
  - Value: your Render service hostname, e.g. `your-service.onrender.com`

Then in Render:

1. Open your service settings.
2. Add custom domain: `api.canadataxpro.me`
3. Wait for Render SSL provisioning.

Set:

- `BOOKING_AGENT_API_URL=https://api.canadataxpro.me`
- `CORS_ORIGIN=https://canadataxpro.me`

### Option B: Full app on main domain

If you want backend and landing page under one host:

- Add `CNAME` or `A record` from `canadataxpro.me` / `www` to the Render target per Render instructions.
- Add custom domains in Render for both `canadataxpro.me` and `www.canadataxpro.me`.

## Landing page deployment

### Hostinger static hosting

Upload `index.html` to Hostinger public web root.

Use:

- Main marketing site on `https://yourdomain.com`
- Main marketing site on `https://canadataxpro.me`
- Backend API on `https://api.canadataxpro.me`

### Render-only hosting

Use the Express landing page route already in the app and map the main domain directly to Render.

## SDK live configuration

Example:

```js
import { bookOrOrder } from "universal-booking-sdk/sdk";

await bookOrOrder(
  {
    message: "2 burgers and coke",
    user_id: "customer-1",
    tenant_id: "tenant_abc",
  },
  {
    apiKey: "tenant_api_key",
    backendUrl: "https://api.canadataxpro.me",
  }
);
```

## Public validation checklist

After deployment confirm:

1. `https://api.canadataxpro.me/health` returns JSON
2. `POST https://api.canadataxpro.me/api/agent/handle` returns structured JSON
3. Invalid or missing API key returns:
   - `{ "error": "Unauthorized tenant" }`
4. Main site loads over HTTPS
5. SDK calls the live production API URL
