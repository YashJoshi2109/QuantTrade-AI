"""price_bars: one bar per (symbol_id, timestamp); duplicate inserts are ignored."""
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.models.price import PriceBar
from app.models.symbol import Symbol
from app.services.data_fetcher import DataFetcher


def _session():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[Symbol.__table__, PriceBar.__table__])
    return sessionmaker(bind=eng)()


def _bar(sid, day, close):
    return PriceBar(symbol_id=sid, timestamp=datetime(2026, 11, day, 5, tzinfo=timezone.utc),
                    open=1, high=2, low=0.5, close=close, volume=10)


def test_model_declares_unique_symbol_timestamp_index():
    idx = {i.name: i for i in PriceBar.__table__.indexes}
    assert idx["uq_price_bars_symbol_ts"].unique


def test_concurrent_duplicate_insert_is_ignored():
    db = _session()
    db.add(Symbol(symbol="WDAY", name="Workday"))
    db.commit()
    sid = db.query(Symbol).first().id
    # first sync stores day 24 and 25
    assert DataFetcher._insert_bars_ignore_duplicates(db, [_bar(sid, 24, 10), _bar(sid, 25, 11)]) == 2
    db.commit()
    # an overlapping sync that passed its (stale) existence check re-sends day 25 + a new day 26
    inserted = DataFetcher._insert_bars_ignore_duplicates(db, [_bar(sid, 25, 11), _bar(sid, 26, 12)])
    db.commit()
    assert inserted == 1
    assert db.query(PriceBar).count() == 3
