
import sys
import os

sys.path.append(os.getcwd())

from app.models.global_monitor import DataSource

print(f"DataSource.AISSTREAM value is: '{DataSource.AISSTREAM.value}'")
print(f"DataSource.AISSTREAM type is: {type(DataSource.AISSTREAM)}")
print(f"DataSource.AISSTREAM string representation is: '{str(DataSource.AISSTREAM)}'")
