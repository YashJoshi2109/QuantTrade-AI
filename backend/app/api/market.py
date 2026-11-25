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
import logging

logger = logging.getLogger(__name__)
from app.db.database import get_db
from app.config import settings
from app.services.market_snapshot import MarketSnapshot, MarketSnapshotService, SnapshotRow
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
        ("PATH", "UiPath Inc"), ("GTLB", "GitLab Inc"),
        ("S", "SentinelOne Inc"), ("ESTC", "Elastic NV"), ("DT", "Dynatrace Inc"),
        ("FIVN", "Five9 Inc"), ("RNG", "RingCentral Inc"), ("TWLO", "Twilio Inc"),
        ("GEN", "Gen Digital Inc"),
        ("MNDY", "monday.com Ltd"), ("PAYC", "Paycom Software"), ("PCTY", "Paylocity Holding"),
        ("TOST", "Toast Inc"), ("QLYS", "Qualys Inc"), ("RPD", "Rapid7 Inc"),
        ("TENB", "Tenable Holdings"), ("VRNS", "Varonis Systems"),
        ("BSY", "Bentley Systems"), ("APPF", "AppFolio Inc"), ("PTC", "PTC Inc"),
        ("CDNS", "Cadence Design"), ("SNPS", "Synopsys Inc"),
        ("TYL", "Tyler Technologies"), ("MANH", "Manhattan Associates"),
        ("WEX", "WEX Inc"),
        ("BOX", "Box Inc"), ("PEGA", "Pegasystems Inc"),
        ("FOUR", "Shift4 Payments"),
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
        ("DXCM", "DexCom Inc"), ("MTD", "Mettler-Toledo"),
        ("RMD", "ResMed Inc"), ("ALGN", "Align Technology"), ("TFX", "Teleflex Inc"),
        ("BAX", "Baxter International"), ("BDX", "Becton Dickinson"), ("COO", "Cooper Companies"),
        ("PODD", "Insulet Corp"), ("VEEV", "Veeva Systems"), ("WAT", "Waters Corp"),
        ("CNC", "Centene Corp"), ("MOH", "Molina Healthcare"),
        ("HCA", "HCA Healthcare"), ("THC", "Tenet Healthcare"), ("UHS", "Universal Health Svcs"),
        ("DVA", "DaVita Inc"), ("HSIC", "Henry Schein"), ("XRAY", "Dentsply Sirona"),
        ("STE", "STERIS PLC"), ("INSP", "Inspire Medical Sys"),
        ("ENSG", "Ensign Group"), ("GEHC", "GE HealthCare"),
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
        ("COF", "Capital One"), ("AIG", "AIG Inc"),
        ("PRU", "Prudential Financial"), ("MET", "MetLife Inc"), ("AFL", "Aflac Inc"),
        ("ALL", "Allstate Corp"), ("MTB", "M&T Bank"), ("FITB", "Fifth Third Bancorp"),
        ("RF", "Regions Financial"), ("KEY", "KeyCorp"), ("CFG", "Citizens Financial"),
        ("HBAN", "Huntington Bancshares"),
        # --- new additions to reach ~65 ---
        ("MSCI", "MSCI Inc"), ("NDAQ", "Nasdaq Inc"), ("CBOE", "Cboe Global Markets"),
        ("FIS", "Fidelity National Info"), ("FISV", "Fiserv Inc"), ("GPN", "Global Payments"),
        ("WRB", "W.R. Berkley"), ("TRV", "Travelers Companies"), ("CB", "Chubb Ltd"),
        ("AON", "Aon PLC"), ("AJG", "Arthur J Gallagher"),
        ("BRO", "Brown & Brown"), ("RJF", "Raymond James"), ("LPLA", "LPL Financial"),
        ("NTRS", "Northern Trust"), ("STT", "State Street Corp"),
        ("ZION", "Zions Bancorporation"),
        ("FHN", "First Horizon"), ("ALLY", "Ally Financial"),
        ("SYF", "Synchrony Financial"), ("CINF", "Cincinnati Financial"),
        ("L", "Loews Corp"), ("EG", "Everest Group"),
        ("GL", "Globe Life Inc"), ("ACGL", "Arch Capital Group"),
        ("FNF", "Fidelity Natl Financial"), ("TROW", "T Rowe Price"),
        ("IVZ", "Invesco Ltd"), ("BEN", "Franklin Resources"),
        ("EWBC", "East West Bancorp"), ("WAL", "Western Alliance Bancorp"),
        ("PYPL", "PayPal Holdings"),
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
        ("PENN", "PENN Entertainment"), ("MTN", "Vail Resorts"),
        ("CROX", "Crocs Inc"), ("VFC", "VF Corp"), ("HAS", "Hasbro Inc"),
        ("MAT", "Mattel Inc"),
    ],
    "Communication Services": [
        # --- existing 20 ---
        ("GOOG", "Alphabet Inc C"), ("NFLX", "Netflix Inc"), ("DIS", "Walt Disney"),
        ("CMCSA", "Comcast Corp"), ("VZ", "Verizon Comms"), ("T", "AT&T Inc"),
        ("TMUS", "T-Mobile US"), ("CHTR", "Charter Comms"),
        ("SNAP", "Snap Inc"), ("PINS", "Pinterest Inc"),
        ("MTCH", "Match Group"), ("LYV", "Live Nation Ent"), ("FOXA", "Fox Corp"),
        ("OMC", "Omnicom Group"), ("TTWO", "Take-Two Interactive"),
        ("RBLX", "Roblox Corp"), ("SPOT", "Spotify Technology"),
        # --- new additions to reach ~35 ---
        ("NWSA", "News Corp"), ("NWS", "News Corp B"),
        ("SIRI", "Sirius XM Holdings"),
        ("ZG", "Zillow Group"), ("YELP", "Yelp Inc"),
        ("ANGI", "Angi Inc"), ("CARG", "CarGurus Inc"),
        ("GENI", "Genius Sports"), ("MGNI", "Magnite Inc"), ("TTD", "Trade Desk Inc"),
        ("PUBM", "PubMatic Inc"),
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
        ("DAL", "Delta Air Lines"), ("AAL", "American Airlines"),
        ("LUV", "Southwest Airlines"), ("ALK", "Alaska Air Group"),
        ("BLDR", "Builders FirstSource"), ("HUBB", "Hubbell Inc"), ("WCC", "WESCO Intl"),
        ("AIT", "Applied Industrial"), ("AGCO", "AGCO Corp"), ("OSK", "Oshkosh Corp"),
        ("TEX", "Terex Corp"), ("MIDD", "Middleby Corp"), ("ENTG", "Entegris Inc"),
        ("VRSK", "Verisk Analytics"), ("CPRT", "Copart Inc"), ("RRX", "Regal Rexnord"),
        ("TREX", "Trex Co"), ("NFE", "New Fortress Energy"),
        ("APG", "APi Group Corp"), ("FERG", "Ferguson Enterprises"),
        ("SITE", "SiteOne Landscape"),
        ("GATX", "GATX Corp"),
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
        ("JBLU", "JetBlue Airways"),
        ("FWRD", "Forward Air Corp"),
    ],
    "Consumer Defensive": [
        # --- existing 24 ---
        ("PG", "Procter & Gamble"), ("KO", "Coca-Cola Co"), ("PEP", "PepsiCo Inc"),
        ("COST", "Costco Wholesale"), ("WMT", "Walmart Inc"), ("PM", "Philip Morris"),
        ("MDLZ", "Mondelez Intl"), ("MO", "Altria Group"), ("CL", "Colgate-Palmolive"),
        ("KMB", "Kimberly-Clark"), ("GIS", "General Mills"), ("SYY", "Sysco Corp"),
        ("KR", "Kroger Co"), ("HSY", "Hershey Co"),
        ("STZ", "Constellation Brands"), ("TAP", "Molson Coors"), ("TSN", "Tyson Foods"),
        ("HRL", "Hormel Foods"), ("CAG", "Conagra Brands"), ("CPB", "Campbell Soup"),
        ("MKC", "McCormick & Co"), ("CHD", "Church & Dwight"), ("CLX", "Clorox Co"),
        # --- new additions to reach ~50 ---
        ("ADM", "Archer-Daniels-Midland"), ("BG", "Bunge Global"),
        ("KDP", "Keurig Dr Pepper"), ("MNST", "Monster Beverage"), ("SAM", "Boston Beer Co"),
        ("SJM", "J.M. Smucker"), ("INGR", "Ingredion Inc"), ("DAR", "Darling Ingredients"),
        ("EL", "Estee Lauder"), ("COTY", "Coty Inc"),
        ("LW", "Lamb Weston"), ("POST", "Post Holdings"),
        ("FLO", "Flowers Foods"), ("USFD", "US Foods Holding"), ("PFGC", "Performance Food Group"),
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
        ("EQT", "EQT Corp"), ("AR", "Antero Resources"), ("RRC", "Range Resources"),
        ("PR", "Permian Resources"),
        ("CHRD", "Chord Energy"), ("SM", "SM Energy"), ("MTDR", "Matador Resources"),
        ("DINO", "HF Sinclair Corp"), ("DK", "Delek US Holdings"),
        ("PBF", "PBF Energy Inc"), ("PARR", "Par Pacific Holdings"),
        ("AM", "Antero Midstream"), ("DTM", "DT Midstream"),
        ("HESM", "Hess Midstream Partners"), ("EPD", "Enterprise Products Partners"),
        ("MPLX", "MPLX LP"), ("PAA", "Plains All American"),
        ("VNOM", "Viper Energy"),
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
        ("BKH", "Black Hills Corp"), ("AVA", "Avista Corp"),
        ("SR", "Spire Inc"), ("WTRG", "Essential Utilities"),
        ("CWT", "California Water Svc"), ("MSEX", "Middlesex Water"),
        ("UTL", "Unitil Corp"), ("IDA", "IDACORP Inc"), ("OGS", "ONE Gas Inc"),
        ("POR", "Portland General Elec"), ("MGEE", "MGE Energy"),
    ],
    "Real Estate": [
        # --- existing 20 ---
        ("PLD", "Prologis Inc"), ("AMT", "American Tower"), ("CCI", "Crown Castle"),
        ("EQIX", "Equinix Inc"), ("PSA", "Public Storage"), ("O", "Realty Income"),
        ("WELL", "Welltower Inc"), ("SPG", "Simon Property Group"), ("DLR", "Digital Realty"),
        ("ARE", "Alexandria RE"),
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
        ("CUBE", "CubeSmart"),
        ("REXR", "Rexford Industrial"), ("STAG", "STAG Industrial"), ("FR", "First Industrial"),
        ("TRNO", "Terreno Realty"), ("NNN", "NNN REIT Inc"), ("ADC", "Agree Realty"),
        ("SKT", "Tanger Factory Outlet"),
        ("COLD", "Americold Realty"),
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
        ("PKG", "Packaging Corp"), ("AVY", "Avery Dennison"),
        ("CE", "Celanese Corp"), ("EMN", "Eastman Chemical"), ("RPM", "RPM International"),
        ("CC", "Chemours Co"),
        # --- new additions to reach ~40 ---
        ("BALL", "Ball Corp"), ("CF", "CF Industries"), ("MOS", "Mosaic Co"),
        ("FMC", "FMC Corp"), ("ALB", "Albemarle Corp"),
        ("RS", "Reliance Steel"), ("STLD", "Steel Dynamics"),
        ("CLF", "Cleveland-Cliffs"),
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
        ("RARE", "Ultragenyx Pharma"), ("ACAD", "ACADIA Pharma"),
        ("PCVX", "Vaxcyte Inc"), ("RXRX", "Recursion Pharma"), ("RVMD", "Revolution Medicines"),
        # --- new additions to reach ~35 ---
        ("SRPT", "Sarepta Therapeutics"), ("NBIX", "Neurocrine Bio"),
        ("UTHR", "United Therapeutics"), ("INSM", "Insmed Inc"), ("NTRA", "Natera Inc"),
        ("ARGX", "argenx SE"), ("LEGN", "Legend Biotech"), ("RPRX", "Royalty Pharma"),
        ("TECH", "Bio-Techne Corp"), ("BIO", "Bio-Rad Labs"), ("BNTX", "BioNTech SE"),
        ("NVAX", "Novavax Inc"), ("TWST", "Twist Bioscience"), ("CRSP", "CRISPR Therapeutics"),
        ("BEAM", "Beam Therapeutics"), ("NTLA", "Intellia Therapeutics"),
        ("EDIT", "Editas Medicine"), ("FATE", "Fate Therapeutics"),
        ("IMVT", "Immunovant Inc"),
        ("RCKT", "Rocket Pharma"), ("ARVN", "Arvinas Inc"),
        ("KRYS", "Krystal Biotech"), ("IOVA", "Iovance Biotherapeutics"),
    ],
    "Aerospace & Defense": [
        ("BA", "Boeing Co"), ("RTX", "RTX Corp"), ("LMT", "Lockheed Martin"),
        ("GD", "General Dynamics"), ("NOC", "Northrop Grumman"), ("LHX", "L3Harris Technologies"),
        ("TDG", "TransDigm Group"), ("HEI", "HEICO Corp"),
        ("TXT", "Textron Inc"), ("CW", "Curtiss-Wright"),
        ("KTOS", "Kratos Defense"), ("BWXT", "BWX Technologies"), ("LDOS", "Leidos Holdings"),
        ("SAIC", "Science Applications"), ("BAH", "Booz Allen Hamilton"),
        ("PSN", "Parsons Corp"), ("KBR", "KBR Inc"), ("CACI", "CACI International"),
        ("MRCY", "Mercury Systems"),
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
        ("ON", "ON Semiconductor"), ("SWKS", "Skyworks Solutions"),
        ("MCHP", "Microchip Technology"), ("GFS", "GlobalFoundries"), ("ARM", "Arm Holdings"),
        ("WOLF", "Wolfspeed Inc"), ("DIOD", "Diodes Inc"), ("SLAB", "Silicon Laboratories"),
        ("LSCC", "Lattice Semiconductor"), ("RMBS", "Rambus Inc"), ("CRUS", "Cirrus Logic"),
        ("MKSI", "MKS Instruments"), ("COHR", "Coherent Corp"), ("ACLS", "Axcelis Technologies"),
        ("POWI", "Power Integrations"), ("SMTC", "Semtech Corp"), ("SITM", "SiTime Corp"),
        ("ALGM", "Allegro MicroSystems"),
    ],
}


