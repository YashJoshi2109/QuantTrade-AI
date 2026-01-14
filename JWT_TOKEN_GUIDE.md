# JWT Token Guide

## Quick Token Generation

### Option 1: Using the Script (Easiest)

```bash
cd backend
source venv/bin/activate
python scripts/generate_jwt.py --user-id 1
```

**Example output:**
```
🔑 Generated JWT Token:
============================================================
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzY4OTYyODc3LCJpYXQiOjE3NjgzNTgwNzd9.D7TSp7jv62slaFplDSen3jiiVZeqaXrMu3047lzTgHA
```

### Option 2: Get Token via API (Login)

**Register a user:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "testpass123",
    "full_name": "Test User"
  }'
```

**Login to get token:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpass123"
  }'
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "test@example.com",
    "username": "testuser",
    ...
  }
}
```

### Option 3: Google OAuth Token

After Google login, the frontend automatically receives a token and stores it in localStorage.

## Using the Token

### Test Token in API Calls

```bash
# Get current user info
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  http://localhost:8000/api/v1/auth/me

# Use in protected endpoints
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  http://localhost:8000/api/v1/watchlist
```

### In Frontend (JavaScript)

```javascript
// Token is automatically stored after login
const token = localStorage.getItem('auth_token');

// Use in API calls
fetch('http://localhost:8000/api/v1/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
```

## Decode a Token

To see what's inside a token:

```bash
python scripts/generate_jwt.py --decode 'YOUR_TOKEN_HERE'
```

**Example:**
```bash
python scripts/generate_jwt.py --decode 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Output:**
```
🔓 Decoding JWT Token:
============================================================
✅ Token is valid!

📋 Payload:
   User ID: 1
   Issued At: 2026-01-13T22:30:00
   Expires At: 2026-01-20T22:30:00
```

## Token Structure

A JWT token has 3 parts separated by dots:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzY4OTYyODc3LCJpYXQiOjE3NjgzNTgwNzd9.D7TSp7jv62slaFplDSen3jiiVZeqaXrMu3047lzTgHA
│─────────────────────────────────││──────────────────────────────────────────││──────────────────────────────────────────│
         Header (Base64)                      Payload (Base64)                          Signature
```

**Header:**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload:**
```json
{
  "sub": "1",           // User ID
  "exp": 1768962877,    // Expiration timestamp
  "iat": 1768358077     // Issued at timestamp
}
```

## Token Expiration

- **Default**: 7 days
- **Configurable**: Set `ACCESS_TOKEN_EXPIRE_MINUTES` in `backend/app/config.py` or `.env`

## Security Notes

⚠️ **Important:**
- Never commit tokens to version control
- Use HTTPS in production
- Tokens expire automatically
- Change `SECRET_KEY` in production
- Store tokens securely (localStorage for web, secure storage for mobile)

## Generate Production Secret Key

```bash
# Generate a secure random secret key
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Add to your `.env`:
```env
SECRET_KEY=your-generated-secret-key-here
```

## Troubleshooting

**Token expired?**
- Generate a new token by logging in again
- Or use the script: `python scripts/generate_jwt.py --user-id 1 --expires-days 30`

**Invalid token?**
- Check the token hasn't expired
- Verify `SECRET_KEY` matches between token generation and verification
- Ensure token is properly formatted (3 parts separated by dots)

**Token not working?**
- Check Authorization header format: `Bearer YOUR_TOKEN`
- Verify backend is using the same `SECRET_KEY`
- Check token hasn't been tampered with
