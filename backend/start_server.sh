#!/bin/bash
# Start server script for QuantTrade-AI backend

echo "🚀 Starting QuantTrade-AI server..."
cd "$(dirname "$0")"

# Activate virtual environment
source ../.venv/bin/activate

# Start uvicorn
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
