-- Console-style statements over the caller's own portfolios.
-- Amounts are in each portfolio's currency (the "currency" column); no FX is applied.
-- Dates are UTC calendar days. Every task here is user-scoped: :user_id is the
-- authenticated caller, injected by the runner (never a request argument).

-- name: tradebook
-- title: Tradebook
-- description: Every recorded transaction in your portfolios between two dates (UTC), oldest first. Amount is quantity x price plus fees for buys, minus fees for sells, and the cash received for dividends.
-- scope: user
-- ttl: 300
-- args: from_date:date=2000-01-01, to_date:date_end=today
SELECT t.transaction_date AS date,
       p.name AS portfolio,
       p.currency AS currency,
       s.symbol AS symbol,
       t.transaction_type AS type,
       t.quantity AS quantity,
       t.price AS price,
       t.fees AS fees,
       t.total_amount AS amount,
       t.realized_pnl AS realized_pnl
FROM transactions t
JOIN portfolios p ON p.id = t.portfolio_id
JOIN symbols s ON s.id = t.symbol_id
WHERE p.user_id = :user_id
  AND t.transaction_date >= :from_date
  AND t.transaction_date < :to_date
ORDER BY t.transaction_date, t.id

-- name: realized_pnl_by_symbol
-- title: Realized P&L by symbol
-- description: Sells between two dates (UTC) grouped by symbol and currency. Realized P&L is the ledger's average-cost figure stored on each sell; sells_missing_pnl counts sells the ledger has not priced yet, so a non-zero value means the total is incomplete.
-- scope: user
-- ttl: 300
-- args: from_date:date=2000-01-01, to_date:date_end=today
SELECT s.symbol AS symbol,
       p.currency AS currency,
       COUNT(*) AS sells,
       SUM(t.quantity) AS quantity_sold,
       SUM(t.total_amount) AS net_proceeds,
       SUM(COALESCE(t.fees, 0)) AS fees,
       SUM(t.realized_pnl) AS realized_pnl,
       SUM(CASE WHEN t.realized_pnl IS NULL THEN 1 ELSE 0 END) AS sells_missing_pnl
FROM transactions t
JOIN portfolios p ON p.id = t.portfolio_id
JOIN symbols s ON s.id = t.symbol_id
WHERE p.user_id = :user_id
  AND t.transaction_type = 'SELL'
  AND t.transaction_date >= :from_date
  AND t.transaction_date < :to_date
GROUP BY s.symbol, p.currency
ORDER BY s.symbol, p.currency

-- name: dividend_income
-- title: Dividend income
-- description: Dividend cash you recorded between two dates (UTC), grouped by symbol and currency.
-- scope: user
-- ttl: 300
-- args: from_date:date=2000-01-01, to_date:date_end=today
SELECT s.symbol AS symbol,
       p.currency AS currency,
       COUNT(*) AS payments,
       SUM(t.total_amount) AS amount,
       MIN(t.transaction_date) AS first_payment,
       MAX(t.transaction_date) AS last_payment
FROM transactions t
JOIN portfolios p ON p.id = t.portfolio_id
JOIN symbols s ON s.id = t.symbol_id
WHERE p.user_id = :user_id
  AND t.transaction_type = 'DIVIDEND'
  AND t.transaction_date >= :from_date
  AND t.transaction_date < :to_date
GROUP BY s.symbol, p.currency
ORDER BY s.symbol, p.currency
