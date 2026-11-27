"""Registry of community bots: identity, methodology, schedule, caps.

Bot accounts are seeded by scripts/seed_community_bots.py (idempotent):
username = spec.username, email at BOT_EMAIL_DOMAIN (a reserved .invalid
domain, so no mail can ever reach it), no password, no Google id, no passkey.
"""
from __future__ import annotations

from typing import Dict, List

from app.services.community_bots.base import BotSpec, Slot
from app.services.community_bots.bots import earnings, movers, real_estate, sectors, sentiment, weather

BOT_EMAIL_DOMAIN = "bots.quanttrade.invalid"

COMMON_RULES = [
    "Every number comes from the listed data sources at the as-of time; the wording is a fixed template (no AI-written text).",
    "Posts are skipped when the data is stale, missing or too thin to summarise.",
    "At most the daily cap per bot, one post per scheduled slot, and identical data is never re-posted.",
    "Posts are labelled automated and are not investment advice; signals and observations are rule matches, not recommendations.",
]

BOTS: Dict[str, BotSpec] = {}


def _add(spec: BotSpec) -> None:
    BOTS[spec.slug] = spec


_add(BotSpec(
    slug="market_weather",
    username="market_weather_bot",
    display_name="Market Weather Bot",
    emoji="⛅",
    tagline="A daily market weather report from breadth, VIX and trend.",
    description=("Twice per trading day: a pre-open read of the last session's conditions and a close "
                 "report. Sunny to stormy, scored from data with a published rubric."),
    methodology=[
        "Breadth: share of advancers among advancing + declining stocks in our US heatmap universe, ~700 stocks "
        "(>=65% +2, >=55% +1, <=45% −1, <=35% −2).",
        "Volatility: CBOE VIX level (<14 +2, <18 +1, <22 0, <28 −1, >=28 −2) and −1 more if VIX jumps 10%+ on the day.",
        "Trend: SPY vs its 50- and 200-day simple moving averages (−2..+2).",
        "Day move: SPY +1% or more +1, −1% or less −1.",
        "Total score (−7..+7): >=4 Sunny, 2..3 Mostly sunny, 0..1 Partly cloudy, −2..−1 Rainy, <=−3 Stormy; VIX >= 30 is always Stormy.",
    ],
    data_sources=["QuantTrade quote cache / canonical quotes (US heatmap universe, ~700 stocks, SPY, QQQ, IWM, ^VIX)",
                  "QuantTrade technical analysis service (SMA 50/200)"],
    community_slug="stock-market",
    slots=(Slot("pre_open", 9, 0), Slot("close", 16, 20)),
    daily_cap=2,
    universe=("US heatmap universe, ~700 stocks", "SPY", "QQQ", "IWM", "^VIX"),
    collect=weather.collect,
    compose=weather.compose,
    accent="amber",
))

_add(BotSpec(
    slug="sentiment_pulse",
    username="sentiment_pulse_bot",
    display_name="Sentiment Pulse Bot",
    emoji="\U0001F4E1",
    tagline="Aggregate news tone by ticker and sector, and who moved most.",
    description=("Counts bullish / bearish / neutral headlines classified by our news-intelligence model "
                 "over the last 24 hours, by ticker and sector, and the biggest tone shifts vs the prior 24 hours."),
    methodology=[
        "Input: our news_items feed (headline metadata only: title, link, publisher, tickers, sentiment label).",
        "Net tone = (bullish − bearish) / headlines, from −1 to +1; tickers need 3+ headlines to rank.",
        "Tone shift = net tone now minus net tone over the prior 24 hours (3+ headlines in both windows).",
        "Up to 3 headlines are shown as a short title with a link to the publisher; article text is never copied.",
        "No social-media posts or comments are read; no individual is quoted or named.",
    ],
    data_sources=["QuantTrade news intelligence (FinBERT-class headline classifier over licensed/public news feeds)"],
    community_slug="stocks",
    slots=(Slot("midday", 12, 30), Slot("evening", 17, 15)),
    daily_cap=2,
    universe=("all tickers tagged in classified headlines",),
    collect=sentiment.collect,
    compose=sentiment.compose,
    accent="violet",
))

_add(BotSpec(
    slug="movers_breakouts",
    username="movers_signals_bot",
    display_name="Movers & Breakouts Bot",
    emoji="\U0001F4C8",
    tagline="Rule-based signals on the day's biggest movers.",
    description=("Midday and after the close: the largest gainers and losers (2%+ moves) and which "
                 "of them trip a fixed technical rule."),
    methodology=[
        "Candidates: up to 6 largest gainers and 6 largest losers that moved 2% or more.",
        "52w-high breakout: up on the day and within 0.5% of the 52-week high; 52w-low breakdown: the mirror rule.",
        "RSI(14) >= 70 overbought, <= 30 oversold; unusual volume = 2x the average daily volume or more.",
        "200-day SMA zone: price within 1% of the 200-day average while moving 1%+.",
        "Labels are descriptions of the data (signals / observations), never trade recommendations.",
    ],
    data_sources=["QuantTrade quote cache (US heatmap universe, ~700 stocks)",
                  "QuantTrade technical analysis service (daily OHLCV)"],
    community_slug="stocks",
    slots=(Slot("midday", 12, 0), Slot("close", 16, 10)),
    daily_cap=2,
    universe=("US heatmap universe, ~700 stocks",),
    collect=movers.collect,
    compose=movers.compose,
    accent="emerald",
))

