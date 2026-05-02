"""
Market data API - All stocks, indices, heatmap data

MVP Lean Implementation:
- Uses quote_snapshots cache for real data
- NO fake data - returns unavailable indicator if provider fails
- Tracks SP500 universe for gainers/losers
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import asyncio
import logging

logger = logging.getLogger(__name__)
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.quote_snapshot import QuoteSnapshot
from app.config import settings
from app.services.quote_cache import QuoteCacheService
from pydantic import BaseModel
import httpx

router = APIRouter()


def _heatmap_sample_symbol_count() -> int:
    """Symbols included in the US sector heatmap / movers sample (curated list)."""
    return sum(len(pairs) for pairs in SP500_STOCKS.values())


class StockPerformance(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_percent: float
    volume: int
    market_cap: Optional[float] = None
    sector: Optional[str] = None


class SectorPerformance(BaseModel):
    sector: str
    change_percent: float
    stocks: List[StockPerformance]


class HeatmapData(BaseModel):
    sectors: List[SectorPerformance]
    total_stocks: int
    gainers: int
    losers: int
    unchanged: int


# Top 800 US stocks by market cap — NYSE + NASDAQ + AMEX, grouped by sector
SP500_STOCKS = {
    "Technology": [
        # --- existing 41 (minus 14 semis moved to Semiconductors) = 27 kept ---
        ("AAPL", "Apple Inc"), ("MSFT", "Microsoft Corp"),
        ("GOOGL", "Alphabet Inc A"), ("META", "Meta Platforms"),
        ("ORCL", "Oracle Corp"), ("CRM", "Salesforce Inc"), ("ADBE", "Adobe Inc"),
        ("IBM", "IBM Corp"), ("NOW", "ServiceNow Inc"),
        ("INTU", "Intuit Inc"), ("PANW", "Palo Alto Networks"),
        ("FTNT", "Fortinet Inc"), ("CRWD", "CrowdStrike"), ("WDAY", "Workday Inc"),
        ("HPQ", "HP Inc"), ("HPE", "Hewlett Packard Ent"), ("MSI", "Motorola Solutions"),
        ("GLW", "Corning Inc"), ("ZBRA", "Zebra Technologies"),
        ("ENPH", "Enphase Energy"), ("AKAM", "Akamai Tech"),
        ("NET", "Cloudflare Inc"), ("DDOG", "Datadog Inc"),
        # --- new additions to reach ~80 ---
        ("PLTR", "Palantir Technologies"), ("SNOW", "Snowflake Inc"), ("ZS", "Zscaler Inc"),
        ("TEAM", "Atlassian Corp"), ("HUBS", "HubSpot Inc"), ("DOCU", "DocuSign Inc"),
        ("BILL", "Bill Holdings"), ("MDB", "MongoDB Inc"), ("PANW", "Palo Alto Networks"),
        ("OKTA", "Okta Inc"), ("ZM", "Zoom Video Comms"), ("U", "Unity Software"),
        ("PATH", "UiPath Inc"), ("GTLB", "GitLab Inc"), ("CFLT", "Confluent Inc"),
        ("S", "SentinelOne Inc"), ("ESTC", "Elastic NV"), ("DT", "Dynatrace Inc"),
        ("FIVN", "Five9 Inc"), ("RNG", "RingCentral Inc"), ("TWLO", "Twilio Inc"),
        ("ZI", "ZoomInfo Technologies"), ("GEN", "Gen Digital Inc"),
        ("MNDY", "monday.com Ltd"), ("PAYC", "Paycom Software"), ("PCTY", "Paylocity Holding"),
        ("TOST", "Toast Inc"), ("QLYS", "Qualys Inc"), ("RPD", "Rapid7 Inc"),
        ("TENB", "Tenable Holdings"), ("VRNS", "Varonis Systems"), ("CYBR", "CyberArk Software"),
        ("BSY", "Bentley Systems"), ("APPF", "AppFolio Inc"), ("PTC", "PTC Inc"),
        ("AZPN", "Aspen Technology"), ("CDNS", "Cadence Design"), ("SNPS", "Synopsys Inc"),
        ("TYL", "Tyler Technologies"), ("MANH", "Manhattan Associates"),
        ("CDAY", "Ceridian HCM"), ("WEX", "WEX Inc"), ("SMAR", "Smartsheet Inc"),
        ("BOX", "Box Inc"), ("JAMF", "Jamf Holding"), ("PEGA", "Pegasystems Inc"),
        ("FOUR", "Shift4 Payments"), ("SQSP", "Squarespace Inc"), ("CWAN", "Clearwater Analytics"),
        ("RIOT", "Riot Platforms"), ("MARA", "Marathon Digital"), ("DELL", "Dell Technologies"),
        ("SMCI", "Super Micro Computer"), ("IOT", "Samsara Inc"), ("CRDO", "Credo Technology"),
        ("FLEX", "Flex Ltd"), ("HPE", "Hewlett Packard Enterprise"), ("ANET", "Arista Networks"),
        ("NTAP", "NetApp Inc"), ("FFIV", "F5 Inc"), ("CTSH", "Cognizant Technology"),
        ("IT", "Gartner Inc"), ("GDDY", "GoDaddy Inc"), ("EPAM", "EPAM Systems"),
        ("WIT", "Wipro Ltd"), ("OTEX", "Open Text Corp"), ("SSNC", "SS&C Technologies"),
        ("CSGP", "CoStar Group"), ("CHKP", "Check Point Software"), ("VRSN", "VeriSign Inc"),
    ],
    "Healthcare": [
        # --- existing 27 ---
        ("UNH", "UnitedHealth Group"), ("JNJ", "Johnson & Johnson"), ("LLY", "Eli Lilly"),
        ("PFE", "Pfizer Inc"), ("ABBV", "AbbVie Inc"), ("MRK", "Merck & Co"),
        ("TMO", "Thermo Fisher"), ("ABT", "Abbott Labs"), ("DHR", "Danaher Corp"),
        ("BMY", "Bristol-Myers Squibb"), ("AMGN", "Amgen Inc"), ("GILD", "Gilead Sciences"),
        ("CVS", "CVS Health"), ("ISRG", "Intuitive Surgical"), ("VRTX", "Vertex Pharma"),
        ("REGN", "Regeneron Pharma"), ("ZTS", "Zoetis Inc"), ("BSX", "Boston Scientific"),
        ("SYK", "Stryker Corp"), ("MDT", "Medtronic PLC"), ("ELV", "Elevance Health"),
        ("CI", "Cigna Group"), ("HUM", "Humana Inc"), ("A", "Agilent Technologies"),
        ("IDXX", "IDEXX Labs"), ("EW", "Edwards Lifesciences"), ("IQV", "IQVIA Holdings"),
        # --- new additions to reach ~55 ---
        ("DXCM", "DexCom Inc"), ("HOLX", "Hologic Inc"), ("MTD", "Mettler-Toledo"),
        ("RMD", "ResMed Inc"), ("ALGN", "Align Technology"), ("TFX", "Teleflex Inc"),
        ("BAX", "Baxter International"), ("BDX", "Becton Dickinson"), ("COO", "Cooper Companies"),
        ("PODD", "Insulet Corp"), ("VEEV", "Veeva Systems"), ("WAT", "Waters Corp"),
        ("PKI", "Revvity Inc"), ("CNC", "Centene Corp"), ("MOH", "Molina Healthcare"),
        ("HCA", "HCA Healthcare"), ("THC", "Tenet Healthcare"), ("UHS", "Universal Health Svcs"),
        ("DVA", "DaVita Inc"), ("HSIC", "Henry Schein"), ("XRAY", "Dentsply Sirona"),
        ("STE", "STERIS PLC"), ("INSP", "Inspire Medical Sys"),
        ("MASI", "Masimo Corp"), ("ENSG", "Ensign Group"), ("GEHC", "GE HealthCare"),
        ("SOLV", "Solventum Corp"), ("GMED", "Globus Medical"), ("NVST", "Envista Holdings"),
        ("PEN", "Penumbra Inc"), ("TNDM", "Tandem Diabetes Care"), ("WRBY", "Warby Parker"),
        ("OMCL", "Omnicell Inc"), ("HAE", "Haemonetics Corp"), ("AZTA", "Azenta Inc"),
    ],
    "Financials": [
        # --- existing 31 ---
        ("JPM", "JPMorgan Chase"), ("V", "Visa Inc"), ("MA", "Mastercard Inc"),
        ("BAC", "Bank of America"), ("WFC", "Wells Fargo"), ("GS", "Goldman Sachs"),
        ("MS", "Morgan Stanley"), ("BLK", "BlackRock Inc"), ("SCHW", "Charles Schwab"),
        ("AXP", "American Express"), ("C", "Citigroup Inc"), ("SPGI", "S&P Global"),
        ("CME", "CME Group"), ("PNC", "PNC Financial"), ("USB", "US Bancorp"),
        ("TFC", "Truist Financial"), ("MCO", "Moody's Corp"), ("ICE", "Intercontinental Exch"),
        ("COF", "Capital One"), ("DFS", "Discover Financial"), ("AIG", "AIG Inc"),
        ("PRU", "Prudential Financial"), ("MET", "MetLife Inc"), ("AFL", "Aflac Inc"),
        ("ALL", "Allstate Corp"), ("MTB", "M&T Bank"), ("FITB", "Fifth Third Bancorp"),
        ("RF", "Regions Financial"), ("KEY", "KeyCorp"), ("CFG", "Citizens Financial"),
        ("HBAN", "Huntington Bancshares"),
        # --- new additions to reach ~65 ---
        ("MSCI", "MSCI Inc"), ("NDAQ", "Nasdaq Inc"), ("CBOE", "Cboe Global Markets"),
        ("FIS", "Fidelity National Info"), ("FISV", "Fiserv Inc"), ("GPN", "Global Payments"),
        ("WRB", "W.R. Berkley"), ("TRV", "Travelers Companies"), ("CB", "Chubb Ltd"),
        ("MMC", "Marsh & McLennan"), ("AON", "Aon PLC"), ("AJG", "Arthur J Gallagher"),
        ("BRO", "Brown & Brown"), ("RJF", "Raymond James"), ("LPLA", "LPL Financial"),
        ("NTRS", "Northern Trust"), ("STT", "State Street Corp"), ("BK", "Bank of New York Mellon"),
        ("SIVB", "SVB Financial Group"), ("ZION", "Zions Bancorporation"),
        ("CMA", "Comerica Inc"), ("FHN", "First Horizon"), ("ALLY", "Ally Financial"),
        ("SYF", "Synchrony Financial"), ("CINF", "Cincinnati Financial"),
        ("L", "Loews Corp"), ("EG", "Everest Group"), ("RE", "Everest Group Ltd"),
        ("GL", "Globe Life Inc"), ("ACGL", "Arch Capital Group"),
        ("FNF", "Fidelity Natl Financial"), ("TROW", "T Rowe Price"),
        ("IVZ", "Invesco Ltd"), ("BEN", "Franklin Resources"),
        ("EWBC", "East West Bancorp"), ("WAL", "Western Alliance Bancorp"),
        ("FRC", "First Republic Bank"), ("SBNY", "Signature Bank"),
        ("PYPL", "PayPal Holdings"), ("SQ", "Block Inc"),
        ("COIN", "Coinbase Global"), ("SOFI", "SoFi Technologies"),
        ("HOOD", "Robinhood Markets"), ("MKTX", "MarketAxess Holdings"),
        ("VIRT", "Virtu Financial"), ("OWL", "Blue Owl Capital"),
    ],
    "Consumer Cyclical": [
        # --- existing 27 ---
        ("AMZN", "Amazon.com"), ("TSLA", "Tesla Inc"), ("HD", "Home Depot"),
        ("MCD", "McDonald's Corp"), ("NKE", "Nike Inc"), ("SBUX", "Starbucks Corp"),
        ("LOW", "Lowe's Companies"), ("TJX", "TJX Companies"), ("BKNG", "Booking Holdings"),
        ("CMG", "Chipotle Mexican"), ("TGT", "Target Corp"), ("ORLY", "O'Reilly Auto"),
        ("GM", "General Motors"), ("F", "Ford Motor"), ("ROST", "Ross Stores"),
        ("YUM", "Yum! Brands"), ("HLT", "Hilton Worldwide"), ("MAR", "Marriott Intl"),
        ("LVS", "Las Vegas Sands"), ("MGM", "MGM Resorts"), ("EBAY", "eBay Inc"),
        ("ETSY", "Etsy Inc"), ("DKNG", "DraftKings Inc"), ("ABNB", "Airbnb Inc"),
        ("LKQ", "LKQ Corp"), ("AZO", "AutoZone Inc"), ("BBY", "Best Buy Co"),
        # --- new additions to reach ~60 ---
        ("DHI", "D.R. Horton"), ("LEN", "Lennar Corp"), ("PHM", "PulteGroup Inc"),
        ("NVR", "NVR Inc"), ("TOL", "Toll Brothers"), ("KBH", "KB Home"),
        ("DECK", "Deckers Outdoor"), ("LULU", "Lululemon Athletica"), ("TPR", "Tapestry Inc"),
        ("RL", "Ralph Lauren"), ("CPRI", "Capri Holdings"), ("GRMN", "Garmin Ltd"),
        ("POOL", "Pool Corp"), ("WSM", "Williams-Sonoma"), ("RH", "RH Inc"),
        ("DPZ", "Domino's Pizza"), ("WEN", "Wendy's Co"), ("WING", "Wingstop Inc"),
        ("DRI", "Darden Restaurants"), ("TXRH", "Texas Roadhouse"), ("EAT", "Brinker Intl"),
        ("WYNN", "Wynn Resorts"), ("CZR", "Caesars Entertainment"), ("H", "Hyatt Hotels"),
        ("IHG", "InterContinental Hotels"), ("EXPE", "Expedia Group"),
        ("GPC", "Genuine Parts Co"), ("AAP", "Advance Auto Parts"), ("APTV", "Aptiv PLC"),
        ("LEA", "Lear Corp"), ("BWA", "BorgWarner Inc"), ("RIVN", "Rivian Automotive"),
        ("LCID", "Lucid Group"), ("ULTA", "Ulta Beauty"), ("BIRK", "Birkenstock Holding"),
        ("CAVA", "CAVA Group"), ("SHAK", "Shake Shack"), ("SIX", "Six Flags Entertainment"),
        ("NCLH", "Norwegian Cruise Line"), ("RCL", "Royal Caribbean"), ("CCL", "Carnival Corp"),
        ("PENN", "PENN Entertainment"), ("MTN", "Vail Resorts"), ("SKX", "Skechers USA"),
        ("CROX", "Crocs Inc"), ("VFC", "VF Corp"), ("HAS", "Hasbro Inc"),
        ("MAT", "Mattel Inc"),
    ],
    "Communication Services": [
        # --- existing 20 ---
        ("GOOG", "Alphabet Inc C"), ("NFLX", "Netflix Inc"), ("DIS", "Walt Disney"),
        ("CMCSA", "Comcast Corp"), ("VZ", "Verizon Comms"), ("T", "AT&T Inc"),
        ("TMUS", "T-Mobile US"), ("CHTR", "Charter Comms"), ("EA", "Electronic Arts"),
        ("WBD", "Warner Bros Discovery"), ("SNAP", "Snap Inc"), ("PINS", "Pinterest Inc"),
        ("MTCH", "Match Group"), ("LYV", "Live Nation Ent"), ("FOXA", "Fox Corp"),
        ("IPG", "Interpublic Group"), ("OMC", "Omnicom Group"), ("TTWO", "Take-Two Interactive"),
        ("RBLX", "Roblox Corp"), ("SPOT", "Spotify Technology"),
        # --- new additions to reach ~35 ---
        ("PARA", "Paramount Global"), ("NWSA", "News Corp"), ("NWS", "News Corp B"),
        ("LBRDA", "Liberty Broadband A"), ("SIRI", "Sirius XM Holdings"),
        ("ROKU", "Roku Inc"), ("ZG", "Zillow Group"), ("YELP", "Yelp Inc"),
        ("IAC", "IAC Inc"), ("ANGI", "Angi Inc"), ("CARG", "CarGurus Inc"),
        ("GENI", "Genius Sports"), ("MGNI", "Magnite Inc"), ("TTD", "Trade Desk Inc"),
        ("PUBM", "PubMatic Inc"), ("LBRDK", "Liberty Broadband C"),
        ("FWONA", "Liberty Formula One"), ("MSGS", "Madison Square Garden Sports"),
        ("MSGE", "Madison Square Garden Ent"), ("IMAX", "IMAX Corp"),
    ],
    "Industrials": [
        # --- existing (minus defense stocks moved to Aerospace & Defense) ---
        ("GE", "GE Aerospace"), ("CAT", "Caterpillar Inc"), ("HON", "Honeywell Intl"),
        ("DE", "Deere & Co"),
        ("MMM", "3M Company"), ("EMR", "Emerson Electric"),
        ("ITW", "Illinois Tool Works"), ("ETN", "Eaton Corp"), ("PH", "Parker-Hannifin"),
        ("ROK", "Rockwell Automation"), ("AME", "AMETEK Inc"), ("CTAS", "Cintas Corp"),
        ("RSG", "Republic Services"), ("WM", "Waste Management"),
        # --- new additions to reach ~70 ---
        ("PCAR", "PACCAR Inc"), ("CMI", "Cummins Inc"), ("GWW", "W.W. Grainger"),
        ("FAST", "Fastenal Co"), ("SWK", "Stanley Black & Decker"), ("ROP", "Roper Technologies"),
        ("IR", "Ingersoll Rand"), ("DOV", "Dover Corp"), ("IEX", "IDEX Corp"),
        ("NDSN", "Nordson Corp"), ("XYL", "Xylem Inc"), ("FTV", "Fortive Corp"),
        ("TT", "Trane Technologies"), ("CARR", "Carrier Global"), ("OTIS", "Otis Worldwide"),
        ("JCI", "Johnson Controls"), ("AOS", "A.O. Smith Corp"), ("LII", "Lennox Intl"),
        ("SNA", "Snap-on Inc"), ("TTC", "Toro Company"), ("EME", "EMCOR Group"),
        ("URI", "United Rentals"), ("WAB", "Westinghouse Air Brake"),
        ("GGG", "Graco Inc"), ("HWM", "Howmet Aerospace"), ("RBC", "RBC Bearings"),
        ("GNRC", "Generac Holdings"), ("PWR", "Quanta Services"), ("TTEK", "Tetra Tech"),
        ("ACM", "AECOM"), ("J", "Jacobs Solutions"), ("MTZ", "MasTec Inc"),
        ("FIX", "Comfort Systems USA"), ("CLH", "Clean Harbors"), ("ALLE", "Allegion PLC"),
        ("AXON", "Axon Enterprise"), ("BR", "Broadridge Financial"),
        ("DNB", "Dun & Bradstreet"), ("DAL", "Delta Air Lines"), ("AAL", "American Airlines"),
        ("LUV", "Southwest Airlines"), ("ALK", "Alaska Air Group"),
        ("BLDR", "Builders FirstSource"), ("HUBB", "Hubbell Inc"), ("WCC", "WESCO Intl"),
        ("AIT", "Applied Industrial"), ("AGCO", "AGCO Corp"), ("OSK", "Oshkosh Corp"),
        ("TEX", "Terex Corp"), ("MIDD", "Middleby Corp"), ("ENTG", "Entegris Inc"),
        ("VRSK", "Verisk Analytics"), ("CPRT", "Copart Inc"), ("RRX", "Regal Rexnord"),
        ("TREX", "Trex Co"), ("SRCL", "Stericycle Inc"), ("NFE", "New Fortress Energy"),
        ("APG", "APi Group Corp"), ("FERG", "Ferguson Enterprises"),
        ("AZEK", "AZEK Company"), ("SITE", "SiteOne Landscape"),
        ("CNHI", "CNH Industrial"), ("GATX", "GATX Corp"),
        ("CSL", "Carlisle Companies"), ("RHI", "Robert Half Intl"),
    ],
    "Transportation": [
        # --- existing 11 ---
        ("UNP", "Union Pacific"), ("CSX", "CSX Corp"), ("NSC", "Norfolk Southern"),
        ("UPS", "United Parcel Service"), ("FDX", "FedEx Corp"), ("EXPD", "Expeditors Intl"),
        ("CHRW", "CH Robinson"), ("XPO", "XPO Inc"), ("JBHT", "JB Hunt Transport"),
        ("ODFL", "Old Dominion Freight"), ("SAIA", "Saia Inc"),
        # --- new additions to reach ~25 ---
        ("CP", "Canadian Pacific Kansas City"), ("CNI", "Canadian National Railway"),
        ("GFL", "GFL Environmental"), ("KEX", "Kirby Corp"),
        ("MATX", "Matson Inc"), ("KNX", "Knight-Swift Transport"),
        ("WERN", "Werner Enterprises"), ("SNDR", "Schneider National"),
        ("HUBG", "Hub Group Inc"), ("ARCB", "ArcBest Corp"),
        ("LSTR", "Landstar System"), ("RXO", "RXO Inc"),
        ("UAL", "United Airlines"), ("SKYW", "SkyWest Inc"),
        ("SAVE", "Spirit Airlines"), ("JBLU", "JetBlue Airways"),
        ("ATSG", "Air Transport Services"), ("AAWW", "Atlas Air Worldwide"),
        ("FWRD", "Forward Air Corp"),
    ],
    "Consumer Defensive": [
        # --- existing 24 ---
        ("PG", "Procter & Gamble"), ("KO", "Coca-Cola Co"), ("PEP", "PepsiCo Inc"),
        ("COST", "Costco Wholesale"), ("WMT", "Walmart Inc"), ("PM", "Philip Morris"),
        ("MDLZ", "Mondelez Intl"), ("MO", "Altria Group"), ("CL", "Colgate-Palmolive"),
        ("KMB", "Kimberly-Clark"), ("GIS", "General Mills"), ("SYY", "Sysco Corp"),
        ("KR", "Kroger Co"), ("HSY", "Hershey Co"), ("K", "Kellanova"),
        ("STZ", "Constellation Brands"), ("TAP", "Molson Coors"), ("TSN", "Tyson Foods"),
        ("HRL", "Hormel Foods"), ("CAG", "Conagra Brands"), ("CPB", "Campbell Soup"),
        ("MKC", "McCormick & Co"), ("CHD", "Church & Dwight"), ("CLX", "Clorox Co"),
        # --- new additions to reach ~50 ---
        ("ADM", "Archer-Daniels-Midland"), ("BG", "Bunge Global"),
        ("KDP", "Keurig Dr Pepper"), ("MNST", "Monster Beverage"), ("SAM", "Boston Beer Co"),
        ("SJM", "J.M. Smucker"), ("INGR", "Ingredion Inc"), ("DAR", "Darling Ingredients"),
        ("EL", "Estee Lauder"), ("KVUE", "Kenvue Inc"), ("COTY", "Coty Inc"),
        ("LW", "Lamb Weston"), ("POST", "Post Holdings"), ("THS", "TreeHouse Foods"),
        ("FLO", "Flowers Foods"), ("USFD", "US Foods Holding"), ("PFGC", "Performance Food Group"),
        ("SPTN", "SpartanNash Co"), ("WBA", "Walgreens Boots Alliance"),
        ("DG", "Dollar General"), ("DLTR", "Dollar Tree"), ("FIVE", "Five Below"),
        ("BJ", "BJ's Wholesale"), ("GO", "Grocery Outlet"), ("CELH", "Celsius Holdings"),
        ("SMPL", "Simply Good Foods"),
    ],
    "Energy": [
        # --- existing 19 ---
        ("XOM", "Exxon Mobil"), ("CVX", "Chevron Corp"), ("COP", "ConocoPhillips"),
        ("EOG", "EOG Resources"), ("SLB", "SLB (Schlumberger)"), ("MPC", "Marathon Petroleum"),
        ("PSX", "Phillips 66"), ("VLO", "Valero Energy"), ("OXY", "Occidental Petroleum"),
        ("DVN", "Devon Energy"), ("FANG", "Diamondback Energy"),
        ("APA", "APA Corp"), ("HAL", "Halliburton Co"), ("BKR", "Baker Hughes"),
        ("KMI", "Kinder Morgan"), ("WMB", "Williams Companies"), ("OKE", "ONEOK Inc"),
        ("ET", "Energy Transfer"), ("TRGP", "Targa Resources"),
        # --- new additions to reach ~45 ---
        ("HES", "Hess Corp"), ("MRO", "Marathon Oil"), ("CTRA", "Coterra Energy"),
        ("EQT", "EQT Corp"), ("AR", "Antero Resources"), ("RRC", "Range Resources"),
        ("SWN", "Southwestern Energy"), ("PR", "Permian Resources"),
        ("CHRD", "Chord Energy"), ("SM", "SM Energy"), ("MTDR", "Matador Resources"),
        ("DINO", "HF Sinclair Corp"), ("DK", "Delek US Holdings"),
        ("PBF", "PBF Energy Inc"), ("PARR", "Par Pacific Holdings"),
        ("AM", "Antero Midstream"), ("ENLC", "EnLink Midstream"), ("DTM", "DT Midstream"),
        ("HESM", "Hess Midstream Partners"), ("EPD", "Enterprise Products Partners"),
        ("MPLX", "MPLX LP"), ("PAA", "Plains All American"),
        ("VNOM", "Viper Energy"), ("CIVI", "Civitas Resources"),
        ("NOV", "NOV Inc"), ("FTI", "TechnipFMC"),
    ],
    "Utilities": [
        # --- existing 20 ---
        ("NEE", "NextEra Energy"), ("DUK", "Duke Energy"), ("SO", "Southern Co"),
        ("D", "Dominion Energy"), ("AEP", "American Electric Power"), ("EXC", "Exelon Corp"),
        ("XEL", "Xcel Energy"), ("SRE", "Sempra Energy"), ("ED", "Consolidated Edison"),
        ("WEC", "WEC Energy"), ("ES", "Eversource Energy"), ("AWK", "American Water Works"),
        ("PPL", "PPL Corp"), ("DTE", "DTE Energy"), ("FE", "FirstEnergy Corp"),
        ("CMS", "CMS Energy"), ("ATO", "Atmos Energy"), ("NI", "NiSource Inc"),
        ("PNW", "Pinnacle West Capital"), ("OGE", "OGE Energy"),
        # --- new additions to reach ~40 ---
        ("CEG", "Constellation Energy"), ("VST", "Vistra Corp"), ("NRG", "NRG Energy"),
        ("AES", "AES Corp"), ("PCG", "PG&E Corp"), ("EIX", "Edison International"),
        ("CNP", "CenterPoint Energy"), ("AEE", "Ameren Corp"), ("LNT", "Alliant Energy"),
        ("EVRG", "Evergy Inc"), ("PEG", "Public Service Enterprise"),
        ("BKH", "Black Hills Corp"), ("AVA", "Avista Corp"), ("NWE", "NorthWestern Energy"),
        ("SR", "Spire Inc"), ("SJW", "SJW Group"), ("WTRG", "Essential Utilities"),
        ("CWT", "California Water Svc"), ("MSEX", "Middlesex Water"),
        ("UTL", "Unitil Corp"), ("IDA", "IDACORP Inc"), ("OGS", "ONE Gas Inc"),
        ("POR", "Portland General Elec"), ("MGEE", "MGE Energy"),
    ],
    "Real Estate": [
        # --- existing 20 ---
        ("PLD", "Prologis Inc"), ("AMT", "American Tower"), ("CCI", "Crown Castle"),
        ("EQIX", "Equinix Inc"), ("PSA", "Public Storage"), ("O", "Realty Income"),
        ("WELL", "Welltower Inc"), ("SPG", "Simon Property Group"), ("DLR", "Digital Realty"),
        ("AVB", "AvalonBay Communities"), ("EQR", "Equity Residential"), ("ARE", "Alexandria RE"),
        ("VTR", "Ventas Inc"), ("HST", "Host Hotels"), ("KIM", "Kimco Realty"),
        ("REG", "Regency Centers"), ("WPC", "W.P. Carey"), ("IRM", "Iron Mountain"),
        ("INVH", "Invitation Homes"), ("EXR", "Extra Space Storage"),
        # --- new additions to reach ~45 ---
        ("VICI", "VICI Properties"), ("GLPI", "Gaming & Leisure Prop"),
        ("SUI", "Sun Communities"), ("ELS", "Equity LifeStyle Prop"),
        ("MAA", "Mid-America Apartment"), ("CPT", "Camden Property Trust"),
        ("UDR", "UDR Inc"), ("ESS", "Essex Property Trust"),
        ("BXP", "Boston Properties"), ("SLG", "SL Green Realty"), ("VNO", "Vornado Realty"),
        ("HIW", "Highwoods Properties"), ("DEI", "Douglas Emmett"),
        ("CUBE", "CubeSmart"), ("LSI", "Life Storage Inc"), ("NSA", "National Storage"),
        ("REXR", "Rexford Industrial"), ("STAG", "STAG Industrial"), ("FR", "First Industrial"),
        ("TRNO", "Terreno Realty"), ("NNN", "NNN REIT Inc"), ("ADC", "Agree Realty"),
        ("STOR", "STORE Capital"), ("SKT", "Tanger Factory Outlet"),
        ("MPW", "Medical Properties Trust"), ("COLD", "Americold Realty"),
        ("SBAC", "SBA Communications"), ("LTC", "LTC Properties"),
        ("OHI", "Omega Healthcare"), ("DOC", "Healthpeak Properties"),
        ("HR", "Healthcare Realty Trust"),
    ],
    "Materials": [
        # --- existing 19 ---
        ("LIN", "Linde PLC"), ("APD", "Air Products"), ("SHW", "Sherwin-Williams"),
        ("ECL", "Ecolab Inc"), ("FCX", "Freeport-McMoRan"), ("NEM", "Newmont Corp"),
        ("NUE", "Nucor Corp"), ("DOW", "Dow Inc"), ("DD", "DuPont de Nemours"),
        ("VMC", "Vulcan Materials"), ("MLM", "Martin Marietta"), ("IP", "International Paper"),
        ("PKG", "Packaging Corp"), ("AVY", "Avery Dennison"), ("SEE", "Sealed Air Corp"),
        ("CE", "Celanese Corp"), ("EMN", "Eastman Chemical"), ("RPM", "RPM International"),
        ("CC", "Chemours Co"),
        # --- new additions to reach ~40 ---
        ("BALL", "Ball Corp"), ("CF", "CF Industries"), ("MOS", "Mosaic Co"),
        ("FMC", "FMC Corp"), ("ALB", "Albemarle Corp"), ("LTHM", "Livent Corp"),
        ("RS", "Reliance Steel"), ("STLD", "Steel Dynamics"),
        ("CLF", "Cleveland-Cliffs"), ("X", "United States Steel"),
        ("AA", "Alcoa Corp"), ("CENX", "Century Aluminum"),
        ("OLN", "Olin Corp"), ("HUN", "Huntsman Corp"), ("WLK", "Westlake Corp"),
        ("AXTA", "Axalta Coating Sys"), ("PPG", "PPG Industries"),
        ("IFF", "Intl Flavors & Fragrances"), ("SMG", "Scotts Miracle-Gro"),
        ("SON", "Sonoco Products"), ("GEF", "Greif Inc"),
        ("TROX", "Tronox Holdings"), ("KWR", "Quaker Houghton"), ("CBT", "Cabot Corp"),
        ("IOSP", "Innospec Inc"), ("ASH", "Ashland Inc"),
    ],
    "Biotechnology": [
        # --- existing 14 ---
        ("BIIB", "Biogen Inc"), ("MRNA", "Moderna Inc"), ("ILMN", "Illumina Inc"),
        ("ALNY", "Alnylam Pharma"), ("BMRN", "BioMarin Pharma"),
        ("EXEL", "Exelixis Inc"), ("HALO", "Halozyme Therapeutics"), ("IONS", "Ionis Pharma"),
        ("FOLD", "Amicus Therapeutics"), ("RARE", "Ultragenyx Pharma"), ("ACAD", "ACADIA Pharma"),
        ("PCVX", "Vaxcyte Inc"), ("RXRX", "Recursion Pharma"), ("RVMD", "Revolution Medicines"),
        # --- new additions to reach ~35 ---
        ("SGEN", "Seagen Inc"), ("SRPT", "Sarepta Therapeutics"), ("NBIX", "Neurocrine Bio"),
        ("UTHR", "United Therapeutics"), ("INSM", "Insmed Inc"), ("NTRA", "Natera Inc"),
        ("ARGX", "argenx SE"), ("LEGN", "Legend Biotech"), ("RPRX", "Royalty Pharma"),
        ("TECH", "Bio-Techne Corp"), ("BIO", "Bio-Rad Labs"), ("BNTX", "BioNTech SE"),
        ("NVAX", "Novavax Inc"), ("TWST", "Twist Bioscience"), ("CRSP", "CRISPR Therapeutics"),
        ("BEAM", "Beam Therapeutics"), ("NTLA", "Intellia Therapeutics"),
        ("EDIT", "Editas Medicine"), ("FATE", "Fate Therapeutics"),
        ("IMVT", "Immunovant Inc"), ("DAWN", "Day One Biopharma"),
        ("RCKT", "Rocket Pharma"), ("ARVN", "Arvinas Inc"), ("CRNX", "Crinetics Pharma"),
        ("KRYS", "Krystal Biotech"), ("IOVA", "Iovance Biotherapeutics"),
    ],
    "Aerospace & Defense": [
        ("BA", "Boeing Co"), ("RTX", "RTX Corp"), ("LMT", "Lockheed Martin"),
        ("GD", "General Dynamics"), ("NOC", "Northrop Grumman"), ("LHX", "L3Harris Technologies"),
        ("TDG", "TransDigm Group"), ("HEI", "HEICO Corp"), ("HEI.A", "HEICO Corp A"),
        ("TXT", "Textron Inc"), ("CW", "Curtiss-Wright"), ("MOG.A", "Moog Inc"),
        ("KTOS", "Kratos Defense"), ("BWXT", "BWX Technologies"), ("LDOS", "Leidos Holdings"),
        ("SAIC", "Science Applications"), ("BAH", "Booz Allen Hamilton"),
        ("PSN", "Parsons Corp"), ("KBR", "KBR Inc"), ("CACI", "CACI International"),
        ("MRCY", "Mercury Systems"), ("SPR", "Spirit AeroSystems"),
        ("DCO", "Ducommun Inc"), ("AIR", "AAR Corp"), ("WWD", "Woodward Inc"),
        ("AVAV", "AeroVironment Inc"), ("RKLB", "Rocket Lab USA"),
        ("LUNR", "Intuitive Machines"), ("RDW", "Redwire Corp"),
        ("ASTS", "AST SpaceMobile"),
    ],
    "Semiconductors": [
        # --- pulled from original Technology ---
        ("NVDA", "NVIDIA Corp"), ("AVGO", "Broadcom Inc"), ("AMD", "AMD Inc"),
        ("INTC", "Intel Corp"), ("QCOM", "Qualcomm Inc"), ("TXN", "Texas Instruments"),
        ("AMAT", "Applied Materials"), ("MU", "Micron Technology"), ("ADI", "Analog Devices"),
        ("LRCX", "Lam Research"), ("KLAC", "KLA Corp"), ("MRVL", "Marvell Technology"),
        ("NXPI", "NXP Semiconductors"), ("ONTO", "Onto Innovation"), ("TER", "Teradyne Inc"),
        ("MPWR", "Monolithic Power"),
        # --- new additions to reach ~35 ---
        ("ON", "ON Semiconductor"), ("SWKS", "Skyworks Solutions"), ("QRVO", "Qorvo Inc"),
        ("MCHP", "Microchip Technology"), ("GFS", "GlobalFoundries"), ("ARM", "Arm Holdings"),
        ("WOLF", "Wolfspeed Inc"), ("DIOD", "Diodes Inc"), ("SLAB", "Silicon Laboratories"),
        ("LSCC", "Lattice Semiconductor"), ("RMBS", "Rambus Inc"), ("CRUS", "Cirrus Logic"),
        ("MKSI", "MKS Instruments"), ("COHR", "Coherent Corp"), ("ACLS", "Axcelis Technologies"),
        ("POWI", "Power Integrations"), ("SMTC", "Semtech Corp"), ("SITM", "SiTime Corp"),
        ("ALGM", "Allegro MicroSystems"),
    ],
}


async def fetch_stock_performance(
    symbol: str, 
    name: str, 
    sector: str, 
    db: Session
) -> Optional[StockPerformance]:
    """
    Fetch real stock performance using QuoteCacheService.
    Returns None if quote is unavailable (NO FAKE DATA).
    """
    cache_service = QuoteCacheService(db)
    
    try:
        quote = await cache_service.get_quote(symbol)
        
        if not quote or quote.get("unavailable"):
            return None
        
        return StockPerformance(
            symbol=symbol,
            name=name,
            price=round(quote.get("price", 0), 2),
            change=round(quote.get("change", 0), 2),
            change_percent=round(quote.get("change_percent", 0), 2),
            volume=int(quote.get("volume", 0)),
            market_cap=quote.get("market_cap"),
            sector=sector
        )
    except Exception as e:
        print(f"Error fetching quote for {symbol}: {e}")
        return None


async def fetch_bulk_quotes(
    symbols_info: List[tuple], 
    db: Session,
    force_refresh: bool = False
) -> List[StockPerformance]:
    """
    Fetch quotes for multiple symbols using cache service.
    Returns list of StockPerformance (only available quotes).
    Uses TradingView as final fallback to ensure we have data.
    """
    cache_service = QuoteCacheService(db)
    results = []
    
    # Extract just symbols for bulk fetch
    symbols = [s[0] for s in symbols_info]
    symbol_map = {s[0]: (s[1], s[2]) for s in symbols_info}  # symbol -> (name, sector)
    
    try:
        # Use force_refresh to bypass stale cache when needed
        quotes = await cache_service.get_quotes(symbols, force_refresh=force_refresh)
        
        # Track symbols that failed to get quotes
        failed_symbols = []
        
        for symbol, quote in quotes.items():
            if quote and not quote.get("unavailable"):
                price = quote.get("price", 0)
                # Only include stocks with valid prices
                if price and price > 0:
                    name, sector = symbol_map.get(symbol, (symbol, None))
                    results.append(StockPerformance(
                        symbol=symbol,
                        name=name,
                        price=round(price, 2),
                        change=round(quote.get("change", 0), 2),
                        change_percent=round(quote.get("change_percent", 0), 2),
                        volume=int(quote.get("volume", 0)),
                        market_cap=quote.get("market_cap"),
                        sector=sector
                    ))
                else:
                    failed_symbols.append(symbol)
            else:
                failed_symbols.append(symbol)
        
        # If we have failed symbols, try TradingView as final fallback
        if failed_symbols:
            try:
                from app.services.tradingview_fetcher import TradingViewFetcher
                tv_quotes = await TradingViewFetcher.get_quotes_bulk(failed_symbols)
                
                for symbol, quote in tv_quotes.items():
                    if quote and quote.get("price") and quote.get("price") > 0:
                        name, sector = symbol_map.get(symbol, (symbol, None))
                        results.append(StockPerformance(
                            symbol=symbol,
                            name=name,
                            price=round(quote.get("price", 0), 2),
                            change=round(quote.get("change", 0), 2),
                            change_percent=round(quote.get("change_percent", 0), 2),
                            volume=int(quote.get("volume", 0)),
                            market_cap=quote.get("market_cap"),
                            sector=sector
                        ))
            except Exception as e:
                print(f"TradingView fallback error: {e}")
                import traceback
                traceback.print_exc()
                
    except Exception as e:
        print(f"Error fetching bulk quotes: {e}")
        import traceback
        traceback.print_exc()
    
    return results


def _flatten_sp500_symbol_rows() -> List[tuple]:
    """All (symbol, name, sector) rows for one bulk quote fetch."""
    rows: List[tuple] = []
    for sector_name, stock_list in SP500_STOCKS.items():
        for symbol, name in stock_list:
            rows.append((symbol, name, sector_name))
    return rows


def _fast_mover_symbol_rows(limit: int = 140) -> List[Tuple[str, str, str]]:
    """
    Fast subset used when full-universe movers are slow.
    Keeps broad sector coverage while returning quickly.
    """
    rows = _flatten_sp500_symbol_rows()
    return [(s[0], s[1], s[2]) for s in rows[:limit]]


def _load_cached_mover_rows(
    db: Session,
    max_symbols: Optional[int] = None,
) -> List[StockPerformance]:
    """
    Fastest path for movers: use cached quote_snapshots only (no network).
    By default loads the full heatmap universe (all SP500_STOCKS rows).
    """
    flat = _flatten_sp500_symbol_rows()
    if max_symbols is not None:
        flat = flat[:max_symbols]
    rows = flat
    symbol_meta = {s[0]: (s[1], s[2]) for s in rows}
    symbols = list(symbol_meta.keys())
    snapshots = (
        db.query(QuoteSnapshot)
        .filter(QuoteSnapshot.symbol.in_(symbols))
        .all()
    )

    out: List[StockPerformance] = []
    for snap in snapshots:
        payload = snap.payload or {}
        price = float(payload.get("price", 0) or 0)
        if price <= 0:
            continue
        name, sector = symbol_meta.get(snap.symbol, (snap.symbol, None))
        out.append(
            StockPerformance(
                symbol=snap.symbol,
                name=name,
                price=round(price, 2),
                change=round(float(payload.get("change", 0) or 0), 2),
                change_percent=round(float(payload.get("change_percent", 0) or 0), 2),
                volume=int(payload.get("volume", 0) or 0),
                market_cap=payload.get("market_cap"),
                sector=sector,
            )
        )
    return out


async def _yfinance_fallback_performances(
    db: Session,
    symbols_info: List[Tuple[str, str, str]],
    max_symbols: int = 72,
) -> List[StockPerformance]:
    """
    When cache + TradingView return nothing (cold cache, provider outages), pull a
    slice of the universe directly via yfinance so gainers/losers stay populated.
    """
    cache_service = QuoteCacheService(db)
    batch = symbols_info[:max_symbols]
    sem = asyncio.Semaphore(12)

    async def one(row: Tuple[str, str, str]) -> Optional[StockPerformance]:
        symbol, name, sector = row
        try:
            quote = await cache_service._fetch_from_yfinance(symbol)
            if not quote or quote.get("unavailable"):
                return None
            price = float(quote.get("price", 0) or 0)
            if price <= 0:
                return None
            return StockPerformance(
                symbol=symbol,
                name=name,
                price=round(price, 2),
                change=round(float(quote.get("change", 0) or 0), 2),
                change_percent=round(float(quote.get("change_percent", 0) or 0), 2),
                volume=int(quote.get("volume", 0) or 0),
                market_cap=quote.get("market_cap"),
                sector=sector,
            )
        except Exception as e:
            print(f"yfinance fallback error for {symbol}: {e}")
            return None

    async def guarded(row: Tuple[str, str, str]) -> Optional[StockPerformance]:
        async with sem:
            return await one(row)

    results = await asyncio.gather(*[guarded(r) for r in batch])
    return [r for r in results if r is not None]


async def load_sp500_performances(
    db: Session,
    force_refresh: bool = False,
) -> List[StockPerformance]:
    """
    Load the full S&P watchlist in a single fetch_bulk_quotes call.

    The previous implementation looped every sector and called fetch_bulk_quotes
    once per sector, and get_market_movers called get_top_gainers + get_top_losers
    which duplicated the entire pass — often timing out or returning empty lists.
    """
    symbols_info = [(s[0], s[1], s[2]) for s in _flatten_sp500_symbol_rows()]
    stocks = await fetch_bulk_quotes(symbols_info, db, force_refresh=force_refresh)
    if not stocks and not force_refresh:
        stocks = await fetch_bulk_quotes(symbols_info, db, force_refresh=True)
    if not stocks:
        stocks = await _yfinance_fallback_performances(db, symbols_info)
    return stocks


async def _load_movers_universe(
    db: Session,
    force_refresh: bool = False,
) -> List[StockPerformance]:
    """
    Robust movers loader:
    1) Full S&P pass with timeout guard
    2) Fast subset (cached + force refresh)
    3) yfinance subset fallback
    """
    try:
        return await asyncio.wait_for(
            load_sp500_performances(db, force_refresh=force_refresh),
            timeout=22.0,
        )
    except asyncio.TimeoutError:
        print("load_sp500_performances timed out; using fast movers subset")
    except Exception as e:
        print(f"load_sp500_performances failed; using fast movers subset: {e}")

    fast_rows = _fast_mover_symbol_rows()
    stocks = await fetch_bulk_quotes(fast_rows, db, force_refresh=force_refresh)
    if not stocks and not force_refresh:
        stocks = await fetch_bulk_quotes(fast_rows, db, force_refresh=True)
    if not stocks:
        stocks = await _yfinance_fallback_performances(db, fast_rows, max_symbols=90)
    return stocks


@router.get("/market/ipo-calendar")
async def get_ipo_calendar(
    from_date: Optional[str] = Query(
        None,
        description="ISO date YYYY-MM-DD (default: today UTC)",
    ),
    to_date: Optional[str] = Query(
        None,
        description="ISO date YYYY-MM-DD (default: ~90 days ahead)",
    ),
) -> List[dict]:
    """
    Upcoming IPOs from Finnhub calendar when FINNHUB_API_KEY is set; otherwise [].
    """
    if not settings.FINNHUB_API_KEY:
        return []

    start = from_date or datetime.utcnow().strftime("%Y-%m-%d")
    end = to_date or (datetime.utcnow() + timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://finnhub.io/api/v1/calendar/ipo",
                params={
                    "from": start,
                    "to": end,
                    "token": settings.FINNHUB_API_KEY,
                },
                timeout=20.0,
            )
            if r.status_code != 200:
                print(f"Finnhub IPO calendar HTTP {r.status_code}")
                return []
            payload = r.json()
    except Exception as e:
        print(f"IPO calendar fetch error: {e}")
        return []

    raw = payload.get("ipoCalendar") or []
    out: List[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        name = row.get("name") or row.get("company") or ""
        dt = row.get("date") or row.get("startDate") or ""
        if not name and not row.get("symbol"):
            continue
        out.append(
            {
                "date": dt,
                "symbol": row.get("symbol"),
                "name": name or row.get("symbol"),
                "exchange": row.get("exchange"),
                "status": row.get("status"),
                "price": row.get("price"),
                "shares": row.get("numberOfShares") or row.get("totalShares"),
            }
        )
    out.sort(key=lambda x: (x.get("date") or ""))
    return out[:40]


class MarketCoverageStats(BaseModel):
    """Explains heatmap sample size vs full searchable symbol universe."""

    heatmap_universe_count: int
    symbols_master_active: int
    symbols_master_total: int
    note: str


@router.get("/market/coverage", response_model=MarketCoverageStats)
async def get_market_coverage(db: Session = Depends(get_db)) -> MarketCoverageStats:
    """
    Heatmap and movers use a curated US large-cap sample (fast quote batching).
    Autocomplete search uses `symbols_master` when seeded (can be 10k+ rows).
    """
    heatmap_n = _heatmap_sample_symbol_count()
    master_active = 0
    master_total = 0
    try:
        from app.models.symbols_master import SymbolsMaster

        master_total = db.query(SymbolsMaster).count()
        master_active = (
            db.query(SymbolsMaster).filter(SymbolsMaster.is_active == "Y").count()
        )
    except Exception as e:
        print(f"market coverage symbols_master count failed: {e}")

    return MarketCoverageStats(
        heatmap_universe_count=heatmap_n,
        symbols_master_active=master_active,
        symbols_master_total=master_total,
        note=(
            "The US performance heatmap quotes a fixed large-cap sample for speed. "
            "Run `python scripts/seed_symbols_master.py` to load the full searchable listing into symbols_master; "
            "quote refresh for every listing requires batch jobs and data licenses beyond this MVP."
        ),
    )


@router.get("/market/stocks")
async def get_all_stocks(
    sector: Optional[str] = Query(None, description="Filter by sector"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get all stocks with real performance data from QuoteCacheService.
    NO FAKE DATA - only returns stocks with available quotes.
    """
    # Build list of symbols to fetch
    symbols_to_fetch = []
    
    for sec, stock_list in SP500_STOCKS.items():
        if sector and sec.lower() != sector.lower():
            continue
            
        for symbol, name in stock_list:
            symbols_to_fetch.append((symbol, name, sec))
    
    # Fetch real quotes using cache service
    stocks = await fetch_bulk_quotes(symbols_to_fetch[:limit], db)
    
    return stocks[:limit]


