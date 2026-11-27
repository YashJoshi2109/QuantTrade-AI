-- Public reports over shared market data. One cached result serves every user.

-- name: price_bar_coverage
-- title: Price history coverage
-- description: Stored OHLCV bars per symbol in our database (count, first and last bar timestamp, UTC). Symbols with fewer than min_bars bars are left out. Shows which symbols have enough history for forecasts and backtests.
-- scope: public
-- ttl: 3600
-- args: min_bars:int=0
SELECT s.symbol AS symbol,
       COUNT(b.id) AS bars,
       MIN(b.timestamp) AS first_bar,
       MAX(b.timestamp) AS last_bar
FROM price_bars b
JOIN symbols s ON s.id = b.symbol_id
GROUP BY s.symbol
HAVING COUNT(b.id) >= :min_bars
ORDER BY s.symbol
