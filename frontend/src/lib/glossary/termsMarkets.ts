/**
 * Glossary terms: SEC filings and data, backtesting, options and volatility,
 * macro and market structure. Original definitions; examples use
 * hypothetical companies and round numbers, never real reported figures.
 */
import type { GlossaryTerm } from './types'

export const MARKET_TERMS: GlossaryTerm[] = [
  // ─── SEC filings and data ────────────────────────────────────────────────
  {
    slug: 'form-4',
    term: 'SEC Form 4 (insider transactions)',
    short: 'Form 4',
    category: 'filings-data',
    summary: 'Form 4 is the SEC filing a company insider submits to report buying, selling or otherwise changing their holdings of the company\'s stock.',
    body: [
      "Officers, directors and anyone who owns more than 10 percent of a company's shares are treated as insiders under Section 16 of the Securities Exchange Act. When an insider's holdings change, they must file a Form 4 with the SEC, generally within two business days of the transaction. The filing lists the date, the number of shares, the price, the holdings left afterwards and a one-letter transaction code that says what kind of change it was.",
      "The codes matter more than the headline number. Code P is an open-market or private purchase and code S is an open-market or private sale. Other codes cover option exercises (M), tax withholding on vesting shares (F), gifts (G) and grants or awards (A). A large insider 'sale' is often just shares withheld to pay tax on a stock award, which says little about the insider's view of the business.",
      "Purchases tend to be read as more informative than sales, because insiders sell for many personal reasons, such as diversification, a house or taxes, but usually buy for one: they expect the shares to be worth more. Even so, insider buying is one input among many, not a reliable signal on its own.",
    ],
    formula: 'Net insider activity = value of code P purchases - value of code S sales (non-derivative securities only)',
    example:
      "A hypothetical chief financial officer files a Form 4 showing three lines: 10,000 shares withheld for tax at $50 (code F), 5,000 shares sold at $52 (code S) and 2,000 shares bought at $48 (code P). Net insider activity counts only the last two: $96,000 bought minus $260,000 sold, or net selling of $164,000. The $500,000 of tax withholding is excluded because it is not a market decision.",
    seeOn: [
      { label: 'Insider activity on stock pages', href: '/stocks' },
      { label: 'Research: ownership tab', href: '/research' },
      { label: 'How insider data is timed', href: '/methodology#public-data' },
    ],
    related: ['rule-10b5-1', 'form-13f', 'point-in-time-data', 'form-8-k'],
  },
  {
    slug: 'rule-10b5-1',
    term: 'Rule 10b5-1 trading plan',
    short: '10b5-1 plan',
    category: 'filings-data',
    summary: 'A Rule 10b5-1 plan is a pre-arranged schedule that lets an insider buy or sell company stock automatically, set up before they hold inside information.',
    body: [
      "Insiders often know things the market does not, which makes any trade they place look suspicious. SEC Rule 10b5-1 offers a defence: an insider can adopt a written plan, while not in possession of material non-public information, that fixes in advance how many shares will be traded, at what prices or on what dates. Trades then happen mechanically, even if the insider later learns something important.",
      "Amendments effective in 2023 tightened the rule. Directors and officers must now wait a cooling-off period, typically at least 90 days, between adopting a plan and the first trade, overlapping plans are restricted, and companies must disclose plan adoptions and terminations in their quarterly and annual reports. Form 4 filings indicate whether a reported trade was made under a 10b5-1 plan.",
      "For a reader, the plan flag changes how much a sale says. A sale under a plan adopted months earlier was decided before recent news and is usually routine, for example an executive selling a fixed number of shares every month to diversify. A discretionary sale outside a plan, especially a large one just before results, carries more information, although it still is not proof of anything.",
    ],
    example:
      "A hypothetical chief executive adopts a 10b5-1 plan in January to sell 4,000 shares on the 15th of every month from May. In July the stock falls 20 percent after weak guidance, and the July Form 4 shows a 4,000-share sale flagged as made under the plan. Because the schedule was fixed six months earlier, the sale tells you about the executive's diversification plan, not about the guidance.",
    seeOn: [
      { label: 'Research: insider activity', href: '/research' },
      { label: 'AI copilot (insider activity)', href: '/copilot' },
    ],
    related: ['form-4', 'form-8-k', 'form-10-q'],
  },
  {
    slug: 'form-13f',
    term: 'SEC Form 13F (institutional holdings)',
    short: '13F',
    category: 'filings-data',
    summary: 'Form 13F is the quarterly SEC report in which large investment managers disclose the US-listed stocks and other securities they hold.',
    body: [
      "Any institutional investment manager with discretion over at least $100 million of qualifying US securities must file a Form 13F each quarter. The filing lists each position as of the last day of the quarter: the issuer, its CUSIP identifier, the number of shares and the market value. Hedge funds, mutual fund companies, pension managers, banks and insurers all file them.",
      "The key limitation is timing. Managers have up to 45 days after the quarter ends to file, so a 13F filed in mid-May shows holdings as of March 31. By the time you read the newest filing, the positions are already six to twenty weeks old, and the manager may have sold them since. Older quarters are older still, which is why we describe the newest 13F data as two to five months old.",
      "A 13F also leaves things out. It covers long positions in listed equities and some options and convertible securities, but not short positions, cash, most foreign holdings or bonds. QuantTrade AI uses original filings only, ignores amendments, and counts share positions only, not options. Treat 13F ownership as a slow, partial picture of who owns a stock, not as a live view of what smart money is doing.",
    ],
    example:
      "A hypothetical fund reports 2,000,000 shares of a company worth $100 million as of June 30, filed on August 14. The company's total share count is 80 million, so this manager held 2.5 percent. If the September 30 filing shows 1,500,000 shares, the manager sold about 500,000 shares at some point during the third quarter, but the filing does not say when or at what price.",
    seeOn: [
      { label: '13F owners on stock pages', href: '/stocks' },
      { label: 'Research: ownership tab', href: '/research' },
      { label: 'Filing lags explained', href: '/methodology#public-data' },
    ],
    related: ['form-4', 'point-in-time-data', 'market-cap'],
  },
  {
    slug: 'form-10-k',
    term: 'Form 10-K (annual report)',
    short: '10-K',
    category: 'filings-data',
    summary: 'Form 10-K is the audited annual report a US public company files with the SEC, covering its business, risks and full-year financial statements.',
    body: [
      "The 10-K is the most complete document a US-listed company publishes about itself. It describes the business and its segments, lists risk factors, explains results in Management's Discussion and Analysis (MD&A), and contains the full-year income statement, balance sheet, cash flow statement and notes, all audited by an independent accounting firm. It also covers legal proceedings, executive pay references and the number of shares outstanding.",
      "Deadlines depend on company size. Large accelerated filers must file within 60 days of the fiscal year end, accelerated filers within 75 days and smaller companies within 90 days. Because fiscal years do not always end in December, 10-Ks arrive throughout the year. The glossy annual report sent to shareholders is a separate marketing document; the 10-K is the legal one.",
      "For research, the most useful parts are often not the headline numbers, which were usually announced weeks earlier in an earnings release, but the notes and the risk factors. Changes in wording from one year to the next, such as a new risk factor, a changed revenue recognition policy or a new customer concentration disclosure, can say more than the totals.",
    ],
    example:
      "A hypothetical retailer with a fiscal year ending January 31 is a large accelerated filer, so its 10-K is due by early April. Its earnings release in early March already gave revenue of $5 billion and net income of $250 million. The 10-K adds that one supplier provides 40 percent of inventory, a fact added to the risk factors for the first time that year.",
    seeOn: [
      { label: 'Research: financials tab (SEC filings)', href: '/research' },
      { label: 'AI copilot (filing search)', href: '/copilot' },
      { label: 'How fundamentals are built', href: '/methodology#fundamentals' },
    ],
    related: ['form-10-q', 'form-8-k', 'xbrl', 'eps'],
  },
  {
    slug: 'form-10-q',
    term: 'Form 10-Q (quarterly report)',
    short: '10-Q',
    category: 'filings-data',
    summary: 'Form 10-Q is the quarterly report a US public company files with the SEC for each of the first three fiscal quarters, with reviewed financial statements.',
    body: [
      "A company files a 10-Q after each of its first three fiscal quarters; the fourth quarter is covered by the annual 10-K instead. The 10-Q contains condensed financial statements for the quarter and the year to date, an MD&A section, updates to risk factors, and disclosures about legal matters, share repurchases and market risk. Its statements are reviewed by the auditor rather than fully audited.",
      "Large accelerated and accelerated filers must file within 40 days of the quarter end, and other companies within 45 days. Cash flow figures in a 10-Q are usually reported year to date, so the second-quarter filing shows six months of cash flow, not three. Analysts subtract the earlier period to isolate a single quarter.",
      "That detail matters for trailing twelve month calculations. Because there is no fourth-quarter 10-Q, the fourth quarter has to be derived as the full-year 10-K figure minus the nine-month year-to-date figure from the third-quarter 10-Q. QuantTrade AI does this for flow items such as revenue and cash flow and flags the result as derived, but never derives per-share figures this way, because share counts change during the year.",
    ],
    formula: 'Fourth quarter = full fiscal year (10-K) - first nine months (third-quarter 10-Q)',
    example:
      "A hypothetical software company reports nine-month revenue of $300 million in its third-quarter 10-Q and full-year revenue of $420 million in its 10-K. Fourth-quarter revenue is $420 million minus $300 million, or $120 million, which is then combined with the three prior quarters to build trailing twelve month revenue.",
    seeOn: [
      { label: 'Research: financials tab', href: '/research' },
      { label: 'How TTM figures are built', href: '/methodology#fundamentals' },
    ],
    related: ['form-10-k', 'form-8-k', 'xbrl', 'eps'],
  },
  {
    slug: 'form-8-k',
    term: 'Form 8-K (current report)',
    short: '8-K',
    category: 'filings-data',
    summary: 'Form 8-K is the SEC current report a public company files within four business days to announce a major event, such as results, a deal or a departure.',
    body: [
      "Between its quarterly and annual reports, a company must tell investors about significant events as they happen. It does so with a Form 8-K, usually due within four business days of the event. The form is organised into numbered items: Item 2.02 covers results of operations, which is how most earnings releases reach the SEC; Item 1.01 covers material agreements; Item 2.01 completed acquisitions; Item 5.02 changes in directors or officers; and Item 7.01 and 8.01 cover other disclosures the company chooses to make.",
      "Because 8-Ks are filed close to the event, they are often the first official record of news that will later appear in a 10-Q or 10-K. Earnings press releases are usually attached as an exhibit, so the 8-K is where reported revenue and EPS first appear in an SEC filing on results day.",
      "QuantTrade AI reads the SEC's live feed of new 8-K filings as one of its news sources, alongside newswires and publisher feeds. An 8-K is a primary source rather than a summary, which makes it useful for checking what a headline actually says, such as whether a departing executive left for personal reasons or after a disagreement.",
    ],
    example:
      "On a Tuesday after the close, a hypothetical manufacturer files an 8-K under Item 2.02 with its quarterly earnings release attached as Exhibit 99.1, reporting EPS of $1.20. The following Monday it files a second 8-K under Item 5.02 announcing that its chief operating officer will leave at month end. Both appear as news within minutes of being accepted by EDGAR.",
    seeOn: [
      { label: 'Research: news and filings', href: '/research' },
      { label: 'How news is classified', href: '/methodology#news' },
      { label: 'AI copilot (filing search)', href: '/copilot' },
    ],
    related: ['form-10-k', 'form-10-q', 'form-4', 'eps-surprise'],
  },
  {
    slug: 'xbrl',
    term: 'XBRL (eXtensible Business Reporting Language)',
    short: 'XBRL',
    category: 'filings-data',
    summary: 'XBRL is the machine-readable tagging format US companies use in SEC filings so every reported number can be extracted and compared automatically.',
    body: [
      "When a company files a 10-K or 10-Q, each number in its financial statements is tagged with a label from a standard taxonomy, such as us-gaap:Revenues or us-gaap:NetIncomeLoss, along with the period it covers, its unit and its scale. These tags are XBRL. They let software read a filing the way a spreadsheet reads a cell, instead of scraping numbers from text and tables.",
      "The SEC collects these tags and publishes them through its company facts API, one JSON file per company containing every value it has ever tagged. This is the main source of QuantTrade AI fundamentals. It is free, comes directly from the filer and records exactly which filing and accession number each value came from.",
      "XBRL is not perfectly uniform. Companies can choose between similar tags, create their own custom extensions, or switch tags between years, and the same revenue line may appear under different names. Restatements add a second value for the same period. QuantTrade AI handles this by mapping each line item through an ordered list of tag aliases, keeping the latest restated value while retaining the original, and following each filer's own fiscal calendar.",
    ],
    example:
      "A hypothetical company tags its sales as us-gaap:SalesRevenueNet through 2017 and as us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax afterwards, after an accounting standard changed. A naive reader would see revenue vanish in 2018. A tag alias list that tries both names, in priority order, produces one continuous revenue series of, say, $800 million, $850 million and $900 million.",
    seeOn: [
      { label: 'Research: financials tab', href: '/research' },
      { label: 'How fundamentals are built', href: '/methodology#fundamentals' },
    ],
    related: ['form-10-k', 'form-10-q', 'point-in-time-data', 'eps'],
  },
  {
    slug: 'point-in-time-data',
    term: 'Point-in-time data',
    short: 'Point-in-time data',
    category: 'filings-data',
    summary: 'Point-in-time data records each value with the moment it became public, so a historical study only sees what investors could actually have known then.',
    body: [
      "Most financial databases store the latest version of each number. If a company restated last year's earnings, the database shows the restated figure, and if a quarterly report came out six weeks after the quarter ended, the database still files the number under the quarter end date. That is convenient for reading, but it quietly lies to any backtest that uses it.",
      "A point-in-time dataset keeps every version of every value, each stamped with when it became available. A query for 'what was known on March 1' returns only the rows available on or before that moment. For SEC filings, QuantTrade AI uses the EDGAR acceptance time, the timestamp when the SEC system accepted the filing, as the availability time. Restatements are stored as new rows instead of overwriting the original.",
      "Other datasets get their own availability rules. 13F holdings are available at the end of their filing date, not on the quarter end they describe. Treasury yields are treated as available at 6 p.m. Eastern on their date, monthly CPI and unemployment on their scheduled release morning, and FINRA short interest seven business days after its settlement date.",
    ],
    example:
      "A hypothetical company's fiscal quarter ends on December 31, and its 10-Q with EPS of $2.00 is accepted by EDGAR on February 10 at 4:15 p.m. A screen run as of January 31 must not see that EPS figure. If the company later restates the quarter to $1.80, a study dated March 1 still sees $2.00, while one dated after the restatement sees $1.80.",
    seeOn: [
      { label: 'Point-in-time rules', href: '/methodology#public-data' },
      { label: 'AI copilot (point-in-time fundamentals)', href: '/copilot' },
    ],
    related: ['look-ahead-bias', 'survivorship-bias', 'xbrl', 'form-13f'],
  },
  {
    slug: 'short-interest',
    term: 'Short interest',
    short: 'Short interest',
    category: 'filings-data',
    summary: 'Short interest is the number of a company\'s shares that have been sold short and not yet bought back, reported by FINRA twice a month.',
    body: [
      "Short sellers borrow shares and sell them, hoping to buy them back later at a lower price. Short interest counts the shares sold short that are still open at a given settlement date. Brokers report their customers' short positions to FINRA, which publishes the totals twice a month, for a mid-month and a month-end settlement date. The data arrives with a delay: QuantTrade AI treats each report as available seven business days after its settlement date.",
      "The raw share count is usually compared with something. Short interest as a percentage of float, the shares available to trade, shows how crowded the bet against a stock is; figures above 20 percent are generally considered high. Days to cover compares it with trading volume. Rising short interest means more investors are betting on a decline or hedging, while falling short interest means shorts are closing.",
      "High short interest cuts both ways. It may reflect well-researched concerns about a business, but it also means many holders must eventually buy shares back, which can amplify a rally if good news arrives, the so-called short squeeze. Short interest is also partly hedging by funds that own related securities, such as convertible bonds, so not every short is a directional bet.",
    ],
    formula: 'Short interest % of float = shares sold short / float shares x 100',
    example:
      "A hypothetical company has 50 million shares in its float, and FINRA's month-end report shows 6 million shares sold short, up from 4 million two weeks earlier. Short interest is 6 million divided by 50 million, or 12 percent of float, and it rose by half in one reporting period. The figure becomes available about seven business days after the settlement date.",
    seeOn: [
      { label: 'Research: fundamentals tab', href: '/research' },
      { label: 'Data timing', href: '/methodology#public-data' },
    ],
    related: ['days-to-cover', 'point-in-time-data', 'market-cap'],
  },
  {
    slug: 'days-to-cover',
    term: 'Days to cover (short ratio)',
    short: 'Days to cover',
    category: 'filings-data',
    summary: 'Days to cover estimates how many average trading days it would take short sellers to buy back all shares they have sold short.',
    body: [
      "Days to cover, also called the short interest ratio, divides the number of shares sold short by the stock's average daily trading volume. It answers a practical question: if every short seller wanted to close their position at once, and they could use all of the normal daily volume to do it, how long would it take?",
      "A low figure, such as one or two days, means short positions are small relative to how much the stock trades and could be unwound quickly. A high figure, such as eight or ten days, means shorts are large relative to liquidity. If good news forces them to buy back at the same time, they compete for a limited supply of shares, which can push the price sharply higher. That is why traders watch days to cover alongside short interest as a percentage of float.",
      "The ratio moves for two reasons, and it is worth knowing which. It rises when short interest grows, but it also rises when volume dries up, for example in a quiet holiday period, even if no new shorts were added. QuantTrade AI computes it from FINRA's twice-monthly short interest and recent average volume, so it changes only when a new FINRA report is published.",
    ],
    formula: 'Days to cover = shares sold short / average daily trading volume',
    example:
      "A hypothetical stock has 9 million shares sold short and trades an average of 1.5 million shares a day over the past month. Days to cover is 9 million divided by 1.5 million, or 6 days. If volume falls to 1 million shares a day while short interest is unchanged, days to cover rises to 9 days even though no new short positions were opened.",
    seeOn: [
      { label: 'Research: fundamentals tab', href: '/research' },
      { label: 'AI copilot (short interest)', href: '/copilot' },
    ],
    related: ['short-interest', 'market-breadth', 'market-cap'],
  },

  // ─── Backtesting and research ────────────────────────────────────────────
  {
    slug: 'look-ahead-bias',
    term: 'Look-ahead bias',
    short: 'Look-ahead bias',
    category: 'backtesting',
    summary: 'Look-ahead bias is the error of letting a backtest use information that was not yet available at the moment each simulated decision was made.',
    body: [
      "A backtest is supposed to replay history as an investor would have lived it. Look-ahead bias creeps in whenever the simulation uses a number from the future, and it nearly always makes results look better than they could have been. It is the most common reason a strategy that looks brilliant in a spreadsheet fails in live trading.",
      "It hides in ordinary places. Buying at the close of the same day that produced the signal assumes you knew the close before it happened. Using quarterly earnings on the quarter end date ignores the weeks before the report was filed. Using a restated figure ignores what was originally published. Computing an indicator with data that includes today's still-unfinished bar uses prices that have not settled.",
      "The QuantTrade AI backtester is built to avoid these traps. A rule is evaluated using data up to the close of a bar, and the order fills at the open of the next bar the symbol trades. Indicators use only past values, highest-high and lowest-low lookbacks exclude the current bar, and today's partial bar is dropped while the market is open. Public datasets are stored point-in-time, so a study only sees filings already accepted by EDGAR.",
    ],
    example:
      "A hypothetical strategy buys any stock whose quarterly earnings grew 30 percent, entering on the quarter end date. In the backtest it returns 25 percent a year. But the reports were filed about five weeks after each quarter ended. Shifting entries to the day after the filing date, when the information was actually public, cuts the simulated return to 8 percent a year.",
    seeOn: [
      { label: 'Backtester', href: '/backtest' },
      { label: 'How backtests avoid look-ahead', href: '/methodology#backtests' },
    ],
    related: ['point-in-time-data', 'survivorship-bias', 'walk-forward-analysis', 'slippage'],
  },
  {
    slug: 'survivorship-bias',
    term: 'Survivorship bias',
    short: 'Survivorship bias',
    category: 'backtesting',
    summary: 'Survivorship bias is the distortion that comes from studying only the companies or funds that still exist today, ignoring the ones that failed.',
    body: [
      "If you test a strategy on the stocks in today's index, you are testing it on winners. Companies that went bankrupt, were delisted or shrank out of the index are missing, and so are their losses. A backtest on a survivor-only list therefore overstates returns and understates risk, sometimes by several percentage points a year.",
      "The same problem affects fund studies. Funds that perform badly are often closed or merged into other funds, and their records disappear from databases, so the average surviving fund looks better than the average fund an investor could actually have chosen. Any statistic computed only on things that still exist should be read with that in mind.",
      "Avoiding survivorship bias requires a list of what existed at each date, including companies that later disappeared, and their prices up to the day they were delisted. QuantTrade AI's backtester runs on the symbols you choose, so a test of today's large technology companies over 20 years will carry this bias. That is a limitation to keep in mind: a test of hand-picked names is a test of hindsight as much as of the rules.",
    ],
    example:
      "Suppose a hypothetical index had 100 members in 2010, and 20 were later delisted after losing an average of 80 percent. A backtest using only the 80 members still listed today shows an average gain of 150 percent over the period. Including the 20 failures at their delisting prices lowers the average gain across all 100 to 104 percent.",
    seeOn: [
      { label: 'Backtester', href: '/backtest' },
      { label: 'Limits of our numbers', href: '/methodology#limits' },
    ],
    related: ['look-ahead-bias', 'point-in-time-data', 'walk-forward-analysis', 'max-drawdown'],
  },
  {
    slug: 'walk-forward-analysis',
    term: 'Walk-forward analysis',
    short: 'Walk-forward',
    category: 'backtesting',
    summary: 'Walk-forward analysis tests a strategy by repeatedly tuning it on one stretch of history and then measuring it on the next, unseen stretch.',
    body: [
      "Tuning a strategy's parameters on the same data used to judge it almost guarantees an impressive result, because the parameters end up fitted to noise. Walk-forward analysis separates the two. History is cut into consecutive folds. For each fold, the parameters are chosen using only the data before it, then the strategy is run on the fold itself, which it has never seen. The out-of-sample results from every fold are joined into one record.",
      "There are two common layouts. In an anchored walk-forward, every training window starts at the beginning of the data and grows over time. In a rolling walk-forward, the training window has a fixed length and slides forward, so old data drops out. Rolling windows adapt faster to changing markets; anchored windows use more data and are more stable.",
      "In the QuantTrade AI backtester you can choose two to ten folds, anchored or rolling, with at least 126 trading days, about six months, of training data per fold. A strategy whose out-of-sample results are far worse than its in-sample results is probably overfit. The same rolling-origin idea is used to test the statistical forecast ranges, where only holdout results are reported.",
    ],
    example:
      "A hypothetical moving-average strategy is tested on ten years of data in five rolling folds. In each fold, the best moving-average length over the prior two years is chosen, then traded for the next year. In-sample, the tuned versions average a Sharpe ratio of 1.4. Out of sample, the five folds average 0.4, a sign that much of the in-sample result was fitted noise.",
    seeOn: [
      { label: 'Backtester', href: '/backtest' },
      { label: 'Overfitting checks', href: '/methodology#overfitting' },
      { label: 'Forecast testing', href: '/methodology#forecasts' },
    ],
    related: ['look-ahead-bias', 'monte-carlo-simulation', 'sharpe-ratio', 'survivorship-bias'],
  },
  {
    slug: 'slippage',
    term: 'Slippage',
    short: 'Slippage',
    category: 'backtesting',
    summary: 'Slippage is the gap between the price a trade was expected to fill at and the price it actually filled at, usually a cost to the trader.',
    body: [
      "When you decide to buy at $100, you rarely pay exactly $100. You cross the bid-ask spread, your order may move the price if it is large relative to what is available, and the price can change between the decision and the fill. The difference between the expected and the actual price is slippage. It is measured in basis points, hundredths of a percent, and it applies on both entry and exit.",
      "Slippage is small for a single trade in a large, liquid stock, but it compounds with trading frequency. A strategy that trades every day pays it hundreds of times a year, and many strategies that look profitable before costs lose money after them. Small and illiquid stocks, wide spreads, market orders at the open and fast markets all increase slippage.",
      "The QuantTrade AI backtester moves every simulated fill against the trade by a slippage amount, 5 basis points by default, and charges a separate commission on the filled value, 1 basis point by default. Both are adjustable, and it is worth rerunning a strategy with higher costs to see how sensitive it is. A result that disappears when slippage doubles was never robust.",
    ],
    formula: 'Fill price (buy) = reference price x (1 + slippage bps / 10,000); fill price (sell) = reference price x (1 - slippage bps / 10,000)',
    example:
      "A strategy buys 1,000 shares at a next-day open of $50.00. With 5 basis points of slippage, the fill is $50.025, costing $25 more than the open price, and a 1 basis point commission on $50,025 adds about $5. If the strategy trades 200 times a year, these costs total around $6,000 on a $50,000 position, about 12 percent a year.",
    seeOn: [
      { label: 'Backtester cost settings', href: '/backtest' },
      { label: 'Classic backtester', href: '/backtest/classic' },
      { label: 'How fills are simulated', href: '/methodology#backtests' },
    ],
    related: ['look-ahead-bias', 'walk-forward-analysis', 'sharpe-ratio', 'extended-hours-trading'],
  },
  {
    slug: 'monte-carlo-simulation',
    term: 'Monte Carlo simulation',
    short: 'Monte Carlo',
    category: 'backtesting',
    summary: 'A Monte Carlo simulation reruns a result many times with randomised inputs to show the range of outcomes that luck alone could have produced.',
    body: [
      "A single backtest produces one path: one sequence of returns, one final value, one maximum drawdown. But the order in which good and bad days arrived was partly luck, and a slightly different history could have produced a very different drawdown. Monte Carlo simulation addresses this by generating many alternative paths from the same underlying data and looking at the spread of results.",
      "QuantTrade AI resamples the strategy's daily returns with a stationary block bootstrap. Instead of drawing single days at random, which would destroy streaks and volatility clusters, it draws blocks of consecutive days whose lengths average 20 trading days, and stitches them into a new path of the same length. By default it builds 500 such paths and reports the 5th, 50th and 95th percentiles of annual return (CAGR) and maximum drawdown, plus the share of paths with a drawdown worse than 50 percent.",
      "The output is a range, not a forecast. If the 5th percentile drawdown is much worse than the backtest's own drawdown, the historical result was flattered by a lucky ordering. A simulation cannot invent risks that never appeared in the data, such as a crash bigger than any in the test period, so the true range of outcomes is wider still.",
    ],
    example:
      "A hypothetical strategy's backtest shows a 12 percent CAGR and a 15 percent maximum drawdown. Across 500 bootstrap paths, the median CAGR is 11 percent, the 5th to 95th percentile range of CAGR is 3 to 19 percent, and the 5th percentile drawdown is 31 percent. The single backtest drawdown of 15 percent was near the lucky end of what the same returns could produce.",
    seeOn: [
      { label: 'Backtester Monte Carlo', href: '/backtest' },
      { label: 'Backtest method', href: '/methodology#backtests' },
    ],
    related: ['max-drawdown', 'walk-forward-analysis', 'value-at-risk', 'sharpe-ratio'],
  },

  // ─── Options and volatility ──────────────────────────────────────────────
  {
    slug: 'implied-volatility',
    term: 'Implied volatility (IV)',
    short: 'Implied volatility',
    category: 'options',
    summary: 'Implied volatility is the future volatility that today\'s option prices imply, quoted as an annualised percentage of the stock price.',
    body: [
      "An option's price depends on the stock price, the strike, the time to expiry, interest rates and how much the stock is expected to move. All of these are known except the last. Implied volatility is the value of that missing input that makes a pricing model, such as Black-Scholes, reproduce the option's market price. In other words, it is the market's price for uncertainty, backed out of what traders are paying.",
      "IV is quoted as an annualised standard deviation. An IV of 30 percent means the options are priced as if the stock's yearly returns had a standard deviation of about 30 percent. To translate it to a shorter period, scale by the square root of time: over one month, 30 percent annual IV corresponds to about 8.7 percent. Implied volatility usually rises ahead of known events such as earnings and falls sharply afterwards, which traders call volatility crush.",
      "IV is not a forecast of direction and it is not always accurate. It reflects supply and demand for options, including demand for protection, so it often sits above the volatility the stock actually delivers. Comparing implied volatility with realised volatility, and with the stock's own IV history, gives context on whether options look expensive or cheap.",
    ],
    formula: 'Expected 1-standard-deviation move over T days = price x IV x sqrt(T / 365)',
    example:
      "A hypothetical stock trades at $100 and its options imply 40 percent annual volatility. Over 30 calendar days, the one standard deviation move is $100 x 0.40 x sqrt(30 / 365), or about $11.50. The options are priced as if there is roughly a two-in-three chance the stock ends the month between about $88.50 and $111.50.",
    seeOn: [
      { label: 'Outlook: implied moves', href: '/outlook' },
      { label: 'Research: option chain', href: '/research' },
    ],
    related: ['implied-move', 'option-greeks', 'vix', 'beta'],
  },
  {
    slug: 'implied-move',
    term: 'Implied move (expected move)',
    short: 'Implied move',
    category: 'options',
    summary: 'The implied move is the size of price swing, up or down, that option prices are pricing in for a stock by a given expiry date.',
    body: [
      "The implied move turns option prices into a plain number: how far the market expects a stock to move by a particular expiry. A quick way to estimate it is the price of the at-the-money straddle, a call and a put at the strike nearest the current price, both expiring on the same date. Because the straddle pays off on a move in either direction, its cost approximates the expected size of the move, without saying which way.",
      "Implied moves are most often discussed around earnings. The straddle for the first expiry after a report includes the normal daily movement plus the extra uncertainty of the announcement, so its implied move is usually much larger than for a quiet week. Comparing that number with the stock's actual moves after past reports shows whether options have tended to overprice or underprice the event.",
      "On QuantTrade AI, the Outlook page shows the implied move to each expiry, the probability the option market assigns to finishing above a chosen price, and how past earnings moves compared with what was implied. These are readings of market prices, not predictions. The stock can and often does move more or less than implied.",
    ],
    formula: 'Implied move (approx.) = at-the-money call price + at-the-money put price; as a percentage = straddle price / stock price',
    example:
      "A hypothetical stock trades at $80 the day before earnings. The $80 call expiring that Friday costs $3.10 and the $80 put costs $2.90, so the straddle costs $6.00. The implied move is about $6, or 7.5 percent, which suggests a range of roughly $74 to $86 by Friday. If the stock's last eight post-earnings moves averaged 5 percent, options are pricing in a bigger reaction than usual.",
    seeOn: [
      { label: 'Outlook: implied moves', href: '/outlook' },
      { label: 'Earnings calendar', href: '/earnings' },
    ],
    related: ['implied-volatility', 'option-greeks', 'eps-surprise', 'vix'],
  },
  {
    slug: 'option-greeks',
    term: 'Option Greeks (delta, gamma, theta, vega)',
    short: 'Greeks',
    category: 'options',
    summary: 'The Greeks measure how an option\'s price responds to changes in the stock price, the passage of time and implied volatility.',
    body: [
      "Delta is how much the option's price changes for a $1 move in the stock. A call's delta runs from 0 to 1 and a put's from 0 to -1. An at-the-money option has a delta near 0.5 in absolute terms, while deep in-the-money options approach 1. Delta is also a rough guide to the probability that the option finishes in the money, and to how many shares of stock the option behaves like.",
      "Gamma is how much delta itself changes for a $1 move in the stock. It is highest for at-the-money options close to expiry, which is why their prices can swing so quickly. Theta is the time decay: how much value the option loses per day if nothing else changes. Option buyers pay theta and sellers collect it, and it accelerates as expiry approaches.",
      "Vega is how much the option's price changes for a one percentage point change in implied volatility. Longer-dated options have more vega, so they are more exposed to shifts in the market's uncertainty. Together the Greeks describe an option's risks in separate pieces; they come from a pricing model and change continuously as the stock, time and volatility move.",
    ],
    formula: 'Price change (approx.) = delta x stock move + 0.5 x gamma x stock move^2 + theta x days + vega x IV change (points)',
    example:
      "A hypothetical call costs $4.00 with delta 0.50, gamma 0.05, theta -0.06 and vega 0.12. If the stock rises $2 over one day and implied volatility is unchanged, the estimate is $4.00 + 0.50 x 2 + 0.5 x 0.05 x 4 - 0.06 = $5.04. If implied volatility instead falls 5 points with the stock flat, the call loses about $0.60 plus a day of theta.",
    seeOn: [
      { label: 'Research: option chain', href: '/research' },
      { label: 'Outlook', href: '/outlook' },
    ],
    related: ['implied-volatility', 'implied-move', 'vix', 'beta'],
  },

  // ─── Macro and market structure ──────────────────────────────────────────
  {
    slug: 'yield-curve',
    term: 'Treasury yield curve',
    short: 'Yield curve',
    category: 'macro-market',
    summary: 'The yield curve plots US Treasury yields across maturities, from one month to 30 years, showing what borrowing costs over each horizon.',
    body: [
      "The US Treasury publishes a daily par yield curve: the yield on government debt at standard maturities such as 1, 3 and 6 months and 1, 2, 5, 10, 20 and 30 years. Plotting those yields against maturity gives the yield curve. Normally it slopes upward, because lenders want more compensation to tie up money for longer and to bear more inflation and interest-rate risk.",
      "The shape carries information. A steep curve, with long yields well above short ones, often appears early in an economic expansion. A flat curve suggests the market expects short-term rates to fall or growth to slow. An inverted curve, where short-term yields exceed long-term ones, has preceded most US recessions in recent decades, although the lag has varied widely and inversions have not always been followed by recession.",
      "Yields also feed directly into valuation. The 10-year Treasury yield is the risk-free rate in QuantTrade AI discount rate (WACC) estimates and caps the default terminal growth rate in DCF models. QuantTrade AI treats each day's Treasury curve as available at 6 p.m. Eastern on its date. The Markets page shows the curve along with two common spreads, 10-year minus 2-year and 10-year minus 3-month.",
    ],
    example:
      "On a hypothetical day, the 3-month bill yields 5.2 percent, the 2-year note 4.6 percent and the 10-year note 4.2 percent. The curve is inverted at the front: the 10-year minus 3-month spread is -1.0 percentage point and the 10-year minus 2-year spread is -0.4 point. A year later, with the 3-month at 4.0 percent and the 10-year at 4.4 percent, the curve has steepened back to a positive slope.",
    seeOn: [
      { label: 'Markets: yield curve card', href: '/markets' },
      { label: 'How WACC uses yields', href: '/methodology#wacc' },
      { label: 'AI copilot (yield curve)', href: '/copilot' },
    ],
    related: ['2s10s-spread', 'wacc', 'discounted-cash-flow', 'sector-rotation'],
  },
  {
    slug: '2s10s-spread',
    term: '2s10s spread (10-year minus 2-year Treasury yield)',
    short: '2s10s spread',
    category: 'macro-market',
    summary: 'The 2s10s spread is the 10-year Treasury yield minus the 2-year yield, a widely watched measure of how steep or inverted the yield curve is.',
    body: [
      "Bond traders shorten the names of maturities, so the 2-year and 10-year Treasury notes become 'twos' and 'tens', and the gap between their yields is the 2s10s spread. It is quoted in percentage points or basis points. A positive spread means the curve slopes upward between those maturities; a negative spread means it is inverted.",
      "The 2-year yield moves closely with expectations for the Federal Reserve's policy rate over the next couple of years, while the 10-year yield also reflects longer-run growth, inflation and term premium. The spread therefore summarises how tight policy is relative to the long-run outlook. When the Fed raises rates to fight inflation, the 2-year often rises faster than the 10-year, flattening or inverting the spread.",
      "An inverted 2s10s spread has a long record as a recession warning, but the timing is loose: in past cycles, recessions have started anywhere from several months to about two years after inversion, and a re-steepening has sometimes come just before the downturn. The 10-year minus 3-month spread is a close cousin that some researchers prefer. QuantTrade AI's yield curve card on the Markets page shows both, labelled 10Y-2Y and 10Y-3M.",
    ],
    formula: '2s10s spread = 10-year Treasury yield - 2-year Treasury yield (x 100 for basis points)',
    example:
      "If the 10-year Treasury yields 4.10 percent and the 2-year yields 4.60 percent, the 2s10s spread is 4.10 minus 4.60, or -0.50 percentage point (-50 basis points): an inverted curve. If six months later the 10-year is at 4.30 percent and the 2-year has fallen to 4.00 percent, the spread is +30 basis points and the curve has re-steepened.",
    seeOn: [
      { label: 'Markets: yield curve card', href: '/markets' },
      { label: 'AI copilot (yield curve)', href: '/copilot' },
    ],
    related: ['yield-curve', 'wacc', 'sector-rotation', 'vix'],
  },
  {
    slug: 'fama-french-factors',
    term: 'Fama-French factors',
    short: 'Fama-French factors',
    category: 'macro-market',
    summary: 'Fama-French factors are return series for market, size, value, profitability and investment styles, used to explain what drives a stock\'s returns.',
    body: [
      "Economists Eugene Fama and Kenneth French showed that a stock's returns are explained better by several broad factors than by market beta alone. Their three-factor model adds size (SMB, small minus big: small companies' returns minus large companies') and value (HML, high minus low: cheap stocks by book-to-market minus expensive ones) to the market's excess return. The five-factor version adds profitability (RMW, robust minus weak) and investment (CMA, conservative minus aggressive asset growth).",
      "Each factor is a long-short portfolio return, published daily and monthly in Kenneth French's data library. Regressing a stock's or a portfolio's excess returns on these factors gives a loading on each one, showing whether its behaviour resembles small caps, value stocks, highly profitable companies and so on. Whatever return the factors cannot explain is the intercept, alpha.",
      "QuantTrade AI offers this as an AI copilot analysis, not a page of its own. It runs an ordinary least squares regression on the daily five-factor (2x3) series, uses Newey-West standard errors with five lags to allow for autocorrelation, and annualises alpha over 252 trading days. Factor data is treated as available at the end of the month after each observation, matching when the library typically publishes it.",
    ],
    formula: 'Excess return = alpha + b x (market - risk-free) + s x SMB + h x HML + r x RMW + c x CMA + error',
    example:
      "A hypothetical fund's daily excess returns are regressed on the five factors. The result shows a market loading of 1.1, a size loading of 0.4, a value loading of -0.3 and an annualised alpha of 1 percent with a t-statistic of 0.6. The fund behaves like a slightly aggressive small-cap growth portfolio, and its alpha is not statistically distinguishable from zero.",
    seeOn: [
      { label: 'AI copilot (factor regression)', href: '/copilot' },
      { label: 'Data timing', href: '/methodology#public-data' },
    ],
    related: ['beta', 'sharpe-ratio', 'sector-rotation', 'market-cap'],
  },
  {
    slug: 'market-breadth',
    term: 'Market breadth',
    short: 'Market breadth',
    category: 'macro-market',
    summary: 'Market breadth measures how many stocks are taking part in a market move, for example how many rose versus fell or trade above their moving average.',
    body: [
      "An index like the S&P 500 is weighted by market value, so a handful of very large companies can drive it higher even while most of its members fall. Market breadth looks past the index level and counts participation. Common measures are the advance-decline ratio, the number of stocks making new 52-week highs versus new lows, and the percentage of stocks trading above their 50-day or 200-day moving average.",
      "Broad participation, with most stocks and sectors rising together, is usually read as a healthier advance than a narrow one led by a few names. Divergences attract attention: if the index makes a new high while fewer stocks are above their 200-day average than at the previous high, the rally is resting on a narrowing base. Breadth can stay narrow for long periods, though, so it is a description of the market's internals rather than a timing tool.",
      "On QuantTrade AI, breadth appears on the home dashboard and Markets page, where the sector heatmap and advance-decline counts show how many stocks in each sector are up or down on the day, and in the market weather bot's daily summaries in the community.",
    ],
    formula: 'Advance-decline ratio = number of rising stocks / number of falling stocks; % above 200-day = stocks above their 200-day SMA / all stocks x 100',
    example:
      "On a hypothetical day, a 500-stock index rises 0.8 percent, but only 180 members rise while 320 fall, an advance-decline ratio of 0.56. Five mega-cap stocks account for most of the index gain. Only 45 percent of members are above their 200-day moving average, down from 70 percent three months earlier, so the index is climbing on narrowing breadth.",
    seeOn: [
      { label: 'Markets: sector heatmap', href: '/markets' },
      { label: 'Community bots: market weather', href: '/community/bots' },
    ],
    related: ['sector-rotation', 'moving-averages', '52-week-high-low', 'vix'],
  },
  {
    slug: 'vix',
    term: 'VIX (Cboe Volatility Index)',
    short: 'VIX',
    category: 'macro-market',
    summary: 'The VIX is an index of the 30-day volatility that S&P 500 option prices imply, often called a gauge of expected market turbulence.',
    body: [
      "Cboe calculates the VIX from the prices of a wide range of S&P 500 index options expiring over roughly the next month. The result is expressed as an annualised percentage, like implied volatility for a single stock. A VIX of 20 means option prices are consistent with the S&P 500 moving about 20 percent over a year, which works out to about 5.8 percent over a 30-day period.",
      "The VIX tends to rise when stocks fall, because investors pay more for put options as protection, and to drift lower in calm, rising markets. Readings in the low teens are typical of quiet periods, the 20s signal unease, and spikes above 40 have occurred mainly during crises. Because it is built from option prices, it measures the cost of insurance as much as a forecast of turbulence.",
      "The VIX itself cannot be bought; products that track VIX futures behave differently from the index and tend to lose value over time when the futures curve slopes upward. On QuantTrade AI, the VIX appears in market-wide context such as the Monitor page's markets widget, the Ideas Lab regime readings and the market weather bot.",
    ],
    formula: 'Expected 30-day S&P 500 move (1 standard deviation) = VIX / sqrt(12)',
    example:
      "If the VIX is at 24, option prices imply a one standard deviation S&P 500 move of about 24 divided by sqrt(12), or 6.9 percent, over the next 30 days. With the index at 5,000, that is a range of roughly 4,650 to 5,350 with about two-in-three odds. A week later, after a selloff, the VIX at 35 implies a 30-day move of about 10 percent.",
    seeOn: [
      { label: 'Monitor: markets widget', href: '/monitor' },
      { label: 'Ideas Lab', href: '/ideas-lab' },
      { label: 'Community bots: market weather', href: '/community/bots' },
    ],
    related: ['implied-volatility', 'market-breadth', 'beta', 'max-drawdown'],
  },
  {
    slug: 'sector-rotation',
    term: 'Sector rotation',
    short: 'Sector rotation',
    category: 'macro-market',
    summary: 'Sector rotation is the movement of investor money from one group of industries to another as views on growth, rates and inflation change.',
    body: [
      "Different industries respond differently to the economic cycle. Banks and industrials often do well when growth is accelerating, technology and other long-duration growth stocks are sensitive to interest rates, and utilities, consumer staples and health care are considered defensive because demand for their products changes little in a slowdown. As expectations shift, investors move money between these groups, and the pattern of which sectors lead and lag is called sector rotation.",
      "It is usually tracked with relative strength: how one sector's return compares with the overall market over a few weeks or months. A rotation into defensive sectors while the index is flat can signal growing caution; a rotation into cyclical and small-cap stocks can signal growing confidence. Rotation is easy to see in hindsight but hard to trade, because leadership changes are noisy and many apparent rotations reverse within weeks.",
      "On QuantTrade AI, sector rotation is visible in the Markets sector heatmap and in the sector rotation community bot, which posts a rules-based summary of sector performance from daily closing prices after each trading day. The Ideas Lab groups its screens by sector, which also shows where strength is concentrated.",
    ],
    formula: 'Relative strength of a sector = sector return over N days - market return over N days',
    example:
      "Over a hypothetical month, the market rises 1 percent, utilities rise 5 percent, consumer staples 4 percent and technology falls 3 percent. Utilities' relative strength is +4 points and technology's is -4 points. After a jump in bond yields the following month, financials lead with a 6 percent gain while utilities give back 2 percent, a rotation back toward cyclicals.",
    seeOn: [
      { label: 'Community bots: sector rotation', href: '/community/bots' },
      { label: 'Markets: sector heatmap', href: '/markets' },
      { label: 'Ideas Lab', href: '/ideas-lab' },
    ],
    related: ['market-breadth', 'yield-curve', 'fama-french-factors', 'beta'],
  },
  {
    slug: 'extended-hours-trading',
    term: 'Extended-hours trading (pre-market and after-hours)',
    short: 'Extended hours',
    category: 'macro-market',
    summary: 'Extended-hours trading is buying and selling stocks outside the 9:30 a.m. to 4:00 p.m. ET regular session: pre-market, after-hours and overnight.',
    body: [
      "US exchanges' regular session runs from 9:30 a.m. to 4:00 p.m. Eastern Time. Trading also happens outside those hours on electronic venues: the pre-market session from about 4:00 a.m. to 9:30 a.m., the after-hours session from 4:00 p.m. to 8:00 p.m., and, at some brokers and alternative venues, an overnight session in between. Many companies release earnings before the open or after the close, so the first reaction to big news often happens in these sessions.",
      "Extended-hours prices deserve caution. Volume is much thinner, spreads are wider and a few trades can move the price a long way, so an after-hours quote may not hold when the regular session opens. Prices printed then are also not part of the official closing price that indexes, funds and most charts use.",
      "That is why QuantTrade AI never mixes extended-hours prices into the headline quote. The main price and daily change always describe the regular session. Pre-market, after-hours and overnight prices appear separately, labelled with their session, with their change measured against the regular-session price. Prints in the first minute after the 4:00 p.m. close still count as regular.",
    ],
    formula: 'Extended-hours change % = (extended-hours price - regular-session price) / regular-session price x 100',
    example:
      "A hypothetical stock closes the regular session at $60.00, up 1 percent on the day. At 4:10 p.m. it reports earnings and trades at $64.80 after hours. QuantTrade AI keeps the headline at $60.00 (+1.0%) and shows 'After hours 64.80 +8.00%' separately, because $64.80 is 8 percent above the regular close. If the stock opens the next day at $62, the earlier after-hours gain partly faded.",
    seeOn: [
      { label: 'How quotes are built', href: '/methodology#quotes' },
      { label: 'Research: price header', href: '/research' },
      { label: 'Stock pages', href: '/stocks' },
    ],
    related: ['implied-move', 'eps-surprise', 'slippage', '52-week-high-low'],
  },
]
