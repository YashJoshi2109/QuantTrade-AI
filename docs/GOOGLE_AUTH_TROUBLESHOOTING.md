# Google OAuth Troubleshooting Guide

## Common Issues & Fixes

### 1. **Client ID Mismatch**
- **Frontend**: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` must match your Google Console Client ID
- **Backend**: `GOOGLE_CLIENT_ID` must be **identical** (used for token verification)
- Example: `519313922874-alldopga918lia420p2gpku4pusnsret.apps.googleusercontent.com`

### 2. **Authorized JavaScript Origins** (Critical for One Tap / Sign-In Button)
Your app's exact origin must be listed in [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- `https://quanttrade.us`
- `https://www.quanttrade.us`
- `http://localhost:3000` (for local dev)

**No trailing slashes.** Must match exactly.

### 3. **Authorized Redirect URIs**
For the credential-based flow (Sign-In button), redirect URIs are less critical, but ensure:
- No typo: `https://www.www.quanttrade.us` ❌ (double www)
- Correct: `https://www.quanttrade.us/api/v1/auth/google/callback` ✓

### 4. **CORS**
Backend `ALLOWED_ORIGINS` must include your frontend:
```
https://quanttrade.us,https://www.quanttrade.us,http://localhost:3000
```

### 5. **Multiple Client Secrets**
If you have 2+ client secrets enabled, ensure your app uses the **currently enabled** one. Consider disabling/removing old secrets.

### 6. **API URL for Token Verification**
The frontend sends the credential to: `{NEXT_PUBLIC_API_URL}/api/v1/auth/google/verify`

Ensure `NEXT_PUBLIC_API_URL` points to your backend (e.g. `https://www.quanttrade.us` if API is on same domain).

### 7. **Testing Checklist**
- [ ] Client ID matches in .env (frontend + backend)
- [ ] JavaScript origins include your domain
- [ ] No ad-blockers blocking Google scripts
- [ ] Console: Check for `Failed to get Google credential` or CORS errors
- [ ] Try incognito to rule out cached/session issues
