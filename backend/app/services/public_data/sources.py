"""Attribution, licence notes and kill switches for every public dataset.

Each API response the frontend renders carries ``attribution`` built from
these entries ("Source: <agency>, as of <date>").  A dataset whose display
rights are unclear has a kill switch (env flag) so it can be hidden on desktop
and mobile at once without a deploy of the frontend.

Licence notes (checked 2026-11-27):

* SEC EDGAR (Financial Statement Data Sets, Form 4, Form 13F data sets):
  US government work, public domain; only the EDGAR fair-access policy applies
  (declared User-Agent, <= 10 req/s): https://www.sec.gov/os/accessing-edgar-data
  https://www.sec.gov/privacy#dissemination
* US Treasury daily par yield curve: public domain US government data.
  https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics
* FRED: series are owned by their original sources.  DGS*/DTB3 (Federal Reserve
  H.15), CPIAUCSL and UNRATE (BLS) are public domain.  BAA10Y is Moody's data
  (copyrighted, "reproduction prohibited without permission"); it is stored and
  used internally (credit-spread input) and is NOT shown in the UI.
  https://fred.stlouisfed.org/legal/
* BLS: public domain; https://www.bls.gov/opub/copyright-information.htm
  (API v2 without a key: 25 queries/day, 10 years per query.)
* Kenneth R. French Data Library: freely downloadable; no written licence on
  the site.  Attributed by name and URL.
  https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html
* FINRA equity short interest and Reg SHO daily short-sale volume: FINRA's
  website Terms of Use limit use to "non-commercial personal or professional
  use", forbid display/redistribution without prior written consent, and forbid
  use with machine learning.  https://www.finra.org/terms-of-use
  API terms: https://developer.finra.org/ (API Terms of Service and the
  "Specific Terms - Equity Data", which say end users may not further
  redistribute equity data).  Short-sale volume is "free for non-commercial use":
  https://www.finra.org/finra-data/browse-catalog/short-sale-volume
  Therefore FINRA data is OFF unless ``FINRA_DATA_ENABLED=1`` (set it only after
  FINRA's written consent, or for local/non-commercial use), and it is never
  written to the ML feature tables.
* Loughran-McDonald dictionary: free for academic research only; commercial
  use needs a licence (https://sraf.nd.edu/loughranmcdonald-master-dictionary/).
  Not used.  Filing tone uses QuantTrade's own short word lists
  (``filing_language.WORD_LISTS``).
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

SOURCES: Dict[str, Dict[str, Any]] = {
    "sec_fsds": {"agency": "SEC", "name": "SEC Financial Statement Data Sets",
                 "url": "https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets",
                 "licence": "Public domain (US government); EDGAR fair-access policy"},
    "sec_form4": {"agency": "SEC", "name": "SEC EDGAR Form 4 filings",
                  "url": "https://www.sec.gov/edgar/search/",
                  "licence": "Public domain (US government); EDGAR fair-access policy"},
    "sec_13f": {"agency": "SEC", "name": "SEC Form 13F data sets",
                "url": "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets",
                "licence": "Public domain (US government); EDGAR fair-access policy"},
    "finra_si": {"agency": "FINRA", "name": "FINRA consolidated equity short interest",
                 "url": "https://www.finra.org/finra-data/browse-catalog/equity-short-interest",
                 "licence": "FINRA Terms of Use: non-commercial use; display needs FINRA consent",
                 "terms_url": "https://www.finra.org/terms-of-use", "flag": "FINRA_DATA_ENABLED"},
    "finra_regsho": {"agency": "FINRA", "name": "FINRA Reg SHO daily short-sale volume",
                     "url": "https://www.finra.org/finra-data/browse-catalog/short-sale-volume",
                     "licence": "FINRA: free for non-commercial use; display needs FINRA consent",
                     "terms_url": "https://www.finra.org/terms-of-use", "flag": "FINRA_DATA_ENABLED"},
    "treasury": {"agency": "US Treasury", "name": "US Treasury daily par yield curve rates",
                 "url": "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
                 "licence": "Public domain (US government)"},
    "fred": {"agency": "Federal Reserve Bank of St. Louis (FRED)", "name": "FRED",
             "url": "https://fred.stlouisfed.org/", "licence": "Per-series; see sources.py notes",
             "terms_url": "https://fred.stlouisfed.org/legal/"},
    "bls": {"agency": "BLS", "name": "US Bureau of Labor Statistics",
            "url": "https://www.bls.gov/developers/", "licence": "Public domain (US government)"},
    "ff": {"agency": "Kenneth R. French Data Library", "name": "Fama-French factors",
           "url": "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html",
           "licence": "Freely downloadable; attributed"},
    "filing_lang": {"agency": "SEC", "name": "QuantTrade text metrics computed from SEC EDGAR 10-K/10-Q filings",
                    "url": "https://www.sec.gov/edgar/search/",
                    "licence": "Computed in-house from public-domain filings"},
}


def enabled(key: str) -> bool:
    flag = SOURCES.get(key, {}).get("flag")
    if not flag:
        return os.getenv(f"PUBLIC_DATA_DISABLE_{key.upper()}", "") != "1"
    return os.getenv(flag, "0") == "1"


def attribution(key: str, as_of: Optional[str], extra: Optional[str] = None) -> Dict[str, Any]:
    s = SOURCES[key]
    text = f"Source: {s['agency']}" + (f" ({extra})" if extra else "") + (f", as of {as_of}" if as_of else "")
    out = {"text": text, "agency": s["agency"], "dataset": s["name"], "url": s["url"], "as_of": as_of,
           "licence": s["licence"]}
    if s.get("terms_url"):
        out["terms_url"] = s["terms_url"]
    return out


def disabled_payload(key: str) -> Dict[str, Any]:
    s = SOURCES[key]
    return {"status": "disabled", "reason": f"{s['name']} is switched off: {s['licence']}.",
            "terms_url": s.get("terms_url"), "attribution": attribution(key, None)}
