# 🔐 Render Environment Variables

## Required Environment Variables

Copy these to Render dashboard → Your service → **Environment** tab:

```env
# Database (Use INTERNAL URL for Render)
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5

# JWT Secret Key
SECRET_KEY=7730eae563847420772c890ecb062bb7

# API Keys
ANTHROPIC_API_KEY=your-anthropic-api-key
ALPHA_VANTAGE_API_KEY=your-alpha-vantage-api-key

# Google OAuth (if using)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# CORS (your Netlify domain)
ALLOWED_ORIGINS=https://sunny-hamster-0012a0.netlify.app,http://localhost:3000

# App Settings
DEBUG=false
LOG_LEVEL=INFO
```

## ⚠️ Security Notes

1. **SECRET_KEY**: The provided key is set as default. For production, consider:
   - Using a longer, randomly generated key
   - Storing it only in environment variables (not in code)
   - Never committing secrets to Git

2. **Generate Stronger Secret Key** (optional):
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. **Database URL**: 
   - Use **INTERNAL** URL when deploying on Render (faster, same network)
   - Use **EXTERNAL** URL for local development

## 📋 Quick Setup

1. Go to Render dashboard → Your backend service
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Add each variable from the list above
5. Click **"Save Changes"**
6. Service will auto-redeploy

## ✅ Verification

After setting variables, check logs to ensure:
- Database connection successful
- No "SECRET_KEY" warnings
- CORS configured correctly
- API keys loaded

---

**All set!** Your backend will use these variables when deployed. 🚀
