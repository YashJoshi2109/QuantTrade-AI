# ✅ Quick Deploy Checklist

## 🔐 Your Configuration

- **Secret Key**: `7730eae563847420772c890ecb062bb7` ✅
- **Database**: Render PostgreSQL ✅ (Initialized)
- **Frontend**: Netlify ✅
- **Backend**: Deploy to Render (next step)

## 📋 Render Deployment (5 minutes)

### Step 1: Create Web Service
1. Go to https://render.com
2. **New +** → **Web Service**
3. Connect GitHub repo
4. Settings:
   - **Root Directory**: `backend`
   - **Build**: `pip install -r requirements.txt`
   - **Start**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Step 2: Environment Variables
Add these in Render → Environment tab:

```env
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
SECRET_KEY=7730eae563847420772c890ecb062bb7
ANTHROPIC_API_KEY=your-key
ALPHA_VANTAGE_API_KEY=your-key
ALLOWED_ORIGINS=https://sunny-hamster-0012a0.netlify.app,http://localhost:3000
```

### Step 3: Deploy
- Click **"Create Web Service"**
- Wait 2-5 minutes
- Copy your backend URL (e.g., `https://finance-backend.onrender.com`)

## 🌐 Netlify Update (1 minute)

1. Netlify → Site settings → **Environment variables**
2. Add:
   ```env
   NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
   ```
3. **Trigger new deploy**

## ✅ Test (30 seconds)

Open browser console on your live site:
```javascript
const API = 'https://your-backend.onrender.com';
fetch(API + '/health')
  .then(r => r.json())
  .then(d => console.log('✅ Backend:', d));
```

## 🎯 Checklist

- [ ] Backend deployed on Render
- [ ] Environment variables set
- [ ] Backend URL copied
- [ ] `NEXT_PUBLIC_API_URL` set in Netlify
- [ ] Health endpoint works
- [ ] Market status works
- [ ] Registration works
- [ ] Data saves to database

---

**That's it!** Your app will be live! 🚀
