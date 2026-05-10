"""Shared constants for ML training and inference.

Single source of truth for feature columns, symbol tiers, and paths.
Never import from app.* here — this module must be standalone.
"""

from pathlib import Path

# ── Feature columns (ordered, immutable at training time) ──────────────

FEATURE_COLUMNS: list[str] = [
    # Price
    "Close",
    "Volume",
    # Trend
    "SMA_20",
    "SMA_50",
    "EMA_9",
    "EMA_21",
    # Momentum
    "RSI_14",
    "MACD",
    "MACD_Signal",
    "MACD_Histogram",
    "ROC_10",
    # Volatility
    "BB_pctB",
    "BB_Width",
    "ATR_14",
    "Drawdown",
    # Volume
    "Volume_SMA_20",
    "Volume_Change",
    # Context
    "Log_Return",
    "Distance_52w_High",
    "Returns_vs_SPY",
]

NUM_FEATURES = len(FEATURE_COLUMNS)  # 20

# ── Symbol tiers ───────────────────────────────────────────────────────

TIER_1_SYMBOLS: list[str] = [
    # Mega-caps (top 30 by market cap) — always trained first
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM", "V", "UNH", "JNJ", "XOM", "MA", "PG", "HD", "AVGO", "MRK",
    "COST", "LLY",
    # Added mega-caps
    "GOOG", "ACN", "INTU", "BKNG", "ADP", "MDLZ", "ADI", "ANET", "NXPI", "MELI",
]

TIER_2_SYMBOLS: list[str] = [
    # Large-cap tech
    "AMD", "INTC", "CRM", "ADBE", "ORCL", "CSCO", "QCOM", "TXN", "NOW", "AMAT",
    "LRCX", "KLAC", "MRVL", "SNPS", "CDNS", "FTNT", "PANW", "CRWD", "ZS", "NET",
    "DDOG", "SNOW", "MDB", "SHOP", "XYZ", "COIN", "PLTR", "ARM", "SMCI", "DELL",
    # Finance
    "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "C", "AXP", "ICE", "CME",
    "MCO", "MSCI", "SPGI", "CB", "AON", "AJG", "PGR", "TRV", "MET", "AIG",
    # Healthcare
    "PFE", "ABBV", "TMO", "ABT", "DHR", "BMY", "AMGN", "GILD", "VRTX", "REGN",
    "ISRG", "MDT", "SYK", "BDX", "EW", "ZTS", "IDXX", "DXCM", "ALGN", "BSX",
    # Consumer
    "WMT", "KO", "PEP", "MCD", "NKE", "DIS", "NFLX", "SBUX", "TJX", "LOW",
    "TGT", "ROST", "ORLY", "AZO", "CMG", "YUM", "DPZ", "MNST", "KHC", "CL",
    # Industrials
    "BA", "GE", "CAT", "HON", "UPS", "RTX", "LMT", "DE", "MMM", "FDX",
    "GD", "NOC", "WM", "RSG", "EMR", "ITW", "PH", "ROK", "ETN", "IR",
    # Energy
    "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "DVN", "HAL",
    # Utilities + REITs
    "NEE", "DUK", "SO", "AEP", "D", "SRE", "EXC", "XEL", "CEG", "VST",
    "PLD", "AMT", "EQIX", "CCI", "PSA", "SPG", "O", "WELL", "DLR", "AVB",
    # Telecom + Media
    "T", "VZ", "TMUS", "CMCSA", "CHTR", "WBD", "FOX",
    # Materials
    "LIN", "APD", "SHW", "ECL", "DD", "NEM", "FCX", "NUE", "STLD", "CF",
    # ── New large-cap additions (42) ─────────────────────────────────
    # Large-cap tech
    "MSTR", "GDDY", "TWLO", "ZM", "DOCU", "AKAM", "HPE", "ZBRA", "KEYS",
    # Finance
    "USB", "PNC", "TFC", "COF", "FITB", "HBAN", "KEY", "CFG", "MTB",
    "RJF", "NTRS", "STT", "BK", "CINF", "GL", "AFL", "PRU", "ALL", "EG",
    # Healthcare
    "A", "BAX", "RMD", "HOLX", "MTD", "TFX", "TECH", "WAT", "RVTY", "BIO",
    "CRL", "GEHC",
]

