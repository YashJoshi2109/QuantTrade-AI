#!/bin/bash
# Quick script to activate the virtual environment
cd /Users/yash/Downloads/Finance/backend
source venv/bin/activate
echo "✅ Virtual environment activated!"
echo "Python: $(python --version)"
echo "Pip: $(pip --version)"
echo ""
echo "You can now run:"
echo "  - pip install -r requirements-ml.txt  (install ML packages)"
echo "  - uvicorn app.main:app --reload       (start backend)"
