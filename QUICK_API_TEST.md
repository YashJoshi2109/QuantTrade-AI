# ⚡ Quick API Test (30 seconds)

## Method 1: Browser Console (Fastest)

1. **Open your live site**: https://sunny-hamster-0012a0.netlify.app/
2. **Press F12** (or Cmd+Option+I on Mac)
3. **Go to Console tab**
4. **Paste this code** (replace with your backend URL):

```javascript
const API = 'https://your-backend.railway.app'; // ⬅️ CHANGE THIS

// Test health
fetch(API + '/health')
  .then(r => r.json())
  .then(d => console.log('✅ Health:', d))
  .catch(e => console.error('❌ Health failed:', e));
```

**If you see `✅ Health: {status: "healthy"}` → API is working!**

## Method 2: Direct URL Test

Open this in a new browser tab (replace URL):

```
https://your-backend.railway.app/health
```

**If you see JSON → API is working!**

## Method 3: Use Test Tool

1. Open `test-api.html` in your browser
2. Enter your backend URL
3. Click "Test All Endpoints"
4. See results instantly!

## Common Issues

| Error | Meaning | Fix |
|-------|---------|-----|
| `Failed to fetch` | Backend not deployed | Deploy backend to Railway/Render |
| `404 Not Found` | Wrong URL | Check `NEXT_PUBLIC_API_URL` in Netlify |
| `CORS error` | Backend CORS not configured | Add Netlify domain to `ALLOWED_ORIGINS` |
| `500 Error` | Backend error | Check backend logs |

## ✅ Success Looks Like:

```json
{
  "status": "healthy"
}
```

---

**That's it!** If you see JSON responses, your API is working! 🎉