def _flatten_sp500_symbol_rows() -> List[tuple]:
    """All (symbol, name, sector) rows for one bulk quote fetch."""
    rows: List[tuple] = []
    for sector_name, stock_list in SP500_STOCKS.items():
        for symbol, name in stock_list:
            rows.append((symbol, name, sector_name))
    return rows


# One snapshot for movers / sectors / heatmap / breadth (see app.services.market_snapshot).
# Requests never fan out to quote providers; a single background task refreshes
# expired quote_snapshots rows, so these endpoints cannot hold DB connections
# or the event loop hostage while Yahoo/Public are slow.
market_snapshots = MarketSnapshotService(_flatten_sp500_symbol_rows())


def _perf(row: SnapshotRow) -> StockPerformance:
    return StockPerformance(
        symbol=row.symbol,
        name=row.name,
        price=row.price,
        change=row.change,
        change_percent=row.change_percent,
        volume=row.volume,
        market_cap=row.market_cap,
        sector=row.sector,
    )


async def _snapshot(force_refresh: bool = False) -> MarketSnapshot:
    # `is True`: chat/copilot call get_top_gainers(10, db) positionally, which
    # used to pass the Session as force_refresh and force a live refetch.
    return await market_snapshots.get(force_refresh=force_refresh is True)


def _sector_performances(snap: MarketSnapshot) -> List[SectorPerformance]:
    return [
        SectorPerformance(sector=name, change_percent=chg, stocks=[_perf(r) for r in rows])
        for name, chg, rows in snap.sector_changes()
    ]


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
def get_market_coverage(  # sync: DB counts run in the threadpool
    db: Session = Depends(get_db)) -> MarketCoverageStats:
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
    db: Session = Depends(get_db),  # unused; kept for direct callers
) -> List[StockPerformance]:
    """Universe stocks with real quotes (shared snapshot). NO FAKE DATA."""
    snap = await _snapshot()
    rows = [r for r in snap.rows if not sector or r.sector.lower() == sector.lower()]
    return [_perf(r) for r in rows[:limit]]


