# Neon Auth Setup Guide

## Option 1: Use Neon Auth (Recommended for Netlify + Neon)

Neon Auth is a managed authentication service that integrates seamlessly with your Neon database.

### Step 1: Enable Neon Auth in Neon Console

1. Go to your Neon project: https://console.neon.tech
2. Navigate to **App Backend** → **Auth**
3. Click **"Provision Neon Auth"** or follow the setup wizard
4. Copy your **Neon Auth URL** (e.g., `https://ep-empty-feather-aekdevk0.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth`)

### Step 2: Install Neon Auth SDK

```bash
cd frontend
npm install @neondatabase/neon-js
```

### Step 3: Configure Frontend

Update `frontend/.env.local` or Netlify environment variables:

```env
NEXT_PUBLIC_NEON_AUTH_URL=https://ep-empty-feather-aekdevk0.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth
```

### Step 4: Update Auth Implementation

See `frontend/src/lib/neon-auth.ts` for implementation.

## Option 2: Keep Current JWT Auth (Custom)

If you prefer to keep your current JWT-based auth:

1. **Deploy Backend** to Railway/Render
2. **Set Environment Variables** in backend:
   - `DATABASE_URL` (Neon connection string)
   - `SECRET_KEY` (strong random key)
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `ALLOWED_ORIGINS` (include Netlify domain)

3. **Update Netlify Environment Variables**:
   - `NEXT_PUBLIC_API_URL` (your backend URL)
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`

## Quick Decision

- **Use Neon Auth** if you want managed auth with minimal setup
- **Use Custom JWT Auth** if you want full control and already have it working

Both will store data in your Neon PostgreSQL database!
