"""
News category taxonomy, high-precision regex rules, and embedding seed headlines.

Rules run first. They are written for precision: a rule should only fire when
the headline is clearly about that category. Anything the rules miss goes to
the embedding nearest-centroid fallback (categorizer.py), seeded with the
SEEDS headlines below.
"""
from __future__ import annotations

import re
from typing import Dict, List, Pattern, Tuple

# Order = priority when picking the primary category among several rule hits.
# More specific / more market-moving categories come first.
CATEGORIES: List[Dict[str, str]] = [
    {"key": "earnings", "label": "Earnings",
     "description": "Quarterly/annual results, EPS and revenue vs. estimates, earnings dates."},
    {"key": "guidance", "label": "Guidance",
     "description": "Company outlook changes: raised, cut, reaffirmed or withdrawn forecasts."},
    {"key": "mna", "label": "M&A",
     "description": "Mergers, acquisitions, takeover bids, divestitures, spin-offs."},
    {"key": "ipo_offering", "label": "IPOs & Offerings",
     "description": "IPOs, direct listings, SPACs, secondary/stock offerings, debt raises."},
    {"key": "analyst", "label": "Analyst Ratings",
     "description": "Upgrades, downgrades, initiations and price-target changes."},
    {"key": "regulatory_legal", "label": "Regulatory & Legal",
     "description": "SEC/DOJ/FTC actions, lawsuits, settlements, FDA decisions, antitrust."},
    {"key": "capital_return", "label": "Dividends, Buybacks & Insiders",
     "description": "Dividends, share repurchases, stock splits and insider transactions."},
    {"key": "macro_fed", "label": "Fed & Rates",
     "description": "Federal Reserve and central-bank policy, interest rates, Treasury yields."},
    {"key": "economic_data", "label": "Economic Data",
     "description": "CPI, PPI, jobs reports, GDP, retail sales, PMI and other releases."},
    {"key": "crypto", "label": "Crypto",
     "description": "Bitcoin, Ether, digital-asset companies, exchanges and crypto ETFs."},
    {"key": "energy_commodities", "label": "Energy & Commodities",
     "description": "Oil, natural gas, OPEC, gold, metals and agricultural commodities."},
    {"key": "geopolitics", "label": "Geopolitics & Trade",
     "description": "Tariffs, sanctions, trade wars, conflicts and elections that move markets."},
    {"key": "product_business", "label": "Products & Business",
     "description": "Product launches, partnerships, contracts, layoffs, executive changes."},
    {"key": "other", "label": "Other",
     "description": "Market news that does not fit another category."},
]

CATEGORY_KEYS: List[str] = [c["key"] for c in CATEGORIES]
PRIORITY: Dict[str, int] = {k: i for i, k in enumerate(CATEGORY_KEYS)}


def _rx(*patterns: str) -> Pattern[str]:
    return re.compile("|".join(f"(?:{p})" for p in patterns), re.IGNORECASE)


