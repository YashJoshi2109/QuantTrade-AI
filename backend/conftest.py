"""Root conftest: add backend directory to sys.path so `app.*` imports resolve."""
import sys
import os

# Ensure the backend root is on sys.path for all tests under tests/
sys.path.insert(0, os.path.dirname(__file__))