TIER_3_SYMBOLS: list[str] = [
    # Growth / Mid-cap tech
    "UBER", "ABNB", "DASH", "TTD", "TEAM", "WDAY", "VEEV", "HUBS", "OKTA", "PATH",
    "U", "NTNX", "ESTC", "CFLT", "BILL", "PCOR", "MNDY", "ZI", "GTLB", "IOT",
    # Semiconductors
    "ON", "SWKS", "QRVO", "MPWR", "WOLF", "ACLS", "ENTG", "ONTO",
    # Consumer discretionary
    "ETSY", "W", "CHWY", "DG", "DLTR", "FIVE", "BBY", "TSCO", "ULTA", "DECK",
    "LULU", "BIRD", "RH", "WSM", "GRMN", "HAS", "MAT",
    # Biotech / Pharma
    "MRNA", "BIIB", "IQV", "CNC", "CI", "HUM", "MOH", "ELV", "HCA", "DVA",
    # Fintech
    "PYPL", "FIS", "FISV", "GPN", "WEX", "NDAQ", "CBOE",
    # Other
    "RIVN", "LCID", "PLUG", "FSLR", "ENPH", "SEDG",
    "HPE", "IBM", "HPQ", "EPAM", "GLOB",
    # Additional mid-caps
    "CTAS", "ODFL", "FAST", "PAYX", "VRSK", "CPRT", "FICO", "AZPN", "CDW", "BR",
    "TRGP", "WMB", "KMI", "OKE", "ET", "CTRA", "FANG", "APA", "MRO", "AR",
    "WAB", "CARR", "TT", "DOV", "HUBB", "NDSN", "ALLE", "SWK",
    "VICI", "IRM", "SBAC", "ESS", "MAA", "UDR", "KIM", "REG", "HST", "CPT",
    # ETF benchmarks
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLP",
    # ── New mid-cap / growth additions ────────────────────────
    # Tech mid-cap
    "APPN", "BRZE", "CWAN", "DOCN", "DT", "FROG", "FRSH", "JAMF", "MANH", "PAYC",
    "PCTY", "PTC", "QLYS", "RPD", "SMAR", "TENB", "TOST", "WIX", "YEXT",
    "ASAN", "BOX", "CDAY", "COUP", "EGHT", "EVBG", "FIVN",
    "NEWR", "PEGA", "PLAN", "PRGS", "QTWO", "SQSP", "TYL", "VRNS",
    # Semiconductors
    "ALGM", "AMKR", "ASX", "CEVA", "COHR", "CRUS", "DIOD", "FORM", "GFS", "IPGP",
    "LFUS", "LSCC", "MKSI", "MXL", "NOVT", "OLED", "POWI", "RMBS", "SITM", "SLAB",
    "SMTC", "STM", "SYNA", "TSM", "UMC",
    # Consumer discretionary
    "AAP", "AEO", "ANF", "BURL", "COLM", "CPRI", "CRI", "CROX", "EL", "EVH",
    "FL", "GAP", "GPC", "GPS", "GIL", "HBI", "HELE", "KSS", "LESL", "LKQ",
    "LVS", "MGM", "NCLH", "ODP", "PVH", "RL", "RCL", "SIRI", "SKX",
    "TAP", "TPR", "VFC", "WYNN",
    # Consumer staples
    "ADM", "BG", "CAG", "CHD", "CLX", "CPB", "EPC", "FDP", "GIS", "HRL",
    "HSY", "IFF", "K", "KDP", "KMB", "KR", "LW", "MKC", "PM",
    "POST", "SAM", "SFM", "SJM", "STZ", "USFD", "WBA",
    # Biotech / Pharma
    "ALNY", "ARGX", "BMRN", "EXAS", "EXEL", "HALO", "INCY", "IONS", "JAZZ",
    "LGND", "NBIX", "PCVX", "RARE", "RCKT", "RGEN", "ROIV", "SRPT",
    "UTHR", "VCYT", "XNCR", "ZBH",
    # Medtech / Healthcare services
    "AMN", "ATRC", "CHE", "COO", "CYH", "DGX", "EHC",
    "GH", "HAE", "HSIC", "INSP", "LH", "LNTH", "MASI", "MMSI", "NVCR",
    "NVST", "OMI", "OSCR", "PGNY", "PHR", "PODD", "RVMD", "SDGR",
    "TMDX", "XRAY",
    # Financials mid-cap
    "ALLY", "AMP", "ARCC", "BEN", "BOKF", "CG", "CMA", "EWBC", "EVR",
    "FHN", "FNF", "FULT", "GBCI", "IBKR", "IVZ", "JEF", "LPLA", "LNC", "MKL",
    "MKTX", "NYCB", "OZK", "PFG", "PIPR", "RF", "SEIC", "SF",
    "SNV", "SOFI", "SYF", "TROW", "WAL", "WBS", "WRB", "ZION",
    # Industrials mid-cap
    "AGCO", "AXON", "BWXT", "CNH", "CGNX", "CSL", "EXPD", "EFX", "GNRC", "GGG",
    "GWW", "HEI", "HII", "JBHT", "KEX", "LDOS", "LEA", "MSA", "PCAR",
    "POOL", "RBC", "RHI", "ROP", "SNA", "STE", "TTEK", "URI",
    "WCC", "WSO", "XYL",
    # Energy mid-cap
    "AM", "AROC", "CIVI", "CLR", "CNX", "EQT", "HES", "KOS",
    "LNG", "MTDR", "OVV", "PAA", "PXD", "RRC", "SM", "SWN", "VNOM", "WES",
    # Utilities
    "AES", "AWK", "CMS", "CNP", "ED", "ES", "EVRG", "FE", "IDA", "LNT",
    "NI", "NRG", "OGE", "PCG", "PEG", "PNW", "PPL", "WEC",
    # REITs
    "ACC", "ADC", "AIV", "APLE", "ARE", "BXP", "CBRE", "COLD", "CUBE", "DEI",
    "DOC", "EGP", "ELS", "EXR", "FR", "GLPI", "INVH", "IIPR", "KRC",
    "LAMR", "LSI", "MPW", "NLY", "NNN", "OHI", "OUT", "PCH", "PEAK", "PEB",
    "REXR", "RLJ", "ROIC", "SLG", "STAG", "STOR", "SUI", "TRNO", "VNO", "WPC",
    # Telecom + Media
    "DISH", "EA", "FOXA", "IPG", "LBRDK", "LSXMA", "MTCH", "NWSA",
    "OMC", "PINS", "RBLX", "ROKU", "SNAP", "SPOT", "TTWO", "ZG",
    # Materials
    "ALB", "AMCR", "AVY", "BALL", "BMS", "CC", "CE", "CLF", "CMC", "CRS",
    "CX", "DOW", "EMN", "FMC", "GPK", "HUN", "IP", "LYB",
    "MLM", "MOS", "OLN", "PKG", "PPG", "RPM", "RS", "SEE", "SMG",
    "SON", "VMC", "WRK", "WY",
    # Defense / Aerospace
    "AVAV", "CW", "ERJ", "ESLT", "HWM", "KTOS",
    "LHX", "MRCY", "PSN", "SPR", "TDG", "TXT",
    # Transportation
    "CHRW", "CNI", "CP", "CSX", "DAL", "KNX", "LSTR", "MATX",
    "NSC", "R", "SAIA", "UAL", "UNP", "WERN",
    # Auto / EV
    "ALV", "APTV", "BWA", "F", "GM", "LI", "NIO", "QS", "XPEV",
    # Other growth / misc
    "AI", "APP", "CELH", "COUR", "CRSP", "DKNG", "DOCS", "DUOL",
    "FOUR", "GLNG", "GDRX", "HOOD", "HQY", "HIMS",
    "KVYO", "LITE", "LYFT", "MARA", "MQ", "OWL",
    "RAMP", "RXRX", "S", "TRMB", "UPST", "WRBY",
    # Additional ETF benchmarks
    "XLU", "XLB", "XLC", "XLY", "XLRE", "VTI", "VOO", "VGT", "VHT", "VFH",
    "ARKK", "ARKG", "ARKW", "ARKF", "SOXX", "SMH", "GDX", "SLV", "GLD", "TLT",
    "HYG", "LQD", "EEM", "EFA", "VWO", "IEMG", "KWEB", "FXI", "INDA", "EWZ",
    "VNQ", "SCHD", "DVY", "HDV", "DGRO", "NOBL", "MTUM", "QUAL", "VLUE", "USMV",
]

