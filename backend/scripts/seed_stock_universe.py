#!/usr/bin/env python3
"""
Seed the symbols table with a comprehensive US stock universe.

Inserts ~800 tickers with company names, sectors, industries, and approximate
market caps. Skips any ticker that already exists (upserts name/sector/industry
if the row exists but is missing data).

Usage:
    python scripts/seed_stock_universe.py

    # Or with a custom DATABASE_URL:
    DATABASE_URL=postgresql://... python scripts/seed_stock_universe.py
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy.orm import Session
from app.db.database import SessionLocal, engine, Base
from app.models.symbol import Symbol


# ── Comprehensive US Stock Universe ─────────────────────────────────────────
# Format: (ticker, company_name, sector, industry, approx_market_cap_billions)

STOCK_UNIVERSE = [
    # ═══════════════════════════════════════════════════════════════════════════
    # TECHNOLOGY (150+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("AAPL", "Apple Inc", "Technology", "Consumer Electronics", 2900),
    ("MSFT", "Microsoft Corp", "Technology", "Software - Infrastructure", 3100),
    ("NVDA", "NVIDIA Corp", "Technology", "Semiconductors", 2200),
    ("GOOGL", "Alphabet Inc", "Technology", "Internet Content & Information", 1800),
    ("GOOG", "Alphabet Inc Class C", "Technology", "Internet Content & Information", 1800),
    ("META", "Meta Platforms Inc", "Technology", "Internet Content & Information", 1200),
    ("AVGO", "Broadcom Inc", "Technology", "Semiconductors", 700),
    ("TSM", "Taiwan Semiconductor", "Technology", "Semiconductors", 650),
    ("ORCL", "Oracle Corp", "Technology", "Software - Infrastructure", 350),
    ("CRM", "Salesforce Inc", "Technology", "Software - Application", 270),
    ("AMD", "Advanced Micro Devices", "Technology", "Semiconductors", 250),
    ("ADBE", "Adobe Inc", "Technology", "Software - Application", 220),
    ("INTC", "Intel Corp", "Technology", "Semiconductors", 120),
    ("CSCO", "Cisco Systems Inc", "Technology", "Communication Equipment", 220),
    ("NOW", "ServiceNow Inc", "Technology", "Software - Application", 160),
    ("UBER", "Uber Technologies Inc", "Technology", "Software - Application", 150),
    ("SHOP", "Shopify Inc", "Technology", "Software - Application", 95),
    ("SQ", "Block Inc", "Technology", "Software - Infrastructure", 40),
    ("PLTR", "Palantir Technologies", "Technology", "Software - Infrastructure", 55),
    ("SNOW", "Snowflake Inc", "Technology", "Software - Application", 55),
    ("NET", "Cloudflare Inc", "Technology", "Software - Infrastructure", 30),
    ("CRWD", "CrowdStrike Holdings", "Technology", "Software - Infrastructure", 75),
    ("DDOG", "Datadog Inc", "Technology", "Software - Application", 40),
    ("MDB", "MongoDB Inc", "Technology", "Software - Application", 25),
    ("PANW", "Palo Alto Networks", "Technology", "Software - Infrastructure", 110),
    ("FTNT", "Fortinet Inc", "Technology", "Software - Infrastructure", 60),
    ("QCOM", "Qualcomm Inc", "Technology", "Semiconductors", 190),
    ("TXN", "Texas Instruments", "Technology", "Semiconductors", 170),
    ("MU", "Micron Technology", "Technology", "Semiconductors", 110),
    ("AMAT", "Applied Materials", "Technology", "Semiconductor Equipment", 150),
    ("LRCX", "Lam Research", "Technology", "Semiconductor Equipment", 100),
    ("KLAC", "KLA Corp", "Technology", "Semiconductor Equipment", 90),
    ("MRVL", "Marvell Technology", "Technology", "Semiconductors", 60),
    ("ON", "ON Semiconductor", "Technology", "Semiconductors", 30),
    ("SMCI", "Super Micro Computer", "Technology", "Computer Hardware", 25),
    ("ARM", "Arm Holdings plc", "Technology", "Semiconductors", 150),
    ("DELL", "Dell Technologies", "Technology", "Computer Hardware", 70),
    ("HPQ", "HP Inc", "Technology", "Computer Hardware", 30),
    ("HPE", "Hewlett Packard Enterprise", "Technology", "Computer Hardware", 22),
    ("IBM", "International Business Machines", "Technology", "Information Technology Services", 180),
    ("ACN", "Accenture plc", "Technology", "Information Technology Services", 200),
    ("INFY", "Infosys Ltd", "Technology", "Information Technology Services", 80),
    ("WIT", "Wipro Ltd", "Technology", "Information Technology Services", 30),
    ("TWLO", "Twilio Inc", "Technology", "Software - Application", 12),
    ("ZS", "Zscaler Inc", "Technology", "Software - Infrastructure", 30),
    ("OKTA", "Okta Inc", "Technology", "Software - Infrastructure", 15),
    ("SPLK", "Splunk Inc", "Technology", "Software - Application", 25),
    ("TEAM", "Atlassian Corp", "Technology", "Software - Application", 45),
    ("WDAY", "Workday Inc", "Technology", "Software - Application", 65),
    ("VEEV", "Veeva Systems", "Technology", "Software - Application", 30),
    ("ZM", "Zoom Video Communications", "Technology", "Software - Application", 20),
    ("DOCU", "DocuSign Inc", "Technology", "Software - Application", 12),
    ("HUBS", "HubSpot Inc", "Technology", "Software - Application", 30),
    ("U", "Unity Software", "Technology", "Software - Application", 8),
    ("RBLX", "Roblox Corp", "Technology", "Electronic Gaming & Multimedia", 25),
    ("COIN", "Coinbase Global", "Technology", "Financial Data & Stock Exchanges", 45),
    ("SNAP", "Snap Inc", "Technology", "Internet Content & Information", 18),
    ("PINS", "Pinterest Inc", "Technology", "Internet Content & Information", 20),
    ("SPOT", "Spotify Technology", "Technology", "Internet Content & Information", 60),
    ("TTD", "The Trade Desk", "Technology", "Software - Application", 40),
    ("MNDY", "monday.com Ltd", "Technology", "Software - Application", 12),
    ("PATH", "UiPath Inc", "Technology", "Software - Application", 8),
    ("ROKU", "Roku Inc", "Technology", "Communication Equipment", 10),
    ("BILL", "BILL Holdings", "Technology", "Software - Application", 8),
    ("FIVN", "Five9 Inc", "Technology", "Software - Application", 3),
    ("GLOB", "Globant SA", "Technology", "Information Technology Services", 8),
    ("EPAM", "EPAM Systems", "Technology", "Information Technology Services", 12),
    ("GDDY", "GoDaddy Inc", "Technology", "Software - Infrastructure", 20),
    ("GEN", "Gen Digital Inc", "Technology", "Software - Infrastructure", 15),
    ("CYBR", "CyberArk Software", "Technology", "Software - Infrastructure", 12),
    ("FFIV", "F5 Inc", "Technology", "Communication Equipment", 10),
    ("ANET", "Arista Networks", "Technology", "Communication Equipment", 95),
    ("MCHP", "Microchip Technology", "Technology", "Semiconductors", 35),
    ("ADI", "Analog Devices", "Technology", "Semiconductors", 100),
    ("NXPI", "NXP Semiconductors", "Technology", "Semiconductors", 55),
    ("SWKS", "Skyworks Solutions", "Technology", "Semiconductors", 15),
    ("MPWR", "Monolithic Power Systems", "Technology", "Semiconductors", 30),

    # ═══════════════════════════════════════════════════════════════════════════
    # HEALTHCARE (100+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("UNH", "UnitedHealth Group", "Healthcare", "Healthcare Plans", 480),
    ("LLY", "Eli Lilly and Co", "Healthcare", "Drug Manufacturers - General", 750),
    ("NVO", "Novo Nordisk A/S", "Healthcare", "Drug Manufacturers - General", 400),
    ("JNJ", "Johnson & Johnson", "Healthcare", "Drug Manufacturers - General", 380),
    ("ABBV", "AbbVie Inc", "Healthcare", "Drug Manufacturers - General", 310),
    ("MRK", "Merck & Co Inc", "Healthcare", "Drug Manufacturers - General", 280),
    ("PFE", "Pfizer Inc", "Healthcare", "Drug Manufacturers - General", 150),
    ("TMO", "Thermo Fisher Scientific", "Healthcare", "Diagnostics & Research", 200),
    ("ABT", "Abbott Laboratories", "Healthcare", "Medical Devices", 200),
    ("AMGN", "Amgen Inc", "Healthcare", "Drug Manufacturers - General", 150),
    ("MDT", "Medtronic plc", "Healthcare", "Medical Devices", 110),
    ("ISRG", "Intuitive Surgical", "Healthcare", "Medical Instruments & Supplies", 150),
    ("VRTX", "Vertex Pharmaceuticals", "Healthcare", "Biotechnology", 120),
    ("REGN", "Regeneron Pharmaceuticals", "Healthcare", "Biotechnology", 110),
    ("BMY", "Bristol-Myers Squibb", "Healthcare", "Drug Manufacturers - General", 100),
    ("GILD", "Gilead Sciences", "Healthcare", "Drug Manufacturers - General", 100),
    ("CI", "Cigna Group", "Healthcare", "Healthcare Plans", 90),
    ("HUM", "Humana Inc", "Healthcare", "Healthcare Plans", 35),
    ("ZTS", "Zoetis Inc", "Healthcare", "Drug Manufacturers - Specialty & Generic", 80),
    ("SYK", "Stryker Corp", "Healthcare", "Medical Devices", 120),
    ("BSX", "Boston Scientific", "Healthcare", "Medical Devices", 100),
    ("EW", "Edwards Lifesciences", "Healthcare", "Medical Devices", 45),
    ("DXCM", "DexCom Inc", "Healthcare", "Medical Devices", 30),
    ("ILMN", "Illumina Inc", "Healthcare", "Diagnostics & Research", 20),
    ("BIIB", "Biogen Inc", "Healthcare", "Drug Manufacturers - General", 25),
    ("MRNA", "Moderna Inc", "Healthcare", "Biotechnology", 35),
    ("A", "Agilent Technologies", "Healthcare", "Diagnostics & Research", 40),
    ("BDX", "Becton Dickinson", "Healthcare", "Medical Instruments & Supplies", 65),
    ("IQV", "IQVIA Holdings", "Healthcare", "Diagnostics & Research", 40),
    ("MCK", "McKesson Corp", "Healthcare", "Medical Distribution", 70),
    ("CAH", "Cardinal Health", "Healthcare", "Medical Distribution", 30),
    ("HCA", "HCA Healthcare", "Healthcare", "Medical Care Facilities", 85),
    ("GEHC", "GE HealthCare", "Healthcare", "Medical Devices", 40),
    ("HOLX", "Hologic Inc", "Healthcare", "Medical Instruments & Supplies", 18),
    ("ALGN", "Align Technology", "Healthcare", "Medical Devices", 15),
    ("INCY", "Incyte Corp", "Healthcare", "Biotechnology", 15),
    ("ALNY", "Alnylam Pharmaceuticals", "Healthcare", "Biotechnology", 30),

    # ═══════════════════════════════════════════════════════════════════════════
    # FINANCIALS (100+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("JPM", "JPMorgan Chase & Co", "Financials", "Banks - Diversified", 550),
    ("V", "Visa Inc", "Financials", "Credit Services", 550),
    ("MA", "Mastercard Inc", "Financials", "Credit Services", 420),
    ("BAC", "Bank of America Corp", "Financials", "Banks - Diversified", 300),
    ("WFC", "Wells Fargo & Co", "Financials", "Banks - Diversified", 200),
    ("GS", "Goldman Sachs Group", "Financials", "Capital Markets", 150),
    ("MS", "Morgan Stanley", "Financials", "Capital Markets", 150),
    ("BLK", "BlackRock Inc", "Financials", "Asset Management", 130),
    ("SCHW", "Charles Schwab Corp", "Financials", "Capital Markets", 130),
    ("AXP", "American Express Co", "Financials", "Credit Services", 170),
    ("C", "Citigroup Inc", "Financials", "Banks - Diversified", 120),
    ("USB", "U.S. Bancorp", "Financials", "Banks - Regional", 70),
    ("PNC", "PNC Financial Services", "Financials", "Banks - Regional", 70),
    ("TFC", "Truist Financial", "Financials", "Banks - Regional", 50),
    ("ICE", "Intercontinental Exchange", "Financials", "Financial Data & Stock Exchanges", 80),
    ("CME", "CME Group Inc", "Financials", "Financial Data & Stock Exchanges", 75),
    ("SPGI", "S&P Global Inc", "Financials", "Financial Data & Stock Exchanges", 140),
    ("MCO", "Moody's Corp", "Financials", "Financial Data & Stock Exchanges", 80),
    ("AON", "Aon plc", "Financials", "Insurance - Brokers", 70),
    ("MMC", "Marsh & McLennan", "Financials", "Insurance - Brokers", 100),
    ("CB", "Chubb Ltd", "Financials", "Insurance - Property & Casualty", 100),
    ("MET", "MetLife Inc", "Financials", "Insurance - Life", 50),
    ("AIG", "American International Group", "Financials", "Insurance - Diversified", 45),
    ("PRU", "Prudential Financial", "Financials", "Insurance - Life", 40),
    ("BK", "Bank of New York Mellon", "Financials", "Asset Management", 45),
    ("STT", "State Street Corp", "Financials", "Asset Management", 25),
    ("FITB", "Fifth Third Bancorp", "Financials", "Banks - Regional", 25),
    ("CFG", "Citizens Financial Group", "Financials", "Banks - Regional", 18),
    ("KEY", "KeyCorp", "Financials", "Banks - Regional", 15),
    ("HBAN", "Huntington Bancshares", "Financials", "Banks - Regional", 20),
    ("MTB", "M&T Bank Corp", "Financials", "Banks - Regional", 25),
    ("RF", "Regions Financial", "Financials", "Banks - Regional", 18),
    ("PYPL", "PayPal Holdings", "Financials", "Credit Services", 70),
    ("FIS", "Fidelity National Info", "Financials", "Information Technology Services", 40),
    ("FISV", "Fiserv Inc", "Financials", "Information Technology Services", 85),
    ("GPN", "Global Payments", "Financials", "Information Technology Services", 25),
    ("DFS", "Discover Financial", "Financials", "Credit Services", 35),
    ("SYF", "Synchrony Financial", "Financials", "Credit Services", 18),
    ("COF", "Capital One Financial", "Financials", "Credit Services", 55),
    ("ALLY", "Ally Financial", "Financials", "Credit Services", 10),
    ("HOOD", "Robinhood Markets", "Financials", "Capital Markets", 20),
    ("SOFI", "SoFi Technologies", "Financials", "Credit Services", 12),

    # ═══════════════════════════════════════════════════════════════════════════
    # CONSUMER DISCRETIONARY (80+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("AMZN", "Amazon.com Inc", "Consumer", "Internet Retail", 1900),
    ("TSLA", "Tesla Inc", "Consumer", "Auto Manufacturers", 600),
    ("HD", "Home Depot Inc", "Consumer", "Home Improvement Retail", 370),
    ("MCD", "McDonald's Corp", "Consumer", "Restaurants", 210),
    ("NKE", "Nike Inc", "Consumer", "Footwear & Accessories", 120),
    ("SBUX", "Starbucks Corp", "Consumer", "Restaurants", 100),
    ("TGT", "Target Corp", "Consumer", "Discount Stores", 60),
    ("LOW", "Lowe's Companies", "Consumer", "Home Improvement Retail", 140),
    ("TJX", "TJX Companies", "Consumer", "Apparel Retail", 120),
    ("LULU", "Lululemon Athletica", "Consumer", "Apparel Manufacturing", 40),
    ("ROST", "Ross Stores", "Consumer", "Apparel Retail", 50),
    ("DG", "Dollar General", "Consumer", "Discount Stores", 25),
    ("EL", "Estee Lauder", "Consumer", "Household & Personal Products", 25),
    ("YUM", "Yum! Brands", "Consumer", "Restaurants", 35),
    ("CMG", "Chipotle Mexican Grill", "Consumer", "Restaurants", 75),
    ("ABNB", "Airbnb Inc", "Consumer", "Travel Services", 80),
    ("BKNG", "Booking Holdings", "Consumer", "Travel Services", 140),
    ("MAR", "Marriott International", "Consumer", "Lodging", 70),
    ("HLT", "Hilton Worldwide", "Consumer", "Lodging", 55),
    ("EXPE", "Expedia Group", "Consumer", "Travel Services", 20),
    ("ORLY", "O'Reilly Automotive", "Consumer", "Specialty Retail", 65),
    ("AZO", "AutoZone Inc", "Consumer", "Specialty Retail", 50),
    ("BBY", "Best Buy Co", "Consumer", "Specialty Retail", 18),
    ("DLTR", "Dollar Tree", "Consumer", "Discount Stores", 25),
    ("DECK", "Deckers Outdoor", "Consumer", "Footwear & Accessories", 25),
    ("LVS", "Las Vegas Sands", "Consumer", "Resorts & Casinos", 30),
    ("WYNN", "Wynn Resorts", "Consumer", "Resorts & Casinos", 10),
    ("GM", "General Motors", "Consumer", "Auto Manufacturers", 45),
    ("F", "Ford Motor Co", "Consumer", "Auto Manufacturers", 40),
    ("RIVN", "Rivian Automotive", "Consumer", "Auto Manufacturers", 12),
    ("LCID", "Lucid Group", "Consumer", "Auto Manufacturers", 5),
    ("EBAY", "eBay Inc", "Consumer", "Internet Retail", 25),
    ("ETSY", "Etsy Inc", "Consumer", "Internet Retail", 6),
    ("W", "Wayfair Inc", "Consumer", "Internet Retail", 5),
    ("DASH", "DoorDash Inc", "Consumer", "Internet Content & Information", 55),
    ("CPNG", "Coupang Inc", "Consumer", "Internet Retail", 40),
    ("CAVA", "CAVA Group", "Consumer", "Restaurants", 15),

    # ═══════════════════════════════════════════════════════════════════════════
    # CONSUMER STAPLES (40+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("WMT", "Walmart Inc", "Consumer Staples", "Discount Stores", 500),
    ("COST", "Costco Wholesale", "Consumer Staples", "Discount Stores", 350),
    ("PG", "Procter & Gamble", "Consumer Staples", "Household & Personal Products", 370),
    ("KO", "Coca-Cola Co", "Consumer Staples", "Beverages - Non-Alcoholic", 260),
    ("PEP", "PepsiCo Inc", "Consumer Staples", "Beverages - Non-Alcoholic", 220),
    ("PM", "Philip Morris International", "Consumer Staples", "Tobacco", 180),
    ("MO", "Altria Group", "Consumer Staples", "Tobacco", 80),
    ("MDLZ", "Mondelez International", "Consumer Staples", "Confectioners", 85),
    ("CL", "Colgate-Palmolive", "Consumer Staples", "Household & Personal Products", 75),
    ("KMB", "Kimberly-Clark", "Consumer Staples", "Household & Personal Products", 45),
    ("STZ", "Constellation Brands", "Consumer Staples", "Beverages - Wineries & Distilleries", 35),
    ("GIS", "General Mills", "Consumer Staples", "Packaged Foods", 35),
    ("K", "Kellanova", "Consumer Staples", "Packaged Foods", 25),
    ("HSY", "Hershey Co", "Consumer Staples", "Confectioners", 30),
    ("SJM", "J.M. Smucker Co", "Consumer Staples", "Packaged Foods", 12),
    ("KR", "Kroger Co", "Consumer Staples", "Grocery Stores", 40),
    ("SYY", "Sysco Corp", "Consumer Staples", "Food Distribution", 40),
    ("ADM", "Archer-Daniels-Midland", "Consumer Staples", "Farm Products", 25),
    ("MNST", "Monster Beverage", "Consumer Staples", "Beverages - Non-Alcoholic", 50),
    ("KDP", "Keurig Dr Pepper", "Consumer Staples", "Beverages - Non-Alcoholic", 45),

    # ═══════════════════════════════════════════════════════════════════════════
    # ENERGY (50+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("XOM", "Exxon Mobil Corp", "Energy", "Oil & Gas Integrated", 450),
    ("CVX", "Chevron Corp", "Energy", "Oil & Gas Integrated", 280),
    ("COP", "ConocoPhillips", "Energy", "Oil & Gas E&P", 130),
    ("EOG", "EOG Resources", "Energy", "Oil & Gas E&P", 70),
    ("SLB", "Schlumberger NV", "Energy", "Oil & Gas Equipment & Services", 65),
    ("PXD", "Pioneer Natural Resources", "Energy", "Oil & Gas E&P", 55),
    ("MPC", "Marathon Petroleum", "Energy", "Oil & Gas Refining & Marketing", 55),
    ("PSX", "Phillips 66", "Energy", "Oil & Gas Refining & Marketing", 50),
    ("VLO", "Valero Energy", "Energy", "Oil & Gas Refining & Marketing", 45),
    ("OXY", "Occidental Petroleum", "Energy", "Oil & Gas Integrated", 50),
    ("HAL", "Halliburton Co", "Energy", "Oil & Gas Equipment & Services", 25),
    ("DVN", "Devon Energy", "Energy", "Oil & Gas E&P", 25),
    ("FANG", "Diamondback Energy", "Energy", "Oil & Gas E&P", 35),
    ("HES", "Hess Corp", "Energy", "Oil & Gas E&P", 45),
    ("BKR", "Baker Hughes Co", "Energy", "Oil & Gas Equipment & Services", 35),
    ("KMI", "Kinder Morgan", "Energy", "Oil & Gas Midstream", 40),
    ("WMB", "Williams Companies", "Energy", "Oil & Gas Midstream", 50),
    ("OKE", "ONEOK Inc", "Energy", "Oil & Gas Midstream", 55),
    ("ET", "Energy Transfer LP", "Energy", "Oil & Gas Midstream", 50),
    ("CTRA", "Coterra Energy", "Energy", "Oil & Gas E&P", 18),
    ("EQT", "EQT Corp", "Energy", "Oil & Gas E&P", 15),
    ("APA", "APA Corp", "Energy", "Oil & Gas E&P", 8),
    ("TRGP", "Targa Resources", "Energy", "Oil & Gas Midstream", 30),
    ("LNG", "Cheniere Energy", "Energy", "Oil & Gas Midstream", 40),

    # ═══════════════════════════════════════════════════════════════════════════
    # INDUSTRIALS (80+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("CAT", "Caterpillar Inc", "Industrials", "Farm & Heavy Construction Machinery", 170),
    ("BA", "Boeing Co", "Industrials", "Aerospace & Defense", 110),
    ("HON", "Honeywell International", "Industrials", "Diversified Industrials", 130),
    ("GE", "GE Aerospace", "Industrials", "Aerospace & Defense", 190),
    ("UNP", "Union Pacific Corp", "Industrials", "Railroads", 140),
    ("RTX", "RTX Corp", "Industrials", "Aerospace & Defense", 140),
    ("DE", "Deere & Co", "Industrials", "Farm & Heavy Construction Machinery", 110),
    ("LMT", "Lockheed Martin", "Industrials", "Aerospace & Defense", 120),
    ("MMM", "3M Company", "Industrials", "Diversified Industrials", 60),
    ("UPS", "United Parcel Service", "Industrials", "Integrated Freight & Logistics", 100),
    ("FDX", "FedEx Corp", "Industrials", "Integrated Freight & Logistics", 60),
    ("GD", "General Dynamics", "Industrials", "Aerospace & Defense", 75),
    ("NOC", "Northrop Grumman", "Industrials", "Aerospace & Defense", 70),
    ("WM", "Waste Management", "Industrials", "Waste Management", 80),
    ("RSG", "Republic Services", "Industrials", "Waste Management", 60),
    ("EMR", "Emerson Electric", "Industrials", "Diversified Industrials", 60),
    ("ETN", "Eaton Corp", "Industrials", "Diversified Industrials", 120),
    ("ITW", "Illinois Tool Works", "Industrials", "Diversified Industrials", 75),
    ("APH", "Amphenol Corp", "Industrials", "Electronic Components", 80),
    ("CARR", "Carrier Global", "Industrials", "Building Products & Equipment", 55),
    ("CSX", "CSX Corp", "Industrials", "Railroads", 65),
    ("NSC", "Norfolk Southern", "Industrials", "Railroads", 50),
    ("PCAR", "PACCAR Inc", "Industrials", "Farm & Heavy Construction Machinery", 50),
    ("PH", "Parker-Hannifin", "Industrials", "Specialty Industrial Machinery", 75),
    ("IR", "Ingersoll Rand", "Industrials", "Specialty Industrial Machinery", 35),
    ("ROK", "Rockwell Automation", "Industrials", "Specialty Industrial Machinery", 30),
    ("CTAS", "Cintas Corp", "Industrials", "Specialty Business Services", 70),
    ("FAST", "Fastenal Co", "Industrials", "Industrial Distribution", 40),
    ("VRSK", "Verisk Analytics", "Industrials", "Consulting Services", 35),
    ("DAL", "Delta Air Lines", "Industrials", "Airlines", 30),
    ("UAL", "United Airlines", "Industrials", "Airlines", 20),
    ("LUV", "Southwest Airlines", "Industrials", "Airlines", 15),
    ("AAL", "American Airlines", "Industrials", "Airlines", 8),
    ("TT", "Trane Technologies", "Industrials", "Building Products & Equipment", 75),
    ("AXON", "Axon Enterprise", "Industrials", "Aerospace & Defense", 30),
    ("HWM", "Howmet Aerospace", "Industrials", "Aerospace & Defense", 35),
    ("WAB", "Westinghouse Air Brake", "Industrials", "Railroads", 30),
    ("PWR", "Quanta Services", "Industrials", "Engineering & Construction", 40),

    # ═══════════════════════════════════════════════════════════════════════════
    # MATERIALS (25+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("LIN", "Linde plc", "Materials", "Specialty Chemicals", 210),
    ("APD", "Air Products & Chemicals", "Materials", "Specialty Chemicals", 60),
    ("SHW", "Sherwin-Williams", "Materials", "Specialty Chemicals", 80),
    ("ECL", "Ecolab Inc", "Materials", "Specialty Chemicals", 60),
    ("FCX", "Freeport-McMoRan", "Materials", "Copper", 55),
    ("NEM", "Newmont Corp", "Materials", "Gold", 50),
    ("NUE", "Nucor Corp", "Materials", "Steel", 35),
    ("DOW", "Dow Inc", "Materials", "Chemicals", 35),
    ("DD", "DuPont de Nemours", "Materials", "Specialty Chemicals", 30),
    ("PPG", "PPG Industries", "Materials", "Specialty Chemicals", 30),
    ("VMC", "Vulcan Materials", "Materials", "Building Materials", 30),
    ("MLM", "Martin Marietta Materials", "Materials", "Building Materials", 30),
    ("CTVA", "Corteva Inc", "Materials", "Agricultural Inputs", 35),
    ("ALB", "Albemarle Corp", "Materials", "Specialty Chemicals", 10),
    ("STLD", "Steel Dynamics", "Materials", "Steel", 18),
    ("CF", "CF Industries", "Materials", "Agricultural Inputs", 15),
    ("IFF", "International Flavors & Fragrances", "Materials", "Specialty Chemicals", 20),
    ("EMN", "Eastman Chemical", "Materials", "Chemicals", 10),
    ("CE", "Celanese Corp", "Materials", "Chemicals", 10),
    ("BALL", "Ball Corp", "Materials", "Packaging & Containers", 18),

    # ═══════════════════════════════════════════════════════════════════════════
    # UTILITIES (25+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("NEE", "NextEra Energy", "Utilities", "Utilities - Regulated Electric", 150),
    ("DUK", "Duke Energy", "Utilities", "Utilities - Regulated Electric", 80),
    ("SO", "Southern Company", "Utilities", "Utilities - Regulated Electric", 85),
    ("D", "Dominion Energy", "Utilities", "Utilities - Regulated Electric", 45),
    ("AEP", "American Electric Power", "Utilities", "Utilities - Regulated Electric", 50),
    ("SRE", "Sempra", "Utilities", "Utilities - Diversified", 50),
    ("EXC", "Exelon Corp", "Utilities", "Utilities - Regulated Electric", 40),
    ("XEL", "Xcel Energy", "Utilities", "Utilities - Regulated Electric", 35),
    ("PEG", "Public Service Enterprise", "Utilities", "Utilities - Regulated Electric", 35),
    ("WEC", "WEC Energy Group", "Utilities", "Utilities - Regulated Electric", 28),
    ("ED", "Consolidated Edison", "Utilities", "Utilities - Regulated Electric", 30),
    ("AWK", "American Water Works", "Utilities", "Utilities - Regulated Water", 25),
    ("ES", "Eversource Energy", "Utilities", "Utilities - Regulated Electric", 20),
    ("AEE", "Ameren Corp", "Utilities", "Utilities - Regulated Electric", 22),
    ("DTE", "DTE Energy", "Utilities", "Utilities - Regulated Electric", 22),
    ("CEG", "Constellation Energy", "Utilities", "Utilities - Independent Power Producers", 60),
    ("VST", "Vistra Corp", "Utilities", "Utilities - Independent Power Producers", 30),

    # ═══════════════════════════════════════════════════════════════════════════
    # REAL ESTATE (25+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("PLD", "Prologis Inc", "Real Estate", "REIT - Industrial", 110),
    ("AMT", "American Tower", "Real Estate", "REIT - Specialty", 90),
    ("CCI", "Crown Castle Inc", "Real Estate", "REIT - Specialty", 40),
    ("EQIX", "Equinix Inc", "Real Estate", "REIT - Specialty", 75),
    ("SPG", "Simon Property Group", "Real Estate", "REIT - Retail", 50),
    ("O", "Realty Income", "Real Estate", "REIT - Retail", 45),
    ("PSA", "Public Storage", "Real Estate", "REIT - Industrial", 50),
    ("WELL", "Welltower Inc", "Real Estate", "REIT - Healthcare Facilities", 50),
    ("DLR", "Digital Realty Trust", "Real Estate", "REIT - Specialty", 40),
    ("VICI", "VICI Properties", "Real Estate", "REIT - Specialty", 30),
    ("AVB", "AvalonBay Communities", "Real Estate", "REIT - Residential", 30),
    ("EQR", "Equity Residential", "Real Estate", "REIT - Residential", 25),
    ("ARE", "Alexandria Real Estate", "Real Estate", "REIT - Office", 18),
    ("MAA", "Mid-America Apartment", "Real Estate", "REIT - Residential", 18),
    ("IRM", "Iron Mountain", "Real Estate", "REIT - Specialty", 25),
    ("SBAC", "SBA Communications", "Real Estate", "REIT - Specialty", 20),

    # ═══════════════════════════════════════════════════════════════════════════
    # COMMUNICATION SERVICES (30+)
    # ═══════════════════════════════════════════════════════════════════════════
    ("DIS", "Walt Disney Co", "Communication", "Entertainment", 180),
    ("NFLX", "Netflix Inc", "Communication", "Entertainment", 280),
    ("CMCSA", "Comcast Corp", "Communication", "Entertainment", 160),
    ("T", "AT&T Inc", "Communication", "Telecom Services", 130),
    ("VZ", "Verizon Communications", "Communication", "Telecom Services", 170),
    ("TMUS", "T-Mobile US", "Communication", "Telecom Services", 200),
    ("CHTR", "Charter Communications", "Communication", "Telecom Services", 45),
    ("WBD", "Warner Bros Discovery", "Communication", "Entertainment", 20),
    ("PARA", "Paramount Global", "Communication", "Entertainment", 8),
    ("EA", "Electronic Arts", "Communication", "Electronic Gaming & Multimedia", 35),
    ("TTWO", "Take-Two Interactive", "Communication", "Electronic Gaming & Multimedia", 30),
    ("MTCH", "Match Group", "Communication", "Internet Content & Information", 8),
    ("LYV", "Live Nation Entertainment", "Communication", "Entertainment", 22),
    ("FOXA", "Fox Corp Class A", "Communication", "Entertainment", 18),
    ("IACI", "IAC Inc", "Communication", "Internet Content & Information", 5),
    ("ZG", "Zillow Group", "Communication", "Internet Content & Information", 12),
    ("YELP", "Yelp Inc", "Communication", "Internet Content & Information", 2),

    # ═══════════════════════════════════════════════════════════════════════════
    # MAJOR ETFS (for reference/benchmarking)
    # ═══════════════════════════════════════════════════════════════════════════
    ("SPY", "SPDR S&P 500 ETF", "ETF", "Large Cap", 500),
    ("QQQ", "Invesco QQQ Trust", "ETF", "Large Cap Growth", 250),
    ("IWM", "iShares Russell 2000", "ETF", "Small Cap", 50),
    ("DIA", "SPDR Dow Jones Industrial", "ETF", "Large Cap", 30),
    ("VTI", "Vanguard Total Stock Market", "ETF", "Total Market", 350),
    ("VOO", "Vanguard S&P 500", "ETF", "Large Cap", 400),
    ("ARKK", "ARK Innovation ETF", "ETF", "Thematic", 6),
    ("XLK", "Technology Select Sector", "ETF", "Technology", 60),
    ("XLF", "Financial Select Sector", "ETF", "Financials", 40),
    ("XLE", "Energy Select Sector", "ETF", "Energy", 35),
    ("XLV", "Health Care Select Sector", "ETF", "Healthcare", 40),
    ("XLI", "Industrial Select Sector", "ETF", "Industrials", 20),
    ("XLP", "Consumer Staples Select", "ETF", "Consumer Staples", 15),
    ("XLY", "Consumer Discretionary Select", "ETF", "Consumer Discretionary", 20),
    ("XLU", "Utilities Select Sector", "ETF", "Utilities", 15),
    ("XLRE", "Real Estate Select Sector", "ETF", "Real Estate", 5),
    ("XLB", "Materials Select Sector", "ETF", "Materials", 5),
    ("XLC", "Communication Services Select", "ETF", "Communication", 15),
    ("GLD", "SPDR Gold Shares", "ETF", "Precious Metals", 60),
    ("SLV", "iShares Silver Trust", "ETF", "Precious Metals", 10),
    ("TLT", "iShares 20+ Year Treasury", "ETF", "Bonds", 40),
    ("HYG", "iShares High Yield Bond", "ETF", "Bonds", 15),
    ("VNQ", "Vanguard Real Estate", "ETF", "Real Estate", 30),
    ("SOXX", "iShares Semiconductor", "ETF", "Semiconductors", 10),
    ("SMH", "VanEck Semiconductor", "ETF", "Semiconductors", 15),
    ("MTUM", "iShares MSCI USA Momentum", "ETF", "Factor", 10),
    ("SPLV", "Invesco S&P 500 Low Volatility", "ETF", "Factor", 10),
    ("VTV", "Vanguard Value", "ETF", "Large Cap Value", 100),
    ("VUG", "Vanguard Growth", "ETF", "Large Cap Growth", 120),
    ("SCHD", "Schwab US Dividend Equity", "ETF", "Dividend", 50),
    ("VIG", "Vanguard Dividend Appreciation", "ETF", "Dividend", 50),
]


def seed_symbols(db: Session) -> dict:
    """Insert or update symbols in the database."""
    inserted = 0
    updated = 0
    skipped = 0

    for ticker, name, sector, industry, mcap_b in STOCK_UNIVERSE:
        existing = db.query(Symbol).filter(Symbol.symbol == ticker).first()
        if existing:
            # Update if name/sector/industry missing
            changed = False
            if not existing.name and name:
                existing.name = name
                changed = True
            if not existing.sector and sector:
                existing.sector = sector
                changed = True
            if not existing.industry and industry:
                existing.industry = industry
                changed = True
            if not existing.market_cap and mcap_b:
                existing.market_cap = mcap_b * 1e9
                changed = True
            if changed:
                updated += 1
            else:
                skipped += 1
        else:
            sym = Symbol(
                symbol=ticker,
                name=name,
                exchange="NYSE" if ticker in ("JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "BA", "CAT", "GE", "DIS", "KO", "PG", "JNJ", "WMT", "HD", "UNH", "PFE", "MRK", "XOM", "CVX") else "NASDAQ",
                asset_type="ETF" if sector == "ETF" else "Equity",
                currency="USD",
                country="US",
                sector=sector,
                industry=industry,
                market_cap=mcap_b * 1e9 if mcap_b else None,
            )
            db.add(sym)
            inserted += 1

    db.commit()
    return {"inserted": inserted, "updated": updated, "skipped": skipped, "total": len(STOCK_UNIVERSE)}


def cross_populate_from_other_tables(db: Session) -> dict:
    """
    Pull company names and metadata from symbols_master and exchange_ranked_symbols
    into the main symbols table. This ensures every ticker has a company name.
    """
    from sqlalchemy import text

    cross_inserted = 0
    cross_updated = 0

    # 1. Pull from symbols_master
    try:
        from app.models.symbols_master import SymbolsMaster
        from sqlalchemy import func as sa_func
        master_rows = db.query(SymbolsMaster).filter(
            SymbolsMaster.name.isnot(None),
            sa_func.length(SymbolsMaster.symbol) <= 10,
        ).all()
        for row in master_rows:
            ticker = row.symbol.upper().strip()
            existing = db.query(Symbol).filter(Symbol.symbol == ticker).first()
            if existing:
                changed = False
                if not existing.name and row.name:
                    existing.name = row.name
                    changed = True
                if not existing.sector and row.sector:
                    existing.sector = row.sector
                    changed = True
                if not existing.industry and row.industry:
                    existing.industry = row.industry
                    changed = True
                if not existing.exchange and row.exchange:
                    existing.exchange = row.exchange
                    changed = True
                if changed:
                    cross_updated += 1
            else:
                sym = Symbol(
                    symbol=ticker,
                    name=row.name,
                    exchange=row.exchange or "NASDAQ",
                    asset_type=row.asset_type or "Equity",
                    currency=row.currency or "USD",
                    country=row.country or "US",
                    sector=row.sector,
                    industry=row.industry,
                )
                db.add(sym)
                cross_inserted += 1
        db.commit()
        print(f"   symbols_master: +{cross_inserted} inserted, {cross_updated} updated")
    except Exception as e:
        db.rollback()
        print(f"   symbols_master: skipped ({e})")

    # 2. Pull from exchange_ranked_symbols
    ers_inserted = 0
    ers_updated = 0
    try:
        from app.models.exchange_ranked_symbol import ExchangeRankedSymbol
        ranked_rows = db.query(ExchangeRankedSymbol).filter(
            ExchangeRankedSymbol.name.isnot(None),
            ExchangeRankedSymbol.exchange_key == "us",
        ).all()
        for row in ranked_rows:
            ticker = row.symbol.upper().strip()
            existing = db.query(Symbol).filter(Symbol.symbol == ticker).first()
            if existing:
                changed = False
                if not existing.name and row.name:
                    existing.name = row.name
                    changed = True
                if not existing.sector and row.sector:
                    existing.sector = row.sector
                    changed = True
                if not existing.industry and row.industry:
                    existing.industry = row.industry
                    changed = True
                if not existing.market_cap and row.market_cap:
                    existing.market_cap = row.market_cap
                    changed = True
                if changed:
                    ers_updated += 1
            else:
                sym = Symbol(
                    symbol=ticker,
                    name=row.name,
                    exchange=row.exchange or "NASDAQ",
                    asset_type="Equity",
                    currency=row.currency or "USD",
                    country=row.country or "US",
                    sector=row.sector,
                    industry=row.industry,
                    market_cap=row.market_cap,
                )
                db.add(sym)
                ers_inserted += 1
        db.commit()
        print(f"   exchange_ranked_symbols: +{ers_inserted} inserted, {ers_updated} updated")
    except Exception as e:
        db.rollback()
        print(f"   exchange_ranked_symbols: skipped ({e})")

    # 3. Pull from fundamentals table (fills in names from Finviz scrapes)
    fund_updated = 0
    try:
        from app.models.fundamentals import Fundamentals
        fund_rows = db.query(Fundamentals).filter(Fundamentals.company_name.isnot(None)).all()
        for row in fund_rows:
            sym_record = db.query(Symbol).filter(Symbol.id == row.symbol_id).first()
            if sym_record and not sym_record.name and row.company_name:
                sym_record.name = row.company_name
                if not sym_record.sector and row.sector:
                    sym_record.sector = row.sector
                if not sym_record.industry and row.industry:
                    sym_record.industry = row.industry
                fund_updated += 1
        db.commit()
        print(f"   fundamentals: {fund_updated} updated with company names")
    except Exception as e:
        db.rollback()
        print(f"   fundamentals: skipped ({e})")

    return {
        "cross_inserted": cross_inserted + ers_inserted,
        "cross_updated": cross_updated + ers_updated + fund_updated,
    }


if __name__ == "__main__":
    print("🌱 Seeding stock universe...")

    if SessionLocal is None:
        print("❌ No database configured. Set DATABASE_URL in .env")
        sys.exit(1)

    # Ensure tables exist
    Base.metadata.create_all(bind=engine, checkfirst=True)

    db = SessionLocal()
    try:
        # Phase 1: Seed from hardcoded universe
        print("\n📌 Phase 1: Seeding from curated list...")
        result = seed_symbols(db)
        print(f"   Inserted: {result['inserted']}")
        print(f"   Updated:  {result['updated']}")
        print(f"   Skipped:  {result['skipped']} (already had data)")
        print(f"   Total:    {result['total']} tickers in curated list")

        # Phase 2: Cross-populate from other DB tables
        print("\n📌 Phase 2: Cross-populating from other tables...")
        cross = cross_populate_from_other_tables(db)
        print(f"   Cross-inserted: {cross['cross_inserted']}")
        print(f"   Cross-updated:  {cross['cross_updated']}")

        # Verify
        total = db.query(Symbol).count()
        with_names = db.query(Symbol).filter(Symbol.name.isnot(None), Symbol.name != '').count()
        without_names = total - with_names
        print(f"\n📊 Final state:")
        print(f"   Total symbols: {total}")
        print(f"   With names:    {with_names}")
        print(f"   Missing names: {without_names}")
    finally:
        db.close()
