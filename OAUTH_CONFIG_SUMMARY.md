# Google OAuth Configuration Summary

## What to Put in Google OAuth Client Configuration

When creating your OAuth 2.0 client in Google Cloud Console:

### 1. Application Type
- **Web application**

### 2. Name
- **Finance-2.0** (or any name)

### 3. Authorized JavaScript origins
Add these URIs:
```
http://localhost:3000
```
For production:
```
https://yourdomain.com
```

### 4. Authorized redirect URIs
Add these URIs:
```
http://localhost:3000/auth/callback
```
For production:
```
https://yourdomain.com/auth/callback
```

**Note:** With Google Identity Services (new client-side flow), redirect URIs are less critical, but still recommended.

## Environment Variables Needed

### Backend (`backend/.env`)
```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

## Quick Setup Steps

1. ✅ Create OAuth client in Google Cloud Console
2. ✅ Copy Client ID and Client Secret
3. ✅ Add Client ID to `frontend/.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
4. ✅ Add Client ID and Secret to `backend/.env`
5. ✅ Install backend dependencies: `pip install google-auth google-auth-oauthlib google-auth-httplib2`
6. ✅ Restart both servers

See `GOOGLE_OAUTH_SETUP.md` for detailed instructions.