ALL_SYMBOLS: list[str] = sorted(set(TIER_1_SYMBOLS + TIER_2_SYMBOLS + TIER_3_SYMBOLS))

# Sub-tier splits for parallel execution (balanced ~192 symbols each)
_T3_CHUNK = len(TIER_3_SYMBOLS) // 3
TIER_3A_SYMBOLS: list[str] = TIER_3_SYMBOLS[:_T3_CHUNK]
TIER_3B_SYMBOLS: list[str] = TIER_3_SYMBOLS[_T3_CHUNK:2 * _T3_CHUNK]
TIER_3C_SYMBOLS: list[str] = TIER_3_SYMBOLS[2 * _T3_CHUNK:]

SYMBOL_TIERS: dict[str, list[str]] = {
    "tier_1": TIER_1_SYMBOLS,
    "tier_2": TIER_1_SYMBOLS + TIER_2_SYMBOLS,
    "tier_3": TIER_1_SYMBOLS + TIER_2_SYMBOLS + TIER_3_SYMBOLS,
    "all": ALL_SYMBOLS,
    # Exclusive sub-tiers for parallel Sunday jobs
    "tier_1_exclusive": TIER_1_SYMBOLS,
    "tier_2_exclusive": TIER_2_SYMBOLS,
    "tier_3a": TIER_3A_SYMBOLS,
    "tier_3b": TIER_3B_SYMBOLS,
    "tier_3c": TIER_3C_SYMBOLS,
}

# Shard sizing defaults
SHARD_MAX_SYMBOLS = 200
SHARD_MAX_RUNTIME_SECONDS = 7200  # 2 hours target

# ── Paths ──────────────────────────────────────────────────────────────

ML_ROOT = Path(__file__).parent
DEFAULT_CHECKPOINT_DIR = ML_ROOT / "checkpoints"
DEFAULT_CACHE_DIR = ML_ROOT / "data_cache"
DEFAULT_CONFIG_PATH = ML_ROOT.parent / "configs" / "train_default.yaml"

# ── Model defaults ─────────────────────────────────────────────────────

DEFAULT_SEQ_LEN = 60
DEFAULT_HIDDEN_SIZE = 128
DEFAULT_NUM_LAYERS = 3
DEFAULT_DROPOUT = 0.3
DEFAULT_HORIZONS = [1, 7]