# Each rule: category -> one compiled regex (alternation of high-precision phrases).
RULES: List[Tuple[str, Pattern[str]]] = [
    ("earnings", _rx(
        r"\b(?:Q[1-4]|first|second|third|fourth)[- ](?:quarter|qtr)?\s*(?:20\d\d\s*)?(?:results|earnings|profit|loss|revenue|sales)",
        r"\bQ[1-4]\s*(?:FY)?\s*(?:20\d\d|'?\d\d)?\s*(?:results|earnings|EPS|revenue)",
        r"\b(?:quarterly|annual|full[- ]year|fiscal(?: year)?)\s+(?:results|earnings|profit|loss|revenue)(?!\s+(?:forecast|outlook|guidance|target|view))",
        r"\b(?:strong|weak|record|solid|better[- ]than[- ]expected|disappointing|blowout)\s+(?:Q[1-4]|first|second|third|fourth)[- ]quarter\b(?!\s+(?:guidance|outlook|forecast|view))",
        r"\bswings? to (?:a )?(?:profit|loss)\b|\b(?:net )?(?:loss|profit) (?:narrows|widens|narrowed|widened)\b",
        r"\b(?:beats?|miss(?:es|ed)?|tops?|topped|exceeds?|exceeded|falls? short of|in line with)\b[^.]{0,40}\b(?:estimates?|expectations|forecasts?|consensus|views?)\b",
        r"\bEPS\b",
        r"\bearnings (?:per share|call|report|release|beat|miss|preview|season|date|results|surprise)",
        r"\breports? (?:Q[1-4]|quarterly|fiscal|first|second|third|fourth)",
        r"\b(?:reports?|posts?) (?:record |higher |lower )?(?:quarterly |annual )?(?:profit|loss|revenue|earnings)",
        r"\b(?:to|will) (?:report|announce|release) (?:its )?(?:Q[1-4]|quarterly|fiscal|first|second|third|fourth|financial results|earnings)",
        r"\bfinancial results\b",
        r"\bsame[- ]store sales\b",
    )),
    ("guidance", _rx(
        r"\b(?:raises?|raised|lifts?|lifted|boosts?|boosted|hikes?|hiked|cuts?|lowers?|lowered|slashes|slashed|trims?|trimmed|reaffirms?|reaffirmed|reiterates?|reiterated|maintains?|withdraws?|withdrew|pulls?|suspends?|ups)\b[^.]{0,40}\b(?:guidance|outlook|forecast|full[- ]year|annual (?:profit|revenue|sales)|(?<!price )(?:margin|sales|revenue|profit|growth|financial) targets?)",
        r"\b(?:guidance|outlook|forecast) (?:raise|cut|beats?|misses?|tops?|disappoints?|above|below|ahead)",
        r"\b(?:weak|soft|strong|upbeat|downbeat|gloomy|bleak|rosy|disappointing|cautious|lackluster|tepid)\b (?:full[- ]year |annual |quarterly |Q[1-4] |\w+ )?(?:guidance|outlook|forecast)",
        r"\bprofit warning\b",
        r"\bwarns? (?:on|of) (?:profit|revenue|sales|earnings)",
    )),
    ("mna", _rx(
        r"\b(?:to|will|agrees? to|in talks to|plans? to|offers? to|bids? to|moves? to|set to|seeks? to|explores?) (?:acquire|merge with|take over|combine with)\b",
        r"\b(?:agrees? to|in talks to|nears? deal to|deal to|offers? to|bids? to|set to|plans? to|seeks? to|moves? to) (?:buy|purchase)\b",
        r"\bsells? (?:its |a |part of its |\d+% )?stake\b|\bstake sale\b",
        r"\b(?:acquires?|acquired|acquisition of|acquisitions?|takeover|buyout|merger|mergers|merge with|merging)\b",
        r"\b(?:all[- ]cash|all[- ]stock|cash[- ]and[- ]stock) (?:deal|offer|transaction)",
        r"\btender offer\b",
        r"\b(?:divests?|divestiture|spin[- ]?off|spins? off|carve[- ]out|sells? (?:its |the )?\w+ (?:unit|business|division))\b",
        r"\bhostile bid\b|\bbid for\b|\bper[- ]share (?:offer|bid)\b|\bgo[- ]private\b|\btake[- ]private\b",
        r"\bdeal (?:to buy|for)\b|\b(?:\$|USD ?)\d[\d.,]*\s*(?:billion|bln|bn|million|mln|B|M)\b[^.]{0,30}\bdeal\b",
    )),
    ("ipo_offering", _rx(
        r"\bIPOs?\b",
        r"\binitial public offering\b|\bdirect listing\b|\bgoes? public\b|\bgoing public\b|\bpublic debut\b|\bmarket debut\b|\btrading debut\b",
        r"\bfiles? (?:confidentially )?(?:for|to) (?:an? )?(?:IPO|U\.S\. IPO|listing|go public)",
        r"\bprices? (?:its |an? |upsized |\$[\d.]+[MB]? )?(?:IPO|offering|public offering|notes|senior notes)",
        r"\b(?:secondary|follow[- ]on|public|registered direct|at[- ]the[- ]market|private placement|convertible (?:notes? |senior notes )?)\s*offering\b",
        r"\bpricing of (?:its |an? )?(?:upsized )?(?:public |underwritten |secondary )?offering\b",
        r"\bSPAC\b|\bblank[- ]check\b",
        r"\b(?:sells?|issues?|raises?|prices?)\s+\$?[\d.,]+\s*(?:billion|million|bn|B|M)?\s+(?:of |in )?(?:bonds|notes|debt|convertibles?)\b|\bbond (?:sale|offering|deal|issue)\b",
        r"\bS-1\b|\bF-1\b",
    )),
    ("analyst", _rx(
        r"\b(?:upgrades?|upgraded|downgrades?|downgraded)\b",
        r"\b(?:cuts?|raises?|lifts?|moves?|lowers?|takes?|bumps?|reiterates?)\s+[A-Z][\w.&'-]*(?:\s[A-Z][\w.&'-]*)?\s+to\s+(?:buy|hold|sell|neutral|overweight|underweight|outperform|underperform|equal[- ]weight)\b",
        r"\b(?:raises?|lifts?|cuts?|lowers?|trims?|boosts?|hikes?)\s+[A-Z][\w.&'-]*(?:\s[A-Z][\w.&'-]*)?\s+(?:price )?target\b",
        r"\bprice target\b|\bPT (?:to|raised|cut|lowered)\b|\btarget price\b",
        r"\b(?:initiates?|initiated|resumes?|resumed|starts?) (?:coverage|at|with)\b[^.]{0,30}\b(?:buy|sell|hold|neutral|overweight|underweight|outperform|underperform|equal[- ]weight|market perform)\b",
        r"\b(?:initiates?|initiated|resumes?) coverage\b",
        r"\b(?:rated|rating|ratings) (?:buy|sell|hold|outperform|underperform|overweight|underweight)\b",
        r"\banalysts? (?:say|says|see|sees|expect|bullish|bearish|turn|cut|raise)\b",
        r"\b(?:to|at) (?:outperform|underperform|overweight|underweight|equal[- ]weight|market perform|sector perform)\b",
    )),
    ("regulatory_legal", _rx(
        r"\bSEC (?:charges?|charged|sues?|sued|fines?|fined|probe|investigation|settle|settlement|subpoena|enforcement|halts?|suspends?|approves?|rejects?|delays?)\b",
        r"\b(?:DOJ|Justice Department|FTC|CFTC|FINRA|CFPB|OCC|FDIC)\b",
        r"\b(?:lawsuit|lawsuits|sues|sued|suing|class action|indicted|indictment|antitrust|subpoena|settlement|verdict|jury|judge|court|plaintiffs?|probe|investigation|fraud|guilty|plea deal|penalty|fined)\b",
        r"\bto settle (?:lawsuit|charges|claims|case|probe|allegations|suit)s?\b",
        r"\bFDA (?:approves?|approved|approval|rejects?|clears?|cleared|grants?|accepts?|warning|panel|advisory|delays?|complete response)\b",
        r"\b(?:EU|European Commission|CMA|regulators?|regulatory) (?:probe|approval|fines?|fined|blocks?|clears?|investigat\w+|scrutiny|crackdown)\b",
        r"\b(?:recall|recalls|recalled)\b|\bcomplete response letter\b",
        r"\bWells notice\b|\bconsent decree\b|\bdelisting notice\b|\bnon[- ]compliance\b",
    )),
    ("capital_return", _rx(
        r"\bdividends?\b|\bpayout (?:hike|increase|cut)\b|\bspecial distribution\b",
        r"\b(?:buybacks?|share repurchases?|stock repurchases?|repurchase (?:program|plan|authorization)|buy back)\b",
        r"\b(?:stock|share) split\b|\b\d+[- ]for[- ]\d+ (?:stock |reverse )?split\b|\breverse split\b",
        r"\binsiders? (?:buy|buys|bought|sell|sells|sold|selling|buying|trading)\b|\binsider (?:purchase|sale|transaction)s?\b",
        r"\b(?:CEO|CFO|director|chairman|founder|executive|officer)s? (?:buys?|bought|sells?|sold|purchases?|purchased|unloads?|dumps?)\b[^.]{0,30}\b(?:shares|stock|stake)\b",
        r"\bForm 4\b|\b13[DG]\b",
    )),
    ("macro_fed", _rx(
        r"\bFed\b|\bFederal Reserve\b|\bFOMC\b|\bPowell\b|\bfed funds\b|\bFed's\b",
        r"\b(?:rate|rates) (?:cut|cuts|hike|hikes|hold|decision|path|outlook)\b|\binterest[- ]rates?\b",
        r"\b(?:ECB|Bank of England|BoE|Bank of Japan|BOJ|PBOC|People's Bank of China|Bank of Canada|RBA|SNB|central banks?)\b",
        r"\b(?:Treasury|bond) yields?\b|\b10-year (?:yield|Treasury|note)\b|\byield curve\b|\bquantitative (?:easing|tightening)\b|\bbalance sheet runoff\b",
        r"\b(?:Lagarde|Bailey|Ueda|Waller|Williams|Jefferson|Bowman|Goolsbee|Daly|Kashkari|Bostic|Logan|Hammack|Barr|Musalem|Schmid|Miran)\b says\b",
    )),
    ("economic_data", _rx(
        r"\bCPI\b|\bPPI\b|\bPCE\b|\bconsumer price(?:s| index)\b|\bproducer price(?:s| index)\b",
        r"\binflation (?:data|report|rate|rises?|falls?|cools?|eases?|accelerates?|slows?|heats?|unexpectedly|figures?|reading)\b|\b(?:core|headline) inflation\b",
        r"\b(?:jobs|employment|payrolls?|nonfarm|non-farm) (?:report|data|growth|numbers?|rise|fall|gains?|beats?|miss)\b|\bnonfarm payrolls\b|\bunemployment (?:rate|claims)\b|\bjobless (?:claims|rate)\b|\bJOLTS\b|\bjob openings\b|\bADP\b",
        r"\bGDP\b|\bgross domestic product\b|\bretail sales\b|\bPMI\b|\bISM\b|\bdurable goods\b|\bhousing starts\b|\bexisting[- ]home sales\b|\bnew[- ]home sales\b|\bconsumer (?:confidence|sentiment)\b|\bindustrial (?:production|output)\b|\bfactory (?:output|activity|orders)\b|\btrade (?:deficit|balance)\b|\bBeige Book\b|\brecession\b",
    )),
    ("crypto", _rx(
        r"\b(?:bitcoin|BTC|ether|ethereum|ETH|solana|XRP|dogecoin|crypto|cryptocurrency|cryptocurrencies|stablecoins?|blockchain|tokeni[sz]ation|DeFi|NFTs?|altcoins?|memecoins?)\b",
        r"\b(?:Coinbase|Binance|MicroStrategy|Tether|Grayscale|Bitwise)\b",
    )),
    ("energy_commodities", _rx(
        r"\b(?:oil|crude|Brent|WTI|OPEC\+?|natural gas|LNG|gasoline|diesel|refin(?:ery|eries|ers?|ing))\b",
        r"\b(?:gold|silver|copper|platinum|palladium|lithium|nickel|aluminum|aluminium|iron ore|uranium|cobalt|rare earths?)\b (?:prices?|futures|rall|slump|surge|hits?|jumps?|falls?|drops?|rises?|climbs?|output|mine|mining|supply|demand|record)",
        r"\b(?:wheat|corn|soybeans?|coffee|cocoa|sugar|cattle) (?:prices?|futures)\b|\bcommodit(?:y|ies)\b",
        r"\bbarrels? (?:per|a) day\b|\boil (?:prices?|futures|output|production|demand)\b",
    )),
    ("geopolitics", _rx(
        r"\btariffs?\b|\bsanctions?\b|\btrade (?:war|deal|talks|truce|tensions|dispute|restrictions)\b|\bexport (?:controls?|curbs?|ban|restrictions)\b|\bimport (?:ban|duties|curbs)\b",
        r"\b(?:war|invasion|missile|airstrikes?|military|ceasefire|cease-fire|troops|conflict|geopolitical|coup|NATO|Kremlin|Pentagon)\b",
        r"\b(?:Ukraine|Russia|Taiwan|Israel|Gaza|Iran|North Korea|Red Sea|Middle East|Strait of Hormuz)\b",
        r"\b(?:election|elections|White House|Congress|Senate|government shutdown|debt ceiling|Trump administration|Beijing|Xi Jinping)\b",
    )),
    ("product_business", _rx(
        r"\b(?:launch(?:es|ed)?|unveils?|unveiled|introduces?|introduced|rolls? out|debuts?|announces? new|releases? new)\b",
        r"\b(?:partnership|partners with|teams up|collaboration|joint venture|strategic alliance|signs? (?:a |an )?(?:deal|agreement|contract)|wins?\b[^.]{0,40}\b(?:contract|order)|awarded (?:a |an )?contract)\b",
        r"\b(?:layoffs?|lays off|job cuts|cut (?:\d[\d,]* )?jobs|cutting (?:\d[\d,]* )?jobs|restructuring|hiring freeze|workforce reduction)\b",
        r"\b(?:CEO|CFO|COO|CTO|chief executive|chairman|president)\b[^.]{0,30}\b(?:steps? down|resigns?|resigned|retire[sd]?|ousted|fired|named|appoints?|appointed|hires?|to depart|exits?|succeed)\b|\b(?:appoints?|names?|named) (?:new )?(?:CEO|CFO|chief)|\b(?:appoints?|names?|named)\b[^.]{0,40}\b(?:CEO|CFO|chief executive|chief financial officer|chairman)\b",
        r"\b(?:opens? new|expands? (?:into|its|production|capacity|partnership)|new (?:plant|factory|facility|stores?|data cent(?:er|re)s?)|production (?:halt|ramp))\b",
    )),
]


