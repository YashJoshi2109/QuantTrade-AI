"""
Create billing-related database tables only.

Use this if the generic create_tables.py script fails due to existing
indexes (for example, DuplicateTable errors on quote_history indexes).

This script will create:
- billing_customers
- subscriptions
- billing_events
"""

import os
import sys

# Add parent directory to path so "app" package resolves
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine, Base
from app.models.billing import BillingCustomer, Subscription, BillingEvent


if __name__ == "__main__":
    print("Creating billing tables...")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            BillingCustomer.__table__,
            Subscription.__table__,
            BillingEvent.__table__,
        ],
    )
    print("✅ Billing tables created successfully!")
    print("\nTables created:")
    print("  - billing_customers")
    print("  - subscriptions")
    print("  - billing_events")