_add(BotSpec(
    slug="earnings_watch",
    username="earnings_watch_bot",
    display_name="Earnings Watch Bot",
    emoji="\U0001F4C5",
    tagline="Who reports today and tomorrow, and how results compared with estimates.",
    description=("Morning: today's schedule plus results released since the last close. Evening: today's "
                 "results vs consensus plus the next session's schedule. Ranked by market cap."),
    methodology=[
        "Calendar: Finnhub earnings calendar merged with the Nasdaq public earnings calendar (our earnings service).",
        "EPS / revenue surprise = (actual − consensus estimate) / |estimate|.",
        "Top 10 scheduled and top 8 reported companies by market cap are listed.",
        "Skipped when both calendar sources are unavailable or there is nothing to report.",
    ],
    data_sources=["QuantTrade earnings calendar (Finnhub + Nasdaq public calendar)"],
    community_slug="stocks",
    slots=(Slot("morning", 8, 0), Slot("evening", 18, 30)),
    daily_cap=2,
    universe=("US-listed companies with scheduled earnings",),
    collect=earnings.collect,
    compose=earnings.compose,
    accent="sky",
))

_add(BotSpec(
    slug="real_estate_rates",
    username="real_estate_rates_bot",
    display_name="Real Estate & Rates Bot",
    emoji="\U0001F3E0",
    tagline="REITs by property type next to Treasury yields and mortgage rates.",
    description=("After the close: REIT ETFs and large REITs by property type, homebuilder ETFs, the 10-year "
                 "Treasury yield, the 30-year mortgage rate and housing starts."),
    methodology=[
        "REITs: VNQ, XLRE and one large REIT per property type (industrial, towers, data centers, healthcare, "
        "net lease, malls, self storage, apartments) plus ITB / XHB.",
        "Relative performance = VNQ day change minus SPY day change (pp).",
        "Rates from FRED: DGS10 (10-year Treasury), MORTGAGE30US (Freddie Mac PMMS, weekly), HOUST (housing starts, monthly).",
        "Without a FRED key the 10-year yield falls back to the ^TNX quote; without any 10-year yield the post is skipped.",
    ],
    data_sources=["QuantTrade quote cache", "FRED API (St. Louis Fed): DGS10, MORTGAGE30US, HOUST"],
    community_slug="real-estate",
    slots=(Slot("close", 16, 40),),
    daily_cap=1,
    universe=tuple(s for s, _ in real_estate.REITS + real_estate.BUILDERS),
    collect=real_estate.collect,
    compose=real_estate.compose,
    accent="orange",
))

_add(BotSpec(
    slug="sector_rotation",
    username="sector_rotation_bot",
    display_name="Sector Rotation Bot",
    emoji="\U0001F504",
    tagline="Relative strength of the 11 sector ETFs vs SPY.",
    description="After the close: 1-, 5- and 20-day returns of the SPDR sector ETFs, ranked by strength vs SPY.",
    methodology=[
        "Daily closes for XLK, XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLRE, XLU and SPY.",
        "RS (20D) = sector 20-session return minus SPY 20-session return, in percentage points.",
        "Rotation = change of rank between 5-day and 20-day relative strength (3+ places is called out).",
        "Skipped unless at least 9 of the 11 ETFs have a close for the latest session.",
    ],
    data_sources=["QuantTrade market data service (daily closes)"],
    community_slug="investing",
    slots=(Slot("close", 16, 30),),
    daily_cap=1,
    universe=tuple(s for s, _ in sectors.SECTOR_ETFS) + ("SPY",),
    collect=sectors.collect,
    compose=sectors.compose,
    accent="cyan",
))

# Communities the seed script creates when missing (slug, name, category, description).
BOT_COMMUNITIES = [
    ("stock-market", "Stock Market", "stocks", "General stock market analysis, sector rotation, and market commentary."),
    ("stocks", "Stocks", "stocks", "Stock market discussion, analysis, and news for all experience levels."),
    ("investing", "Investing", "macro", "Long-term investing strategies, portfolio management, and market analysis."),
    ("real-estate", "Real Estate & Rates", "macro",
     "REITs, housing data, mortgage rates and the rate backdrop for real estate."),
]


def get(slug: str) -> BotSpec:
    return BOTS[slug]


def all_specs() -> List[BotSpec]:
    return list(BOTS.values())


def bot_email(spec: BotSpec) -> str:
    return f"{spec.username}@{BOT_EMAIL_DOMAIN}"
