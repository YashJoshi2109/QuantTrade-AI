# Netlify Deployment Guide

This guide will help you deploy your AI Trading Copilot to Netlify.

## Overview

Your application consists of:
- **Frontend**: Next.js app (deploy to Netlify)
- **Backend**: FastAPI app (can deploy separately or use Netlify Functions)
- **Database**: Neon PostgreSQL (already configured via Netlify extension)

## Prerequisites

✅ Neon database extension installed in Netlify  
✅ Environment variables set up in Netlify  
✅ Git repository ready for deployment

## Deployment Steps

### 1. Frontend Deployment (Netlify)

#### Option A: Deploy via Netlify UI

1. **Connect Repository**
   - Go to [Netlify Dashboard](https://app.netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Connect your Git repository

2. **Configure Build Settings**
   - **Base directory**: `frontend`
   - **Build command**: `npm install && npm run build`
   - **Publish directory**: `frontend/.next`
   - **Node version**: `20`

3. **Environment Variables**
   Add these in Netlify → Site settings → Environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend-url.com
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   ```

#### Option B: Deploy via Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy frontend
cd frontend
netlify deploy --prod
```

### 2. Backend Deployment Options

#### Option A: Separate Backend Hosting (Recommended)

Deploy backend separately on services like:
- **Railway**: https://railway.app
- **Render**: https://render.com
- **Fly.io**: https://fly.io
- **DigitalOcean App Platform**: https://www.digitalocean.com/products/app-platform

**Environment Variables for Backend:**
```env
DATABASE_URL=$NETLIFY_DATABASE_URL  # Use Netlify's Neon DB
SECRET_KEY=your-production-secret-key
ANTHROPIC_API_KEY=your-key
ALPHA_VANTAGE_API_KEY=your-key
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Then update `NEXT_PUBLIC_API_URL` in Netlify to point to your backend URL.

#### Option B: Netlify Functions (Serverless)

If you want to deploy backend as Netlify Functions:

1. Install Netlify Functions plugin for Python
2. Convert FastAPI routes to serverless functions
3. This is more complex but keeps everything in one place

### 3. Database Configuration

Your Neon database is already configured via Netlify extension:
- ✅ Database URL available as `NETLIFY_DATABASE_URL`
- ✅ Also available as `NETLIFY_DATABASE_URL_UNPOOLED`

**Backend will automatically use `NETLIFY_DATABASE_URL` if available.**

### 4. Environment Variables in Netlify

#### Frontend Environment Variables
In Netlify → Site settings → Environment variables:

```
# API URL (point to your backend)
NEXT_PUBLIC_API_URL=https://your-backend-api.railway.app

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

#### Backend Environment Variables
(If deploying backend separately)

```
# Database (automatically uses NETLIFY_DATABASE_URL if deployed on Netlify)
DATABASE_URL=$NETLIFY_DATABASE_URL

# JWT
SECRET_KEY=your-super-secret-production-key-here

# API Keys
ANTHROPIC_API_KEY=your-anthropic-key
ALPHA_VANTAGE_API_KEY=your-alpha-vantage-key

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 5. Update Google OAuth Settings

In Google Cloud Console, update your OAuth client:

**Authorized JavaScript origins:**
```
https://your-netlify-site.netlify.app
https://your-custom-domain.com
```

**Authorized redirect URIs:**
```
https://your-netlify-site.netlify.app/auth/callback
https://your-custom-domain.com/auth/callback
```

### 6. CORS Configuration

Make sure your backend CORS settings allow your Netlify domain:

```python
# backend/app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://your-netlify-site.netlify.app",
        "https://your-custom-domain.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Quick Deploy Checklist

### Frontend (Netlify)
- [ ] Repository connected to Netlify
- [ ] Build settings configured (base: `frontend`)
- [ ] Environment variables set (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`)
- [ ] Site deployed successfully

### Backend (Separate Hosting)
- [ ] Backend deployed to Railway/Render/Fly.io
- [ ] Database URL configured (use `NETLIFY_DATABASE_URL`)
- [ ] All API keys configured
- [ ] CORS updated to allow Netlify domain
- [ ] Backend URL updated in Netlify frontend env vars

### Database
- [ ] Neon extension installed in Netlify
- [ ] Database created and accessible
- [ ] Connection strings available as env vars

### Google OAuth
- [ ] OAuth client updated with production URLs
- [ ] Client ID added to both frontend and backend env vars
- [ ] Client Secret added to backend env vars

## Testing Deployment

1. **Test Frontend**
   - Visit your Netlify site URL
   - Verify pages load correctly
   - Test navigation

2. **Test Authentication**
   - Try Google OAuth login
   - Test email/password login
   - Verify JWT tokens work

3. **Test API**
   - Check that API calls go to backend
   - Verify CORS works
   - Test AI Copilot chat

4. **Test Database**
   - Verify database connection
   - Test user registration
   - Check data persistence

## Troubleshooting

### Build Failures
- Check Node version (should be 20)
- Verify all dependencies in `package.json`
- Check build logs in Netlify dashboard

### API Connection Issues
- Verify `NEXT_PUBLIC_API_URL` is set correctly
- Check CORS settings in backend
- Ensure backend is accessible publicly

### Database Connection Issues
- Verify `NETLIFY_DATABASE_URL` is available
- Check database is running in Neon
- Test connection from backend

### OAuth Issues
- Verify OAuth redirect URIs match your domain
- Check Client ID is correct in env vars
- Ensure backend can verify tokens

## Production Checklist

- [ ] Use strong `SECRET_KEY` for JWT
- [ ] Enable HTTPS everywhere
- [ ] Set up custom domain
- [ ] Configure error tracking (Sentry, etc.)
- [ ] Set up monitoring and logging
- [ ] Enable database backups
- [ ] Review and tighten CORS settings
- [ ] Set up CI/CD pipeline
- [ ] Configure staging environment

## Support

- Netlify Docs: https://docs.netlify.com
- Neon Docs: https://neon.tech/docs
- Next.js Deployment: https://nextjs.org/docs/deployment
