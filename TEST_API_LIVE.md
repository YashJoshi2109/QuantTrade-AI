# 🧪 How to Test API on Live Website

## Quick Tests

### 1. **Browser Console Test** (Easiest)

1. Open your live site: https://sunny-hamster-0012a0.netlify.app/
2. Press `F12` (or `Cmd+Option+I` on Mac) to open Developer Tools
3. Go to **Console** tab
4. Paste this code and press Enter:

```javascript
// Test API connection
const API_URL = 'https://your-backend.railway.app'; // Replace with your backend URL

// Test 1: Health check
fetch(`${API_URL}/health`)
  .then(r => r.json())
  .then(data => console.log('✅ Health:', data))
  .catch(err => console.error('❌ Health failed:', err));

// Test 2: Market status
fetch(`${API_URL}/api/v1/market/status`)
  .then(r => r.json())
  .then(data => console.log('✅ Market Status:', data))
  .catch(err => console.error('❌ Market Status failed:', err));

// Test 3: Market sectors
fetch(`${API_URL}/api/v1/market/sectors`)
  .then(r => r.json())
  .then(data => console.log('✅ Sectors:', data.length, 'sectors'))
  .catch(err => console.error('❌ Sectors failed:', err));
```

**What to look for:**
- ✅ Green checkmarks = API working
- ❌ Red X = API not working (check backend URL)

### 2. **Network Tab Inspection**

1. Open Developer Tools (`F12`)
2. Go to **Network** tab
3. Refresh the page
4. Look for requests to `/api/v1/...`
5. Click on any request to see:
   - **Status**: Should be `200` (success) or `404`/`500` (error)
   - **Response**: Click "Response" tab to see data
   - **Headers**: Check if `NEXT_PUBLIC_API_URL` is correct

**Common Issues:**
- `Failed to fetch` = Backend not deployed or CORS issue
- `404 Not Found` = Wrong API URL
- `500 Internal Server Error` = Backend error (check backend logs)

### 3. **Direct API URL Test**

Open these URLs directly in your browser (replace with your backend URL):

```
# Health check (should return JSON)
https://your-backend.railway.app/health

# Market status
https://your-backend.railway.app/api/v1/market/status

# Market sectors (may be large)
https://your-backend.railway.app/api/v1/market/sectors
```

**Expected Response:**
```json
{
  "status": "healthy"
}
```

### 4. **Check Environment Variables**

1. In Netlify Dashboard:
   - Go to **Site settings** → **Environment variables**
   - Verify `NEXT_PUBLIC_API_URL` is set correctly
   - Should be: `https://your-backend.railway.app` (no trailing slash)

2. In Browser Console:
```javascript
// Check if environment variable is set
console.log('API URL:', process.env.NEXT_PUBLIC_API_URL);
// Or in browser:
console.log('API URL:', window.location.origin);
```

### 5. **Test from Terminal (curl)**

```bash
# Replace with your backend URL
BACKEND_URL="https://your-backend.railway.app"

# Health check
curl $BACKEND_URL/health

# Market status
curl $BACKEND_URL/api/v1/market/status

# Market sectors (first 100 chars)
curl $BACKEND_URL/api/v1/market/sectors | head -c 100
```

## 🔍 Troubleshooting

### Issue: "Failed to fetch" or CORS error

**Solution:**
1. Check backend `ALLOWED_ORIGINS` includes your Netlify domain
2. Backend should have: `ALLOWED_ORIGINS=https://sunny-hamster-0012a0.netlify.app`
3. Restart backend after changing CORS settings

### Issue: "404 Not Found"

**Solution:**
1. Check `NEXT_PUBLIC_API_URL` in Netlify environment variables
2. Verify backend is deployed and running
3. Test backend URL directly: `https://your-backend.railway.app/health`

### Issue: "500 Internal Server Error"

**Solution:**
1. Check backend logs (Railway/Render dashboard)
2. Verify database connection (`DATABASE_URL` is set)
3. Check if all environment variables are set

### Issue: API returns empty data

**Solution:**
1. Check if `ALPHA_VANTAGE_API_KEY` is set in backend
2. Check backend logs for API errors
3. May be rate limited (Alpha Vantage has limits)

## ✅ Quick Checklist

- [ ] Backend is deployed and running
- [ ] `NEXT_PUBLIC_API_URL` is set in Netlify
- [ ] Backend `ALLOWED_ORIGINS` includes Netlify domain
- [ ] Health endpoint works: `/health`
- [ ] Market status endpoint works: `/api/v1/market/status`
- [ ] No CORS errors in browser console
- [ ] Network tab shows successful API calls

## 🎯 Test Script

Save this as `test-api.html` and open in browser:

```html
<!DOCTYPE html>
<html>
<head>
    <title>API Test</title>
</head>
<body>
    <h1>API Test</h1>
    <input type="text" id="apiUrl" placeholder="Backend URL" value="https://your-backend.railway.app" style="width: 400px;">
    <button onclick="testAPI()">Test API</button>
    <pre id="results"></pre>

    <script>
        async function testAPI() {
            const url = document.getElementById('apiUrl').value;
            const results = document.getElementById('results');
            results.textContent = 'Testing...\n\n';

            const tests = [
                { name: 'Health', endpoint: '/health' },
                { name: 'Market Status', endpoint: '/api/v1/market/status' },
                { name: 'Market Sectors', endpoint: '/api/v1/market/sectors' }
            ];

            for (const test of tests) {
                try {
                    const response = await fetch(url + test.endpoint);
                    const data = await response.json();
                    results.textContent += `✅ ${test.name}: ${response.status}\n`;
                    results.textContent += JSON.stringify(data, null, 2).substring(0, 200) + '\n\n';
                } catch (error) {
                    results.textContent += `❌ ${test.name}: ${error.message}\n\n`;
                }
            }
        }
    </script>
</body>
</html>
```

## 📊 Expected Results

### Health Endpoint
```json
{
  "status": "healthy"
}
```

### Market Status
```json
{
  "is_open": true,
  "status": "OPEN",
  "current_time_et": "2024-01-13 14:30:00 EST",
  "market_open": "09:30 ET",
  "market_close": "16:00 ET",
  "is_weekday": true,
  "exchanges": {
    "NYSE": true,
    "NASDAQ": true
  }
}
```

### Market Sectors
```json
[
  {
    "sector": "Technology",
    "change_percent": 1.23,
    "stocks": [...]
  },
  ...
]
```

---

**Quick Test:** Open browser console on your live site and run the test code above! 🚀
