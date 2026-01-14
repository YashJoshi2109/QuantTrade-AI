# Python 3.14 Compatibility Notes

## Current Status

You're using Python 3.14.2, which is very new. Some packages in the requirements have compatibility issues:

### Packages with Issues:
1. **pandas-ta** - Requires numba, which doesn't support Python 3.14 yet
2. **statsmodels** - Cython compilation issues with Python 3.14
3. **scikit-learn 1.3.2** - Updated to 1.8.0+ for Python 3.14 support
4. **pandas 2.1.3** - Updated to 2.3.3+ for Python 3.14 support
5. **pydantic** - Updated to 2.7.4+ for LangChain compatibility

### Solutions Applied:
- ✅ Updated pandas to 2.3.3+
- ✅ Updated scikit-learn to 1.8.0+
- ✅ Updated pydantic to 2.7.4+
- ✅ Updated LangChain packages to newer versions
- ✅ Commented out pandas-ta (optional, we have `ta` library)
- ✅ Commented out statsmodels (optional for now)

## Installation Steps

1. **Create virtual environment:**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Upgrade pip:**
   ```bash
   pip install --upgrade pip
   ```

3. **Install requirements:**
   ```bash
   pip install -r requirements.txt
   ```

   This may take several minutes as some packages need to compile.

## Alternative: Use Python 3.11 or 3.12

If you encounter too many compatibility issues, consider using Python 3.11 or 3.12:

```bash
# Using pyenv (if installed)
pyenv install 3.12.0
pyenv local 3.12.0

# Or using Homebrew
brew install python@3.12
python3.12 -m venv venv
```

## What's Working

The core application stack should work fine:
- ✅ FastAPI
- ✅ PostgreSQL with pgvector
- ✅ Celery + Redis
- ✅ Core ML libraries (scikit-learn, XGBoost, LightGBM)
- ✅ LangChain + OpenAI
- ✅ Technical analysis (`ta` library)

## Optional Packages (Commented Out)

These can be added later when Python 3.14 support improves:
- `pandas-ta` - Alternative technical analysis (we have `ta`)
- `statsmodels` - Time series analysis (can add later)

## Next Steps

1. Complete the installation (it may take a few minutes)
2. Test the backend: `uvicorn app.main:app --reload`
3. If issues persist, consider switching to Python 3.12
