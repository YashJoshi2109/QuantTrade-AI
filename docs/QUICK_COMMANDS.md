# Quick Commands Reference

## ⚠️ Important: Always Activate Virtual Environment First!

```bash
cd /Users/yash/Downloads/Finance/backend
source venv/bin/activate
```

After activation, you'll see `(venv)` in your prompt.

---

## 🚀 Starting the Backend

```bash
cd /Users/yash/Downloads/Finance/backend
source venv/bin/activate
uvicorn app.main:app --reload
```

Backend will be available at: **http://localhost:8000**
API docs at: **http://localhost:8000/docs**

---

## 📊 Syncing Data

### Sync News & Filings:
```bash
cd /Users/yash/Downloads/Finance/backend
source venv/bin/activate
python scripts/sync_news_filings.py
```

### Sync Price Data (if needed):
```bash
cd /Users/yash/Downloads/Finance/backend
source venv/bin/activate
python scripts/sync_data.py
```

---

## 🧪 Testing the API

### Health Check:
```bash
curl http://localhost:8000/health
```

### Get News:
```bash
curl http://localhost:8000/api/v1/news/AAPL
```

### Chat with Copilot:
```bash
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is Apple?", "symbol": "AAPL"}'
```

---

## 🐛 Troubleshooting

### "command not found: python"
**Solution:** Activate venv first:
```bash
cd backend
source venv/bin/activate
```

### "ModuleNotFoundError"
**Solution:** Make sure venv is activated and packages are installed:
```bash
cd backend
source venv/bin/activate
pip install -r requirements-core.txt
```

### "Database connection error"
**Solution:** Check PostgreSQL is running:
```bash
brew services list | grep postgresql
```

### "Port 8000 already in use"
**Solution:** Kill the process or use a different port:
```bash
lsof -ti:8000 | xargs kill
# Or use different port:
uvicorn app.main:app --reload --port 8001
```

---

## 📝 Common Workflow

1. **Start PostgreSQL & Redis:**
   ```bash
   brew services start postgresql@18
   redis-cli ping  # Should return PONG
   ```

2. **Activate venv:**
   ```bash
   cd backend
   source venv/bin/activate
   ```

3. **Start backend:**
   ```bash
   uvicorn app.main:app --reload
   ```

4. **In another terminal, sync data:**
   ```bash
   cd backend
   source venv/bin/activate
   python scripts/sync_news_filings.py
   ```

5. **Start frontend (in another terminal):**
   ```bash
   cd frontend
   npm run dev
   ```

---

## 💡 Pro Tips

- Keep venv activated in each terminal window
- Use `which python` to verify you're using venv Python
- Check API docs at http://localhost:8000/docs for all endpoints
- Use `--reload` flag for auto-reload during development