@router.get("/market/sectors")
async def get_sector_performance(db: Session = Depends(get_db)) -> List[SectorPerformance]:
    """
    Get sector performance with real stock data.
    Fast path: reads cached quote_snapshots from DB (no network calls).
    Fallback: if cache has < 50 stocks, fetches a fast subset live.
    NO FAKE DATA - only includes stocks with available quotes.
    """
    from app.models.quote_snapshot import QuoteSnapshot
    from datetime import datetime, timezone, timedelta

    # Fast path: read all cached snapshots from DB (no network calls)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=12)
    cached = (
        db.query(QuoteSnapshot)
        .filter(QuoteSnapshot.fetched_at >= cutoff)
        .all()
    )
    cached_map = {s.symbol: s.payload for s in cached if s.payload}

    # Build sector performances from cached data
    sector_map: dict[str, list[StockPerformance]] = {}
    for sector_name, stock_list in SP500_STOCKS.items():
        for symbol, name in stock_list:
            quote = cached_map.get(symbol)
            if not quote or quote.get("unavailable"):
                continue
            price = float(quote.get("price", 0) or 0)
            if price <= 0:
                continue
            perf = StockPerformance(
                symbol=symbol,
                name=name,
                price=round(price, 2),
                change=round(float(quote.get("change", 0) or 0), 2),
                change_percent=round(float(quote.get("change_percent", 0) or 0), 2),
                volume=int(quote.get("volume", 0) or 0),
                market_cap=quote.get("market_cap"),
                sector=sector_name,
            )
            sector_map.setdefault(sector_name, []).append(perf)

    total_cached = sum(len(v) for v in sector_map.values())

    # Fallback: if cache is cold (< 50 stocks), fetch a fast subset live
    if total_cached < 50:
        try:
            fast_rows = _fast_mover_symbol_rows(140)
            live_stocks = await asyncio.wait_for(
                fetch_bulk_quotes(fast_rows, db, force_refresh=True),
                timeout=20.0,
            )
            for stock in live_stocks:
                sec = stock.sector or "Unknown"
                sector_map.setdefault(sec, []).append(stock)
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"Sector fallback fetch failed: {e}")

    sectors = []
    for sector_name, stocks in sector_map.items():
        if not stocks:
            continue
        avg_change = sum(s.change_percent for s in stocks) / len(stocks)
        sectors.append(SectorPerformance(
            sector=sector_name,
            change_percent=round(avg_change, 2),
            stocks=stocks,
        ))

    sectors.sort(key=lambda x: x.change_percent, reverse=True)
    return sectors


