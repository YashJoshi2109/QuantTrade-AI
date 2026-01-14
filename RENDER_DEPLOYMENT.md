# 🚀 Render Deployment Guide

## ✅ Database Status

Your Render PostgreSQL database is **ready**:
- **Database**: `finance_r6b5`
- **Region**: Oregon (US West)
- **Status**: All tables created ✅
- **External URL**: For local development
- **Internal URL**: For Render services (auto-detected)

## 📋 Deploy Backend to Render

### Step 1: Create Web Service

1. Go to https://render.com → Dashboard
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `finance-backend` (or any name)
   - **Region**: `Oregon (US West)` (same as database)
   - **Branch**: `main` (or your branch)
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Step 2: Set Environment Variables

In Render dashboard → Your service → **Environment** tab, add:

```env
# Database (Use INTERNAL URL for Render services)
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5

# JWT Secret Key
SECRET_KEY=7730eae563847420772c890ecb062bb7

# API Keys
ANTHROPIC_API_KEY=your-anthropic-key
ALPHA_VANTAGE_API_KEY=your-alpha-vantage-key

# Google OAuth (if using)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# CORS (your Netlify domain)
ALLOWED_ORIGINS=https://sunny-hamster-0012a0.netlify.app,http://localhost:3000

# App Settings
DEBUG=false
LOG_LEVEL=INFO
```

**Important**: Use **INTERNAL** database URL when deploying on Render!

### Step 3: Link Database

1. In Render dashboard → Your database
2. Go to **"Connections"** tab
3. Your backend service should auto-link
4. Or manually link: Service → **"Link Resource"** → Select database

### Step 4: Deploy

1. Click **"Save Changes"**
2. Render will automatically deploy
3. Wait for deployment to complete (2-5 minutes)
4. Copy your service URL (e.g., `https://finance-backend.onrender.com`)

## 🔗 Update Netlify

1. Go to Netlify → Site settings → **Environment variables**
2. Add/Update:
   ```env
   NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
   ```
3. **Trigger a new deploy** (or push a commit)

## ✅ Verify Deployment

### Test Backend

```bash
# Health check
curl https://your-backend.onrender.com/health

# Market status
curl https://your-backend.onrender.com/api/v1/market/status
```

### Test from Browser

1. Open browser console on your live site
2. Run:
```javascript
const API = 'https://your-backend.onrender.com';
fetch(API + '/health')
  .then(r => r.json())
  .then(d => console.log('✅ Backend:', d))
  .catch(e => console.error('❌ Failed:', e));
```

## 📊 Database Connection URLs

### External (Local Development)
```
postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5
```
Use this for:
- Local development
- Running scripts locally
- Testing from your machine

### Internal (Render Services)
```
postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```
Use this for:
- Backend deployed on Render
- Render auto-detects this when services are linked

## 🔧 Troubleshooting

### Database Connection Failed

**Issue**: Backend can't connect to database

**Solution**:
1. Verify database status is "Available" in Render
2. Check `DATABASE_URL` uses **internal** URL (no `.oregon-postgres.render.com`)
3. Ensure database and backend are in same region
4. Check if database is linked to service

### CORS Errors

**Issue**: Frontend can't call backend API

**Solution**:
1. Verify `ALLOWED_ORIGINS` includes Netlify domain
2. Check `NEXT_PUBLIC_API_URL` in Netlify
3. Restart backend after changing CORS

### Service Won't Start

**Issue**: Backend deployment fails

**Solution**:
1. Check build logs in Render dashboard
2. Verify all environment variables are set
3. Check `requirements.txt` is in `backend/` directory
4. Verify Python version (should be 3.11+)

## 📝 Quick Checklist

- [ ] Render database created and initialized ✅
- [ ] Backend service created on Render
- [ ] Environment variables set (use INTERNAL database URL)
- [ ] Database linked to backend service
- [ ] Backend deployed successfully
- [ ] Health endpoint works: `/health`
- [ ] `NEXT_PUBLIC_API_URL` set in Netlify
- [ ] Frontend can call backend API
- [ ] Market status endpoint works
- [ ] Authentication works (test registration)

## 🎯 Next Steps

1. **Deploy Backend** → Follow steps above
2. **Update Netlify** → Set `NEXT_PUBLIC_API_URL`
3. **Test Everything** → Use `test-api.html` or browser console
4. **Monitor** → Check Render logs for any errors

---

**Your Render database is ready!** Just deploy the backend and you're live! 🚀
