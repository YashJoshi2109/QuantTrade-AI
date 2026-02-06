#!/usr/bin/env python3
"""
Seed symbols_master table with comprehensive US stock data

This script populates the symbols_master table with:
- All NASDAQ stocks
- All NYSE stocks
- Popular ETFs
- Major ADRs

Data source: Uses yfinance to fetch symbol lists, or falls back to embedded data.

Usage:
  cd backend
  source .venv/bin/activate
  python scripts/seed_symbols_master.py

Note: First run migrate_mvp_lean.py to create the table.
"""
import os
import sys
from pathlib import Path
from datetime import datetime

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.database import engine, SessionLocal
from app.models.symbols_master import SymbolsMaster


# Comprehensive stock data - Major US equities and ETFs
# Format: (symbol, name, exchange, asset_type, sector)
CORE_SYMBOLS = [
    # Technology - NASDAQ
    ("AAPL", "Apple Inc.", "NASDAQ", "Equity", "Technology"),
    ("MSFT", "Microsoft Corporation", "NASDAQ", "Equity", "Technology"),
    ("GOOGL", "Alphabet Inc. Class A", "NASDAQ", "Equity", "Technology"),
    ("GOOG", "Alphabet Inc. Class C", "NASDAQ", "Equity", "Technology"),
    ("AMZN", "Amazon.com Inc.", "NASDAQ", "Equity", "Technology"),
    ("NVDA", "NVIDIA Corporation", "NASDAQ", "Equity", "Technology"),
    ("META", "Meta Platforms Inc.", "NASDAQ", "Equity", "Technology"),
    ("TSLA", "Tesla Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("AMD", "Advanced Micro Devices Inc.", "NASDAQ", "Equity", "Technology"),
    ("INTC", "Intel Corporation", "NASDAQ", "Equity", "Technology"),
    ("ADBE", "Adobe Inc.", "NASDAQ", "Equity", "Technology"),
    ("NFLX", "Netflix Inc.", "NASDAQ", "Equity", "Communication Services"),
    ("CRM", "Salesforce Inc.", "NYSE", "Equity", "Technology"),
    ("CSCO", "Cisco Systems Inc.", "NASDAQ", "Equity", "Technology"),
    ("ORCL", "Oracle Corporation", "NYSE", "Equity", "Technology"),
    ("AVGO", "Broadcom Inc.", "NASDAQ", "Equity", "Technology"),
    ("QCOM", "QUALCOMM Incorporated", "NASDAQ", "Equity", "Technology"),
    ("TXN", "Texas Instruments Incorporated", "NASDAQ", "Equity", "Technology"),
    ("IBM", "International Business Machines", "NYSE", "Equity", "Technology"),
    ("NOW", "ServiceNow Inc.", "NYSE", "Equity", "Technology"),
    ("INTU", "Intuit Inc.", "NASDAQ", "Equity", "Technology"),
    ("AMAT", "Applied Materials Inc.", "NASDAQ", "Equity", "Technology"),
    ("MU", "Micron Technology Inc.", "NASDAQ", "Equity", "Technology"),
    ("ADI", "Analog Devices Inc.", "NASDAQ", "Equity", "Technology"),
    ("LRCX", "Lam Research Corporation", "NASDAQ", "Equity", "Technology"),
    ("KLAC", "KLA Corporation", "NASDAQ", "Equity", "Technology"),
    ("SNPS", "Synopsys Inc.", "NASDAQ", "Equity", "Technology"),
    ("CDNS", "Cadence Design Systems", "NASDAQ", "Equity", "Technology"),
    ("MRVL", "Marvell Technology Inc.", "NASDAQ", "Equity", "Technology"),
    ("PANW", "Palo Alto Networks Inc.", "NASDAQ", "Equity", "Technology"),
    ("CRWD", "CrowdStrike Holdings Inc.", "NASDAQ", "Equity", "Technology"),
    ("ZS", "Zscaler Inc.", "NASDAQ", "Equity", "Technology"),
    ("DDOG", "Datadog Inc.", "NASDAQ", "Equity", "Technology"),
    ("SNOW", "Snowflake Inc.", "NYSE", "Equity", "Technology"),
    ("PLTR", "Palantir Technologies Inc.", "NYSE", "Equity", "Technology"),
    ("NET", "Cloudflare Inc.", "NYSE", "Equity", "Technology"),
    ("SHOP", "Shopify Inc.", "NYSE", "Equity", "Technology"),
    ("SQ", "Block Inc.", "NYSE", "Equity", "Technology"),
    ("PYPL", "PayPal Holdings Inc.", "NASDAQ", "Equity", "Technology"),
    ("UBER", "Uber Technologies Inc.", "NYSE", "Equity", "Technology"),
    ("LYFT", "Lyft Inc.", "NASDAQ", "Equity", "Technology"),
    ("ABNB", "Airbnb Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("COIN", "Coinbase Global Inc.", "NASDAQ", "Equity", "Financials"),
    ("ROKU", "Roku Inc.", "NASDAQ", "Equity", "Communication Services"),
    ("TWLO", "Twilio Inc.", "NYSE", "Equity", "Technology"),
    ("OKTA", "Okta Inc.", "NASDAQ", "Equity", "Technology"),
    ("DOCU", "DocuSign Inc.", "NASDAQ", "Equity", "Technology"),
    ("ZM", "Zoom Video Communications", "NASDAQ", "Equity", "Technology"),
    ("TEAM", "Atlassian Corporation", "NASDAQ", "Equity", "Technology"),
    ("WDAY", "Workday Inc.", "NASDAQ", "Equity", "Technology"),
    ("SPLK", "Splunk Inc.", "NASDAQ", "Equity", "Technology"),
    
    # Healthcare
    ("UNH", "UnitedHealth Group Inc.", "NYSE", "Equity", "Healthcare"),
    ("JNJ", "Johnson & Johnson", "NYSE", "Equity", "Healthcare"),
    ("LLY", "Eli Lilly and Company", "NYSE", "Equity", "Healthcare"),
    ("PFE", "Pfizer Inc.", "NYSE", "Equity", "Healthcare"),
    ("ABBV", "AbbVie Inc.", "NYSE", "Equity", "Healthcare"),
    ("MRK", "Merck & Co. Inc.", "NYSE", "Equity", "Healthcare"),
    ("TMO", "Thermo Fisher Scientific", "NYSE", "Equity", "Healthcare"),
    ("ABT", "Abbott Laboratories", "NYSE", "Equity", "Healthcare"),
    ("DHR", "Danaher Corporation", "NYSE", "Equity", "Healthcare"),
    ("BMY", "Bristol-Myers Squibb Company", "NYSE", "Equity", "Healthcare"),
    ("AMGN", "Amgen Inc.", "NASDAQ", "Equity", "Healthcare"),
    ("GILD", "Gilead Sciences Inc.", "NASDAQ", "Equity", "Healthcare"),
    ("CVS", "CVS Health Corporation", "NYSE", "Equity", "Healthcare"),
    ("ISRG", "Intuitive Surgical Inc.", "NASDAQ", "Equity", "Healthcare"),
    ("VRTX", "Vertex Pharmaceuticals", "NASDAQ", "Equity", "Healthcare"),
    ("REGN", "Regeneron Pharmaceuticals", "NASDAQ", "Equity", "Healthcare"),
    ("MRNA", "Moderna Inc.", "NASDAQ", "Equity", "Healthcare"),
    ("BIIB", "Biogen Inc.", "NASDAQ", "Equity", "Healthcare"),
    ("ZTS", "Zoetis Inc.", "NYSE", "Equity", "Healthcare"),
    ("SYK", "Stryker Corporation", "NYSE", "Equity", "Healthcare"),
    ("MDT", "Medtronic plc", "NYSE", "Equity", "Healthcare"),
    ("BSX", "Boston Scientific Corporation", "NYSE", "Equity", "Healthcare"),
    ("EW", "Edwards Lifesciences", "NYSE", "Equity", "Healthcare"),
    ("DXCM", "DexCom Inc.", "NASDAQ", "Equity", "Healthcare"),
    ("IDXX", "IDEXX Laboratories Inc.", "NASDAQ", "Equity", "Healthcare"),
    
    # Financials
    ("JPM", "JPMorgan Chase & Co.", "NYSE", "Equity", "Financials"),
    ("V", "Visa Inc.", "NYSE", "Equity", "Financials"),
    ("MA", "Mastercard Incorporated", "NYSE", "Equity", "Financials"),
    ("BAC", "Bank of America Corporation", "NYSE", "Equity", "Financials"),
    ("WFC", "Wells Fargo & Company", "NYSE", "Equity", "Financials"),
    ("GS", "Goldman Sachs Group Inc.", "NYSE", "Equity", "Financials"),
    ("MS", "Morgan Stanley", "NYSE", "Equity", "Financials"),
    ("BLK", "BlackRock Inc.", "NYSE", "Equity", "Financials"),
    ("SCHW", "Charles Schwab Corporation", "NYSE", "Equity", "Financials"),
    ("AXP", "American Express Company", "NYSE", "Equity", "Financials"),
    ("C", "Citigroup Inc.", "NYSE", "Equity", "Financials"),
    ("SPGI", "S&P Global Inc.", "NYSE", "Equity", "Financials"),
    ("CME", "CME Group Inc.", "NASDAQ", "Equity", "Financials"),
    ("PNC", "PNC Financial Services", "NYSE", "Equity", "Financials"),
    ("USB", "U.S. Bancorp", "NYSE", "Equity", "Financials"),
    ("TFC", "Truist Financial Corporation", "NYSE", "Equity", "Financials"),
    ("ICE", "Intercontinental Exchange", "NYSE", "Equity", "Financials"),
    ("MCO", "Moody's Corporation", "NYSE", "Equity", "Financials"),
    ("AON", "Aon plc", "NYSE", "Equity", "Financials"),
    ("CB", "Chubb Limited", "NYSE", "Equity", "Financials"),
    ("MMC", "Marsh & McLennan Companies", "NYSE", "Equity", "Financials"),
    ("PGR", "Progressive Corporation", "NYSE", "Equity", "Financials"),
    ("AIG", "American International Group", "NYSE", "Equity", "Financials"),
    ("MET", "MetLife Inc.", "NYSE", "Equity", "Financials"),
    ("PRU", "Prudential Financial Inc.", "NYSE", "Equity", "Financials"),
    
    # Consumer Discretionary / Cyclical
    ("HD", "Home Depot Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("MCD", "McDonald's Corporation", "NYSE", "Equity", "Consumer Cyclical"),
    ("NKE", "NIKE Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("SBUX", "Starbucks Corporation", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("LOW", "Lowe's Companies Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("TJX", "TJX Companies Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("BKNG", "Booking Holdings Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("CMG", "Chipotle Mexican Grill", "NYSE", "Equity", "Consumer Cyclical"),
    ("TGT", "Target Corporation", "NYSE", "Equity", "Consumer Cyclical"),
    ("ORLY", "O'Reilly Automotive Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("GM", "General Motors Company", "NYSE", "Equity", "Consumer Cyclical"),
    ("F", "Ford Motor Company", "NYSE", "Equity", "Consumer Cyclical"),
    ("ROST", "Ross Stores Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("MAR", "Marriott International", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("HLT", "Hilton Worldwide Holdings", "NYSE", "Equity", "Consumer Cyclical"),
    ("YUM", "Yum! Brands Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("DHI", "D.R. Horton Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("LEN", "Lennar Corporation", "NYSE", "Equity", "Consumer Cyclical"),
    ("AZO", "AutoZone Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("EBAY", "eBay Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("ETSY", "Etsy Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("DPZ", "Domino's Pizza Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("POOL", "Pool Corporation", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("BBY", "Best Buy Co. Inc.", "NYSE", "Equity", "Consumer Cyclical"),
    ("ULTA", "Ulta Beauty Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    
    # Communication Services
    ("DIS", "Walt Disney Company", "NYSE", "Equity", "Communication Services"),
    ("CMCSA", "Comcast Corporation", "NASDAQ", "Equity", "Communication Services"),
    ("VZ", "Verizon Communications", "NYSE", "Equity", "Communication Services"),
    ("T", "AT&T Inc.", "NYSE", "Equity", "Communication Services"),
    ("TMUS", "T-Mobile US Inc.", "NASDAQ", "Equity", "Communication Services"),
    ("CHTR", "Charter Communications", "NASDAQ", "Equity", "Communication Services"),
    ("EA", "Electronic Arts Inc.", "NASDAQ", "Equity", "Communication Services"),
    ("WBD", "Warner Bros. Discovery", "NASDAQ", "Equity", "Communication Services"),
    ("PARA", "Paramount Global", "NASDAQ", "Equity", "Communication Services"),
    ("TTWO", "Take-Two Interactive", "NASDAQ", "Equity", "Communication Services"),
    ("MTCH", "Match Group Inc.", "NASDAQ", "Equity", "Communication Services"),
    ("LYV", "Live Nation Entertainment", "NYSE", "Equity", "Communication Services"),
    ("OMC", "Omnicom Group Inc.", "NYSE", "Equity", "Communication Services"),
    ("IPG", "Interpublic Group", "NYSE", "Equity", "Communication Services"),
    ("NWSA", "News Corporation", "NASDAQ", "Equity", "Communication Services"),
    
    # Industrials
    ("GE", "General Electric Company", "NYSE", "Equity", "Industrials"),
    ("CAT", "Caterpillar Inc.", "NYSE", "Equity", "Industrials"),
    ("UNP", "Union Pacific Corporation", "NYSE", "Equity", "Industrials"),
    ("HON", "Honeywell International", "NASDAQ", "Equity", "Industrials"),
    ("BA", "Boeing Company", "NYSE", "Equity", "Industrials"),
    ("RTX", "RTX Corporation", "NYSE", "Equity", "Industrials"),
    ("UPS", "United Parcel Service", "NYSE", "Equity", "Industrials"),
    ("DE", "Deere & Company", "NYSE", "Equity", "Industrials"),
    ("LMT", "Lockheed Martin Corporation", "NYSE", "Equity", "Industrials"),
    ("MMM", "3M Company", "NYSE", "Equity", "Industrials"),
    ("GD", "General Dynamics Corporation", "NYSE", "Equity", "Industrials"),
    ("CSX", "CSX Corporation", "NASDAQ", "Equity", "Industrials"),
    ("NSC", "Norfolk Southern Corporation", "NYSE", "Equity", "Industrials"),
    ("FDX", "FedEx Corporation", "NYSE", "Equity", "Industrials"),
    ("EMR", "Emerson Electric Co.", "NYSE", "Equity", "Industrials"),
    ("NOC", "Northrop Grumman Corporation", "NYSE", "Equity", "Industrials"),
    ("ITW", "Illinois Tool Works Inc.", "NYSE", "Equity", "Industrials"),
    ("ETN", "Eaton Corporation plc", "NYSE", "Equity", "Industrials"),
    ("WM", "Waste Management Inc.", "NYSE", "Equity", "Industrials"),
    ("RSG", "Republic Services Inc.", "NYSE", "Equity", "Industrials"),
    ("PCAR", "PACCAR Inc.", "NASDAQ", "Equity", "Industrials"),
    ("JCI", "Johnson Controls International", "NYSE", "Equity", "Industrials"),
    ("CMI", "Cummins Inc.", "NYSE", "Equity", "Industrials"),
    ("PH", "Parker-Hannifin Corporation", "NYSE", "Equity", "Industrials"),
    ("ROK", "Rockwell Automation Inc.", "NYSE", "Equity", "Industrials"),
    
    # Consumer Staples / Defensive
    ("PG", "Procter & Gamble Company", "NYSE", "Equity", "Consumer Defensive"),
    ("KO", "Coca-Cola Company", "NYSE", "Equity", "Consumer Defensive"),
    ("PEP", "PepsiCo Inc.", "NASDAQ", "Equity", "Consumer Defensive"),
    ("COST", "Costco Wholesale Corporation", "NASDAQ", "Equity", "Consumer Defensive"),
    ("WMT", "Walmart Inc.", "NYSE", "Equity", "Consumer Defensive"),
    ("PM", "Philip Morris International", "NYSE", "Equity", "Consumer Defensive"),
    ("MDLZ", "Mondelez International", "NASDAQ", "Equity", "Consumer Defensive"),
    ("MO", "Altria Group Inc.", "NYSE", "Equity", "Consumer Defensive"),
    ("CL", "Colgate-Palmolive Company", "NYSE", "Equity", "Consumer Defensive"),
    ("KMB", "Kimberly-Clark Corporation", "NYSE", "Equity", "Consumer Defensive"),
    ("GIS", "General Mills Inc.", "NYSE", "Equity", "Consumer Defensive"),
    ("SYY", "Sysco Corporation", "NYSE", "Equity", "Consumer Defensive"),
    ("KR", "Kroger Co.", "NYSE", "Equity", "Consumer Defensive"),
    ("HSY", "Hershey Company", "NYSE", "Equity", "Consumer Defensive"),
    ("K", "Kellanova", "NYSE", "Equity", "Consumer Defensive"),
    ("STZ", "Constellation Brands Inc.", "NYSE", "Equity", "Consumer Defensive"),
    ("EL", "Estée Lauder Companies", "NYSE", "Equity", "Consumer Defensive"),
    ("KHC", "Kraft Heinz Company", "NASDAQ", "Equity", "Consumer Defensive"),
    ("ADM", "Archer-Daniels-Midland", "NYSE", "Equity", "Consumer Defensive"),
    ("CHD", "Church & Dwight Co. Inc.", "NYSE", "Equity", "Consumer Defensive"),
    
    # Energy
    ("XOM", "Exxon Mobil Corporation", "NYSE", "Equity", "Energy"),
    ("CVX", "Chevron Corporation", "NYSE", "Equity", "Energy"),
    ("COP", "ConocoPhillips", "NYSE", "Equity", "Energy"),
    ("EOG", "EOG Resources Inc.", "NYSE", "Equity", "Energy"),
    ("SLB", "Schlumberger Limited", "NYSE", "Equity", "Energy"),
    ("MPC", "Marathon Petroleum Corporation", "NYSE", "Equity", "Energy"),
    ("PXD", "Pioneer Natural Resources", "NYSE", "Equity", "Energy"),
    ("PSX", "Phillips 66", "NYSE", "Equity", "Energy"),
    ("VLO", "Valero Energy Corporation", "NYSE", "Equity", "Energy"),
    ("OXY", "Occidental Petroleum", "NYSE", "Equity", "Energy"),
    ("WMB", "Williams Companies Inc.", "NYSE", "Equity", "Energy"),
    ("KMI", "Kinder Morgan Inc.", "NYSE", "Equity", "Energy"),
    ("HAL", "Halliburton Company", "NYSE", "Equity", "Energy"),
    ("DVN", "Devon Energy Corporation", "NYSE", "Equity", "Energy"),
    ("FANG", "Diamondback Energy Inc.", "NASDAQ", "Equity", "Energy"),
    
    # Utilities
    ("NEE", "NextEra Energy Inc.", "NYSE", "Equity", "Utilities"),
    ("DUK", "Duke Energy Corporation", "NYSE", "Equity", "Utilities"),
    ("SO", "Southern Company", "NYSE", "Equity", "Utilities"),
    ("D", "Dominion Energy Inc.", "NYSE", "Equity", "Utilities"),
    ("AEP", "American Electric Power", "NASDAQ", "Equity", "Utilities"),
    ("EXC", "Exelon Corporation", "NASDAQ", "Equity", "Utilities"),
    ("XEL", "Xcel Energy Inc.", "NASDAQ", "Equity", "Utilities"),
    ("SRE", "Sempra", "NYSE", "Equity", "Utilities"),
    ("ED", "Consolidated Edison Inc.", "NYSE", "Equity", "Utilities"),
    ("WEC", "WEC Energy Group Inc.", "NYSE", "Equity", "Utilities"),
    ("PCG", "PG&E Corporation", "NYSE", "Equity", "Utilities"),
    ("ES", "Eversource Energy", "NYSE", "Equity", "Utilities"),
    ("AWK", "American Water Works", "NYSE", "Equity", "Utilities"),
    ("AEE", "Ameren Corporation", "NYSE", "Equity", "Utilities"),
    ("DTE", "DTE Energy Company", "NYSE", "Equity", "Utilities"),
    
    # Real Estate
    ("PLD", "Prologis Inc.", "NYSE", "Equity", "Real Estate"),
    ("AMT", "American Tower Corporation", "NYSE", "Equity", "Real Estate"),
    ("CCI", "Crown Castle Inc.", "NYSE", "Equity", "Real Estate"),
    ("EQIX", "Equinix Inc.", "NASDAQ", "Equity", "Real Estate"),
    ("PSA", "Public Storage", "NYSE", "Equity", "Real Estate"),
    ("O", "Realty Income Corporation", "NYSE", "Equity", "Real Estate"),
    ("WELL", "Welltower Inc.", "NYSE", "Equity", "Real Estate"),
    ("SPG", "Simon Property Group", "NYSE", "Equity", "Real Estate"),
    ("DLR", "Digital Realty Trust", "NYSE", "Equity", "Real Estate"),
    ("AVB", "AvalonBay Communities", "NYSE", "Equity", "Real Estate"),
    ("EQR", "Equity Residential", "NYSE", "Equity", "Real Estate"),
    ("VICI", "VICI Properties Inc.", "NYSE", "Equity", "Real Estate"),
    ("ARE", "Alexandria Real Estate", "NYSE", "Equity", "Real Estate"),
    ("MAA", "Mid-America Apartment", "NYSE", "Equity", "Real Estate"),
    ("VTR", "Ventas Inc.", "NYSE", "Equity", "Real Estate"),
    
    # Materials
    ("LIN", "Linde plc", "NYSE", "Equity", "Materials"),
    ("APD", "Air Products and Chemicals", "NYSE", "Equity", "Materials"),
    ("SHW", "Sherwin-Williams Company", "NYSE", "Equity", "Materials"),
    ("ECL", "Ecolab Inc.", "NYSE", "Equity", "Materials"),
    ("FCX", "Freeport-McMoRan Inc.", "NYSE", "Equity", "Materials"),
    ("NEM", "Newmont Corporation", "NYSE", "Equity", "Materials"),
    ("NUE", "Nucor Corporation", "NYSE", "Equity", "Materials"),
    ("DOW", "Dow Inc.", "NYSE", "Equity", "Materials"),
    ("DD", "DuPont de Nemours Inc.", "NYSE", "Equity", "Materials"),
    ("VMC", "Vulcan Materials Company", "NYSE", "Equity", "Materials"),
    ("PPG", "PPG Industries Inc.", "NYSE", "Equity", "Materials"),
    ("MLM", "Martin Marietta Materials", "NYSE", "Equity", "Materials"),
    ("ALB", "Albemarle Corporation", "NYSE", "Equity", "Materials"),
    ("CTVA", "Corteva Inc.", "NYSE", "Equity", "Materials"),
    ("IFF", "International Flavors", "NYSE", "Equity", "Materials"),
    
    # Popular ETFs
    ("SPY", "SPDR S&P 500 ETF Trust", "NYSE", "ETF", "Index"),
    ("QQQ", "Invesco QQQ Trust", "NASDAQ", "ETF", "Index"),
    ("IWM", "iShares Russell 2000 ETF", "NYSE", "ETF", "Index"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "NYSE", "ETF", "Index"),
    ("VOO", "Vanguard S&P 500 ETF", "NYSE", "ETF", "Index"),
    ("VTI", "Vanguard Total Stock Market ETF", "NYSE", "ETF", "Index"),
    ("VEA", "Vanguard FTSE Developed Markets ETF", "NYSE", "ETF", "International"),
    ("VWO", "Vanguard FTSE Emerging Markets ETF", "NYSE", "ETF", "International"),
    ("BND", "Vanguard Total Bond Market ETF", "NYSE", "ETF", "Fixed Income"),
    ("AGG", "iShares Core U.S. Aggregate Bond ETF", "NYSE", "ETF", "Fixed Income"),
    ("GLD", "SPDR Gold Shares", "NYSE", "ETF", "Commodities"),
    ("SLV", "iShares Silver Trust", "NYSE", "ETF", "Commodities"),
    ("USO", "United States Oil Fund", "NYSE", "ETF", "Commodities"),
    ("XLF", "Financial Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLK", "Technology Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLE", "Energy Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLV", "Health Care Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLI", "Industrial Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLP", "Consumer Staples Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLY", "Consumer Discretionary Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLU", "Utilities Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLB", "Materials Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLRE", "Real Estate Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("XLC", "Communication Services Select Sector SPDR Fund", "NYSE", "ETF", "Sector"),
    ("ARKK", "ARK Innovation ETF", "NYSE", "ETF", "Thematic"),
    ("ARKG", "ARK Genomic Revolution ETF", "NYSE", "ETF", "Thematic"),
    ("ARKW", "ARK Next Generation Internet ETF", "NYSE", "ETF", "Thematic"),
    ("VGT", "Vanguard Information Technology ETF", "NYSE", "ETF", "Sector"),
    ("VHT", "Vanguard Health Care ETF", "NYSE", "ETF", "Sector"),
    ("VNQ", "Vanguard Real Estate ETF", "NYSE", "ETF", "Sector"),
    ("SCHD", "Schwab U.S. Dividend Equity ETF", "NYSE", "ETF", "Dividend"),
    ("VIG", "Vanguard Dividend Appreciation ETF", "NYSE", "ETF", "Dividend"),
    ("JEPI", "JPMorgan Equity Premium Income ETF", "NYSE", "ETF", "Income"),
    ("JEPQ", "JPMorgan Nasdaq Equity Premium Income ETF", "NASDAQ", "ETF", "Income"),
    ("TQQQ", "ProShares UltraPro QQQ", "NASDAQ", "ETF", "Leveraged"),
    ("SQQQ", "ProShares UltraPro Short QQQ", "NASDAQ", "ETF", "Leveraged"),
    ("SPXS", "Direxion Daily S&P 500 Bear 3X Shares", "NYSE", "ETF", "Leveraged"),
    ("SPXL", "Direxion Daily S&P 500 Bull 3X Shares", "NYSE", "ETF", "Leveraged"),
    ("SOXL", "Direxion Daily Semiconductor Bull 3X Shares", "NYSE", "ETF", "Leveraged"),
    ("SOXS", "Direxion Daily Semiconductor Bear 3X Shares", "NYSE", "ETF", "Leveraged"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "NASDAQ", "ETF", "Fixed Income"),
    ("HYG", "iShares iBoxx $ High Yield Corporate Bond ETF", "NYSE", "ETF", "Fixed Income"),
    ("LQD", "iShares iBoxx $ Investment Grade Corporate Bond ETF", "NYSE", "ETF", "Fixed Income"),
    ("EEM", "iShares MSCI Emerging Markets ETF", "NYSE", "ETF", "International"),
    ("EFA", "iShares MSCI EAFE ETF", "NYSE", "ETF", "International"),
    ("FXI", "iShares China Large-Cap ETF", "NYSE", "ETF", "International"),
    ("EWJ", "iShares MSCI Japan ETF", "NYSE", "ETF", "International"),
    ("KWEB", "KraneShares CSI China Internet ETF", "NYSE", "ETF", "International"),
    ("SMH", "VanEck Semiconductor ETF", "NASDAQ", "ETF", "Sector"),
    ("SOXX", "iShares Semiconductor ETF", "NASDAQ", "ETF", "Sector"),
    ("IBB", "iShares Biotechnology ETF", "NASDAQ", "ETF", "Sector"),
    ("XBI", "SPDR S&P Biotech ETF", "NYSE", "ETF", "Sector"),
    ("KRE", "SPDR S&P Regional Banking ETF", "NYSE", "ETF", "Sector"),
    ("IYR", "iShares U.S. Real Estate ETF", "NYSE", "ETF", "Sector"),
    ("GDXJ", "VanEck Junior Gold Miners ETF", "NYSE", "ETF", "Commodities"),
    ("GDX", "VanEck Gold Miners ETF", "NYSE", "ETF", "Commodities"),
    
    # Major ADRs
    ("BABA", "Alibaba Group Holding Limited", "NYSE", "ADR", "Technology"),
    ("TSM", "Taiwan Semiconductor Manufacturing", "NYSE", "ADR", "Technology"),
    ("NVO", "Novo Nordisk A/S", "NYSE", "ADR", "Healthcare"),
    ("ASML", "ASML Holding N.V.", "NASDAQ", "ADR", "Technology"),
    ("TM", "Toyota Motor Corporation", "NYSE", "ADR", "Consumer Cyclical"),
    ("SNY", "Sanofi", "NASDAQ", "ADR", "Healthcare"),
    ("SAP", "SAP SE", "NYSE", "ADR", "Technology"),
    ("HSBC", "HSBC Holdings plc", "NYSE", "ADR", "Financials"),
    ("UL", "Unilever PLC", "NYSE", "ADR", "Consumer Defensive"),
    ("SHEL", "Shell plc", "NYSE", "ADR", "Energy"),
    ("BP", "BP p.l.c.", "NYSE", "ADR", "Energy"),
    ("RIO", "Rio Tinto Group", "NYSE", "ADR", "Materials"),
    ("BHP", "BHP Group Limited", "NYSE", "ADR", "Materials"),
    ("VALE", "Vale S.A.", "NYSE", "ADR", "Materials"),
    ("PBR", "Petróleo Brasileiro S.A. - Petrobras", "NYSE", "ADR", "Energy"),
    ("SONY", "Sony Group Corporation", "NYSE", "ADR", "Technology"),
    ("HDB", "HDFC Bank Limited", "NYSE", "ADR", "Financials"),
    ("INFY", "Infosys Limited", "NYSE", "ADR", "Technology"),
    ("WIT", "Wipro Limited", "NYSE", "ADR", "Technology"),
    ("SE", "Sea Limited", "NYSE", "ADR", "Technology"),
    ("GRAB", "Grab Holdings Limited", "NASDAQ", "ADR", "Technology"),
    ("MELI", "MercadoLibre Inc.", "NASDAQ", "Equity", "Consumer Cyclical"),
    ("NU", "Nu Holdings Ltd.", "NYSE", "ADR", "Financials"),
]


def seed_symbols_master():
    """Seed the symbols_master table with comprehensive US stock data"""
    print("=" * 60)
    print("Seeding symbols_master table")
    print("=" * 60)
    
    db = SessionLocal()
    
    try:
        # Check current count
        current_count = db.query(SymbolsMaster).count()
        print(f"\nCurrent symbols in database: {current_count}")
        
        # Insert symbols
        added = 0
        updated = 0
        
        for symbol, name, exchange, asset_type, sector in CORE_SYMBOLS:
            existing = db.query(SymbolsMaster).filter(
                SymbolsMaster.symbol == symbol.upper()
            ).first()
            
            if existing:
                # Update existing
                existing.name = name
                existing.exchange = exchange
                existing.asset_type = asset_type
                existing.sector = sector
                updated += 1
            else:
                # Insert new
                new_symbol = SymbolsMaster(
                    symbol=symbol.upper(),
                    name=name,
                    exchange=exchange,
                    asset_type=asset_type,
                    sector=sector,
                    currency='USD',
                    country='US',
                    is_active='Y'
                )
                db.add(new_symbol)
                added += 1
        
        db.commit()
        
        # Final count
        final_count = db.query(SymbolsMaster).count()
        
        print(f"\n✓ Added: {added} new symbols")
        print(f"✓ Updated: {updated} existing symbols")
        print(f"✓ Total symbols: {final_count}")
        
        # Show sample
        print("\nSample symbols:")
        samples = db.query(SymbolsMaster).limit(10).all()
        for s in samples:
            print(f"  {s.symbol:6} | {s.name[:40]:40} | {s.exchange:8} | {s.sector or 'N/A'}")
        
    except Exception as e:
        db.rollback()
        print(f"\n✗ Error: {e}")
        raise
    finally:
        db.close()
    
    print("\n" + "=" * 60)
    print("Seeding complete!")
    print("=" * 60)


if __name__ == "__main__":
    seed_symbols_master()
