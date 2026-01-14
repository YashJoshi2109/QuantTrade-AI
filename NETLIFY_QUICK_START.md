# Netlify Deployment Quick Start

## Quick Setup for Netlify

### 1. Connect Your Repository

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Click **"Add new site"** → **"Import an existing project"**
3. Connect your Git repository
4. Configure build settings:

**Build settings:**
- **Base directory**: `frontend`
- **Build command**: `npm install && npm run build` (or just leave default)
- **Publish directory**: `.next` (auto-detected by Next.js plugin)
- **Node version**: `20`

### 2. Install Next.js Plugin

Netlify should auto-detect and install `@netlify/plugin-nextjs`. If not:

1. Go to Site settings → Plugins
2. Click "Install plugin"
3. Search for "@netlify/plugin-nextjs"
4. Install it

### 3. Environment Variables

In Netlify → **Site settings** → **Environment variables**, add:

```env
# Your backend API URL (where FastAPI is hosted)
NEXT_PUBLIC_API_URL=https://your-backend.railway.app

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 4. Database Setup (Already Done!)

✅ Your Neon database is already configured via Netlify extension
✅ Database URL is available as `NETLIFY_DATABASE_URL`
✅ Backend will automatically use it

### 5. Deploy Backend Separately

**Recommended: Deploy backend to Railway/Render/Fly.io**

1. **Railway** (easiest):
   - Go to https://railway.app
   - New Project → Deploy from GitHub
   - Select your repository
   - Set root directory: `backend`
   - Add environment variables (see below)

2. **Environment Variables for Backend:**
   ```env
   DATABASE_URL=$NETLIFY_DATABASE_URL  # Copy from Netlify env vars
   SECRET_KEY=your-super-secret-key-here
   ANTHROPIC_API_KEY=your-key
   ALPHA_VANTAGE_API_KEY=your-key
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

3. **Update Frontend ENV:**
   - Go back to Netlify
   - Update `NEXT_PUBLIC_API_URL` to your Railway backend URL

### 6. Deploy!

Click **"Deploy site"** in Netlify. That's it! 🚀

## Verify Deployment

1. ✅ Frontend loads at your Netlify URL
2. ✅ API calls work (check browser console)
3. ✅ Google OAuth works
4. ✅ Database connection works

## Troubleshooting

**Build fails?**
- Check Node version is 20
- Verify `package.json` is in `frontend/` directory
- Check build logs in Netlify dashboard

**API not working?**
- Verify `NEXT_PUBLIC_API_URL` is set correctly
- Check CORS settings in backend
- Ensure backend is publicly accessible

**Database connection issues?**
- Copy `NETLIFY_DATABASE_URL` from Netlify to backend env vars
- Verify database is running in Neon dashboard

See `NETLIFY_DEPLOYMENT.md` for detailed instructions.
