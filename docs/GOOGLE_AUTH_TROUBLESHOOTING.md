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

### 7. **"Failed to load the initial data" (Google button / One Tap)**

This message comes from **Google Identity Services** (browser), not from our API. Common causes:

- **FedCM / third-party cookies**: Browsers in strict privacy mode may block GIS FedCM. The app sets `use_fedcm_for_prompt: false` to reduce this; try Chrome with default settings or another browser.
- **Blocked `accounts.google.com`**: Ad blockers, corporate proxies, or VPNs can block the GSI script—check the Network tab for `gsi/client`.
- **Wrong origin**: JavaScript origins in Google Cloud Console must match exactly (see §2)—no trailing slash.
- **Stale client ID**: Confirm `NEXT_PUBLIC_GOOGLE_CLIENT_ID` matches the OAuth client you use in production vs local.

Fallback: use **email + password** or **passkeys** if Google keeps failing.

### 8. **Game / API "cannot load" on first screen**

If the **game dashboard** spins then shows an error, open DevTools → Network and confirm:

- `GET {NEXT_PUBLIC_API_URL}/api/v1/game/bootstrap` returns **200** (not CORS failed / connection refused).
- Backend is running and `DATABASE_URL` is set so bootstrap can hit Postgres.

### 9. **Testing Checklist**
- [ ] Client ID matches in .env (frontend + backend)
- [ ] JavaScript origins include your domain
- [ ] No ad-blockers blocking Google scripts
- [ ] Console: Check for `Failed to get Google credential` or CORS errors
- [ ] Try incognito to rule out cached/session issues
- [ ] If you see "Failed to load the initial data", try another browser or disable strict tracking (see §7)
