# Google OAuth 2.0 Setup Guide

This guide will help you configure Google OAuth 2.0 for the AI Trading Copilot application.

## Step 1: Create OAuth 2.0 Client in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services** > **Credentials**
4. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
5. If prompted, configure the OAuth consent screen first:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in the required fields (App name, User support email, Developer contact)
   - Add scopes: `email`, `profile`, `openid`
   - Add test users if in testing mode

## Step 2: Configure OAuth Client

When creating the OAuth client ID:

### Application Type
- Select: **Web application**

### Name
- Enter: **Finance-2.0** (or any name you prefer)

### Authorized JavaScript origins
Click **+ Add URI** and add:
```
http://localhost:3000
```
For production, also add:
```
https://yourdomain.com
```

### Authorized redirect URIs
Click **+ Add URI** and add:
```
http://localhost:3000/auth/callback
```
For production, also add:
```
https://yourdomain.com/auth/callback
```

**Note:** The redirect URI is actually not used with Google Identity Services (the new client-side flow), but it's good to have it configured.

## Step 3: Get Your Credentials

After creating the OAuth client:

1. You'll see a popup with your **Client ID** and **Client Secret**
2. Copy both values (you can also find them later in the Credentials page)

## Step 4: Configure Environment Variables

### Backend (.env file in `/backend`)

Add these to your `backend/.env` file:

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

### Frontend (.env.local file in `/frontend`)

Create or update `frontend/.env.local`:

```env
# Google OAuth Client ID (for frontend)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
```

**Important:** 
- The frontend only needs the Client ID (public)
- The backend needs both Client ID and Client Secret
- Never commit `.env` or `.env.local` files to version control

## Step 5: Install Backend Dependencies

The backend requires Google OAuth libraries. Install them:

```bash
cd backend
source venv/bin/activate
pip install google-auth google-auth-oauthlib google-auth-httplib2
```

Or they should be installed automatically from `requirements.txt`.

## Step 6: Restart Servers

After configuring the environment variables:

1. **Backend**: Restart the FastAPI server
   ```bash
   cd backend
   source venv/bin/activate
   uvicorn app.main:app --reload --port 8000
   ```

2. **Frontend**: Restart the Next.js dev server
   ```bash
   cd frontend
   npm run dev
   ```

## Step 7: Test Google Login

1. Navigate to `http://localhost:3000/auth`
2. You should see a "Sign in with Google" button
3. Click it and complete the Google sign-in flow
4. You should be redirected to the dashboard after successful authentication

## Troubleshooting

### "Google OAuth is not configured"
- Make sure `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set in `frontend/.env.local`
- Restart the frontend dev server after adding the variable

### "GOOGLE_CLIENT_ID not configured"
- Make sure `GOOGLE_CLIENT_ID` is set in `backend/.env`
- Restart the backend server after adding the variable

### "Invalid Google token"
- Verify your Client ID matches in both frontend and backend
- Make sure you're using the correct Client ID (not Client Secret) in the frontend
- Check that the OAuth consent screen is properly configured

### CORS Errors
- Make sure `http://localhost:3000` is in your Authorized JavaScript origins
- Check that the backend CORS settings include `http://localhost:3000`

## Security Notes

1. **Client Secret**: Never expose the Client Secret in frontend code
2. **HTTPS in Production**: Always use HTTPS in production
3. **Token Verification**: The backend verifies all Google tokens server-side
4. **Environment Variables**: Keep `.env` files secure and never commit them

## How It Works

1. User clicks "Sign in with Google" button
2. Google Identity Services (loaded client-side) shows the Google sign-in popup
3. User authenticates with Google
4. Google returns an ID token (credential)
5. Frontend sends the credential to backend `/api/v1/auth/google/verify`
6. Backend verifies the token with Google's servers
7. Backend creates/updates user account and returns JWT token
8. Frontend stores the JWT token and redirects to dashboard