@router.get("/market/heatmap")
async def get_heatmap_data(db: Session = Depends(get_db)) -> HeatmapData:
    """
    Get market heatmap data with real quotes.
    NO FAKE DATA - only includes stocks with available quotes.
    """
    sectors = []
    total_gainers = 0
    total_losers = 0
    total_unchanged = 0
    
    for sector_name, stock_list in SP500_STOCKS.items():
        symbols_info = [(symbol, name, sector_name) for symbol, name in stock_list]
        stocks = await fetch_bulk_quotes(symbols_info, db)
        
        for perf in stocks:
            if perf.change_percent > 0.1:
                total_gainers += 1
            elif perf.change_percent < -0.1:
                total_losers += 1
            else:
                total_unchanged += 1
        
        if stocks:
            avg_change = sum(s.change_percent for s in stocks) / len(stocks)
            sectors.append(SectorPerformance(
                sector=sector_name,
                change_percent=round(avg_change, 2),
                stocks=stocks
            ))
    
    return HeatmapData(
        sectors=sectors,
        total_stocks=total_gainers + total_losers + total_unchanged,
        gainers=total_gainers,
        losers=total_losers,
        unchanged=total_unchanged
    )


@router.get("/market/gainers")
async def get_top_gainers(
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get top gaining stocks with real data.
    NO FAKE DATA - returns only stocks with available quotes.
    """
    all_stocks = await _load_movers_universe(db, force_refresh=force_refresh)

    # Sort by gain (highest positive change first)
    all_stocks.sort(key=lambda x: x.change_percent, reverse=True)

    # Return only positive gainers — no abs() fallback to avoid misrepresenting losers as gainers
    gainers = [s for s in all_stocks if s.change_percent > 0]

    return gainers[:limit]


@router.get("/market/losers")
async def get_top_losers(
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get top losing stocks with real data.
    NO FAKE DATA - returns only stocks with available quotes.
    """
    all_stocks = await _load_movers_universe(db, force_refresh=force_refresh)

    # Sort by loss (most negative first)
    all_stocks.sort(key=lambda x: x.change_percent)

    # Return only negative losers — no abs() fallback to avoid misrepresenting gainers as losers
    losers = [s for s in all_stocks if s.change_percent < 0]

    return losers[:limit]


@router.get("/market/yahoo-screener")
async def yahoo_screener_proxy(
    scr_id: str = Query(
        "day_gainers",
        alias="scrId",
        description="Yahoo predefined screener id",
    ),
    region: str = Query("US", max_length=12, description="Yahoo region code, e.g. US, GB, DE"),
    count: int = Query(10, ge=1, le=80),
):
    """
    Server-side Yahoo Finance screener proxy.

    Next.js on AWS/Vercel often gets empty or blocked responses from Yahoo; the backend
    egress path is usually more reliable. Used by /api/quotes/movers on the frontend.
    """
    allowed = {"day_gainers", "day_losers", "most_actives"}
    if scr_id not in allowed:
        raise HTTPException(status_code=400, detail=f"scrId must be one of: {sorted(allowed)}")

    url = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
    params = {
        "formatted": "false",
        "scrIds": scr_id,
        "count": str(count),
        "region": region,
        "lang": "en-US",
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
    }

    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            r = await client.get(url, params=params, headers=headers)
    except Exception as exc:
        logger.warning("yahoo-screener httpx error: %s", exc)
        return {"quotes": [], "error": "upstream_timeout"}

    if r.status_code != 200:
        logger.warning("yahoo-screener HTTP %s region=%s scr=%s", r.status_code, region, scr_id)
        return {"quotes": [], "error": f"yahoo_http_{r.status_code}"}

    try:
        data = r.json()
    except Exception:
        return {"quotes": [], "error": "invalid_json"}

    quotes_raw = data.get("finance", {}).get("result", [{}])
    quotes = quotes_raw[0].get("quotes", []) if quotes_raw else []
    if not isinstance(quotes, list):
        return {"quotes": [], "error": "no_quotes"}

    out: List[Dict[str, Any]] = []
    for q in quotes:
        if not isinstance(q, dict):
            continue
        out.append(
            {
                "symbol": str(q.get("symbol") or ""),
                "name": str(q.get("longName") or q.get("shortName") or q.get("symbol") or ""),
                "price": float(q.get("regularMarketPrice") or 0),
                "change": float(q.get("regularMarketChange") or 0),
                "change_percent": float(q.get("regularMarketChangePercent") or 0),
                "volume": int(q.get("regularMarketVolume") or 0),
                "market_cap": float(q.get("marketCap") or 0),
                "exchange": str(q.get("fullExchangeName") or q.get("exchange") or ""),
                "currency": str(q.get("currency") or "USD"),
            }
        )

    return {"quotes": out, "region": region, "scr_id": scr_id}


@router.get("/market/movers")
async def get_market_movers(
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    limit: int = Query(
        10,
        ge=1,
        le=500,
        description="Max gainers and max losers to return (each list is capped separately)",
    ),
    db: Session = Depends(get_db),
) -> dict:
    """
    Get market movers (gainers and losers combined) with real data.
    Uses a single quote pass over the universe (fast); do not call gainers+losers endpoints twice.
    """
    # First try cached snapshots only (fast, no provider calls).
    all_stocks = _load_cached_mover_rows(db)

    # If cache is thin/empty, trigger slower refresh path.
    if len(all_stocks) < 12:
        all_stocks = await _load_movers_universe(db, force_refresh=force_refresh)

    sorted_up = sorted(all_stocks, key=lambda x: x.change_percent, reverse=True)
    gainers = [s for s in sorted_up if s.change_percent > 0][:limit]
    # Do NOT fall back to abs() for gainers — returning negatives as "gainers" breaks the heatmap color logic

    sorted_down = sorted(all_stocks, key=lambda x: x.change_percent)
    losers = [s for s in sorted_down if s.change_percent < 0][:limit]
    # Do NOT fall back to abs() for losers — returning positive-change stocks as "losers" causes all-green heatmap

    return {
        "gainers": gainers,
        "losers": losers,
        "updated_at": datetime.utcnow().isoformat()
    }


# ── Exchange Universe endpoint ─────────────────────────────────────────────────
_VALID_EXCHANGE_KEYS = {
    "us", "india", "uk", "canada", "germany", "france",
    "japan", "hongkong", "china", "korea", "australia", "brazil",
}

@router.get("/market/universe")
async def get_exchange_universe(
    exchange: str = Query("us", description="Exchange key: us | india | uk | canada | germany | france | japan | hongkong | china | korea | australia | brazil"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Serve ranked stock universe from ExchangeRankedSymbol table (populated by nightly APScheduler job).
    Falls back to live FMP screener fetch if DB is empty for the exchange.
    """
    from app.models.exchange_ranked_symbol import ExchangeRankedSymbol
    from app.services.exchange_universe_service import sync_exchange_universe

    exchange = exchange.lower().strip()
    if exchange not in _VALID_EXCHANGE_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown exchange key: {exchange}. Valid: {sorted(_VALID_EXCHANGE_KEYS)}")

    rows = (
        db.query(ExchangeRankedSymbol)
        .filter(
            ExchangeRankedSymbol.exchange_key == exchange,
            ExchangeRankedSymbol.is_active == True,
        )
        .order_by(ExchangeRankedSymbol.rank_in_exchange)
        .limit(limit)
        .all()
    )

    # If DB is empty for this exchange, trigger a live sync (first-deploy seed)
    if not rows:
        try:
            sync_exchange_universe(db, exchange)
            rows = (
                db.query(ExchangeRankedSymbol)
                .filter(
                    ExchangeRankedSymbol.exchange_key == exchange,
                    ExchangeRankedSymbol.is_active == True,
                )
                .order_by(ExchangeRankedSymbol.rank_in_exchange)
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.warning(f"Live sync fallback failed for {exchange}: {e}")

    return {
        "exchange": exchange,
        "count": len(rows),
        "stocks": [
            {
                "symbol": r.symbol,
                "name": r.name,
                "exchange": r.exchange,
                "country": r.country,
                "currency": r.currency,
                "sector": r.sector,
                "industry": r.industry,
                "market_cap": r.market_cap,
                "price": r.price,
                "change_percent": r.change_percent,
                "volume": r.volume,
                "priority_score": r.priority_score,
                "rank": r.rank_in_exchange,
            }
            for r in rows
        ],
    }