def rule_categories(text: str) -> List[str]:
    """Return every category whose rule matches `text`, in priority order."""
    if not text:
        return []
    hits = [cat for cat, rx in RULES if rx.search(text)]
    return sorted(set(hits), key=PRIORITY.__getitem__)


# ── Embedding seeds (~10 per category) ─────────────────────────────────────
# Used to build MiniLM centroids for headlines the rules don't cover. These are
# deliberately phrased WITHOUT the rule trigger words where possible so the
# fallback learns the semantics, not the keywords. Keep them disjoint from
# tests/fixtures/news_categories.jsonl (the evaluation set).
SEEDS: Dict[str, List[str]] = {
    "earnings": [
        "Nike profit tops Wall Street view as China demand rebounds",
        "Walmart quarterly sales growth beats forecasts on grocery strength",
        "Intel posts surprise loss as data-center revenue shrinks",
        "Netflix subscriber additions blow past expectations",
        "Oracle cloud revenue jumps 30% in fiscal second quarter",
        "Costco net income rises on membership fee hike",
        "Disney streaming unit turns profitable for the first time",
        "Ford swings to a loss on warranty costs",
        "Adobe results lifted by AI-powered Creative Cloud demand",
        "Target misses on profit as shoppers pull back on discretionary items",
    ],
    "guidance": [
        "Apple expects double-digit iPhone growth in holiday quarter",
        "Starbucks sees fiscal 2026 sales growth of 5%-7%",
        "UPS projects lower revenue next year as Amazon volumes decline",
        "Micron forecasts record revenue on AI memory demand",
        "Chipmaker sees second-half recovery, shares jump",
        "Retailer tempers annual expectations amid tariff costs",
        "Airline expects fourth-quarter unit revenue to rise",
        "Medtronic narrows full-year profit range",
        "Company now anticipates margins near the low end of prior range",
        "Software maker projects slower growth for coming fiscal year",
    ],
    "mna": [
        "Broadcom agrees to buy VMware for $61 billion",
        "Exxon nears deal for Pioneer Natural Resources",
        "Private equity firm to take Squarespace private in $6.9 billion deal",
        "Chevron wins arbitration, clearing path for Hess purchase",
        "Mars clinches Kellanova in $36 billion snack deal",
        "Cisco completes Splunk purchase",
        "Activist investor pushes for sale of the company",
        "Board rejects unsolicited proposal as undervaluing the business",
        "Pharma giant snaps up biotech for $10.8 billion",
        "Two regional banks combine in all-stock transaction",
    ],
    "ipo_offering": [
        "Arm shares soar in Nasdaq debut",
        "Reddit sets terms for listing, targets $6.4 billion valuation",
        "Shein submits draft listing papers in London",
        "Biotech raises $250 million in upsized share sale",
        "Company prices $1.5 billion of senior unsecured notes",
        "Klarna lists on the New York Stock Exchange",
        "Startup hires banks ahead of planned listing next year",
        "Lender raises $500 million through convertible bond sale",
        "Stock falls after company announces dilutive share sale",
        "Chinese EV maker seeks Hong Kong listing",
    ],
    "analyst": [
        "Goldman lifts Nvidia target to $200, keeps buy rating",
        "Morgan Stanley turns bearish on Tesla",
        "JPMorgan says Apple is a top pick for 2026",
        "Wedbush sees 50% upside in Palantir",
        "Bernstein cuts Intel to underperform on foundry risks",
        "Citi moves Boeing to neutral from buy",
        "Street-high call on Microsoft from Evercore",
        "Barclays starts Snowflake at overweight",
        "Jefferies bullish on homebuilders as rates fall",
        "Wall Street firm says sell Rivian ahead of results",
    ],
    "regulatory_legal": [
        "Google loses landmark search monopoly case",
        "Boeing agrees to plead guilty over 737 MAX crashes",
        "Meta hit with record EU privacy fine",
        "Regulators block proposed merger of grocery chains",
        "Drugmaker gets agency nod for obesity pill",
        "Tesla faces federal investigation into Autopilot crashes",
        "Crypto exchange founder sentenced to prison",
        "Bank to pay $3 billion to resolve money-laundering charges",
        "Apple ordered to allow outside payment links in App Store",
        "Pharma company faces opioid litigation payout",
    ],
    "capital_return": [
        "Apple authorizes record $110 billion repurchase",
        "Coca-Cola increases quarterly payout for 62nd straight year",
        "Nvidia announces 10-for-1 split",
        "Meta initiates first-ever quarterly distribution to shareholders",
        "Jensen Huang sells $30 million of Nvidia stock under 10b5-1 plan",
        "Director scoops up 50,000 shares after selloff",
        "Bank boosts capital returns after passing stress test",
        "REIT declares monthly distribution",
        "Company suspends payout to preserve cash",
        "Berkshire repurchased no stock during the quarter",
    ],
    "macro_fed": [
        "Powell signals patience on further easing",
        "Policymakers hold benchmark rate steady at 4.25%-4.5%",
        "Two-year yield climbs as traders pare bets on cuts",
        "ECB lowers deposit rate by a quarter point",
        "Bank of Japan ends negative interest rate policy",
        "Minutes show officials divided over pace of easing",
        "Markets price in December cut after dovish remarks",
        "Mortgage rates fall to lowest level in a year",
        "Dollar slides as rate differential narrows",
        "Central bank officials warn inflation fight not over",
    ],
    "economic_data": [
        "US economy added 254,000 jobs in September",
        "Consumer prices rose 0.3% in October",
        "Initial claims for unemployment benefits fall to 215,000",
        "Factory activity contracts for fifth straight month",
        "Americans boosted spending at stores last month",
        "Economy grew at 2.8% annualized pace in third quarter",
        "Wholesale prices unexpectedly flat in August",
        "Home builder sentiment slips to four-month low",
        "University of Michigan sentiment index improves",
        "Services sector expands at fastest pace in two years",
    ],
    "crypto": [
        "Bitcoin tops $100,000 for the first time",
        "Ether ETFs see record inflows",
        "Coinbase shares rally with digital asset prices",
        "Stablecoin issuer files for US listing",
        "Crypto lender collapses amid withdrawal freeze",
        "Spot bitcoin funds draw $1 billion in a day",
        "Token prices tumble after exchange hack",
        "Bitcoin miners sell coins as hashprice falls",
        "Digital asset treasury companies pile into SOL",
        "Lawmakers advance market-structure bill for digital assets",
    ],
    "energy_commodities": [
        "Oil climbs as OPEC+ extends output cuts",
        "Crude falls on surprise US inventory build",
        "Gold hits record as investors seek safety",
        "Copper surges on China stimulus hopes",
        "Natural gas prices spike on cold weather forecast",
        "Saudi Aramco raises official selling prices for Asia",
        "Exxon boosts Permian production target",
        "Cocoa prices retreat from record highs",
        "Silver jumps to 12-year high",
        "Gasoline prices drop ahead of holiday travel",
    ],
    "geopolitics": [
        "US raises duties on Chinese electric vehicles to 100%",
        "Washington tightens chip export restrictions on China",
        "Markets slide as Middle East tensions escalate",
        "Stocks rally after US and China agree to pause trade fight",
        "Shipping disrupted as attacks continue in Red Sea",
        "EU retaliates with levies on American goods",
        "Russia sanctions widened to target oil tankers",
        "Investors brace for election-driven volatility",
        "Taiwan tensions weigh on chip stocks",
        "Government shutdown looms as Congress deadlocks",
    ],
    "product_business": [
        "Apple unveils iPhone 17 lineup with new slim model",
        "Microsoft and OpenAI expand cloud agreement",
        "Amazon to cut 14,000 corporate roles",
        "Nvidia wins multibillion-dollar order from Saudi Arabia",
        "Tesla begins robotaxi service in Austin",
        "Starbucks names Chipotle chief Brian Niccol as CEO",
        "Ford expands EV battery plant in Michigan",
        "Disney picks new chief executive to replace Iger",
        "Boeing resumes 737 MAX deliveries after strike ends",
        "OpenAI releases new reasoning model",
    ],
    "other": [
        "Stocks to watch this week",
        "What to know before the market opens",
        "Five things to start your day",
        "Dow, S&P 500 and Nasdaq end mixed in quiet trading",
        "Market wrap: stocks close higher",
        "Here's how to invest for retirement",
        "Top movers in midday trading",
        "Stock market today: live updates",
        "Best high-yield savings accounts this month",
        "The week ahead on Wall Street",
    ],
}
