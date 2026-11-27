"""Deterministic quant / risk engine over daily price data.

Everything here is plain numpy / scipy over adjusted daily bars. No number is
produced by an LLM: the copilot tools in app.services.copilot.quant_tools call
these functions and return their outputs with provenance (data source, window,
formula, assumptions).

Modules
  stats         realised volatility, Hurst (R/S, DFA), ACF / Ljung-Box,
                variance ratio, Gaussian HMM regimes
  risk          beta (full, rolling, downside), Jensen's alpha, Sharpe,
                Sortino, max drawdown with dates, historical / parametric VaR
  event_study   market-model earnings event study (AR, CAR, t / sign tests)
  portfolio     correlation, covariance, risk contributions, concentration,
                factor regressions, historical / hypothetical stress
  backtest      Strategy Lab backtest vs buy-and-hold (out-of-sample split)
  data          price / risk-free / earnings / sector providers with provenance
  analyses      the end-to-end analyses the copilot tools expose
"""