@router.get("/market/sectors")
async def get_sector_performance(db: Session = Depends(get_db)) -> List[SectorPerformance]:
    """Sector performance (median member move) from the shared market snapshot.

    Same rows as /market/heatmap and /market/movers, so breadth derived from any
    of them agrees. NO FAKE DATA - only stocks with usable quotes.
    """
    snap = await _snapshot()
    sectors = _sector_performances(snap)
    sectors.sort(key=lambda x: x.change_percent, reverse=True)
    return sectors


@router.get("/market/heatmap")
async def get_heatmap_data(
    force_refresh: bool = Query(False, description="Refresh quotes before answering (bounded wait)"),
    db: Session = Depends(get_db),  # unused; kept for direct callers
) -> HeatmapData:
    """Market heatmap from the shared snapshot; breadth via market_breadth.breadth_counts."""
    snap = await _snapshot(force_refresh)
    return HeatmapData(
        sectors=_sector_performances(snap),
        total_stocks=snap.breadth["total"],
        gainers=snap.breadth["up"],
        losers=snap.breadth["down"],
        unchanged=snap.breadth["flat"],
    )


@router.get("/market/gainers")
async def get_top_gainers(
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db),  # unused; kept for direct callers
) -> List[StockPerformance]:
    """Top gainers from the shared snapshot. NO FAKE DATA."""
    snap = await _snapshot(force_refresh)
    return [_perf(r) for r in snap.gainers(limit)]


@router.get("/market/losers")
async def get_top_losers(
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db),  # unused; kept for direct callers
) -> List[StockPerformance]:
    """Top losers from the shared snapshot. NO FAKE DATA."""
    snap = await _snapshot(force_refresh)
    return [_perf(r) for r in snap.losers(limit)]


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
    db: Session = Depends(get_db),  # unused; kept for direct callers
) -> dict:
    """Gainers + losers + breadth, all from ONE snapshot (same one as heatmap/sectors).

    Gainers are strictly > 0% and losers strictly < 0% (never abs()-padded:
    that turned the heatmap all-green). `breadth` uses the ±0.1% flat band.
    """
    snap = await _snapshot(force_refresh)
    return {
        "gainers": [_perf(r) for r in snap.gainers(limit)],
        "losers": [_perf(r) for r in snap.losers(limit)],
        "breadth": snap.breadth,
        "updated_at": snap.built_at.isoformat(),
        **snap.meta(),
    }


# ── Exchange Universe endpoint ─────────────────────────────────────────────────
_VALID_EXCHANGE_KEYS = {
    "us", "india", "uk", "canada", "germany", "france",
    "japan", "hongkong", "china", "korea", "australia", "brazil",
}

@router.get("/market/universe")
def get_exchange_universe(  # sync: DB + blocking FMP sync run in the threadpool
    
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
