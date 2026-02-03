"""
Finviz data fetcher for fast fundamentals and screener data
Uses finviz library for NASDAQ and S&P 500 data
"""
import requests
from typing import Dict, List, Optional
from datetime import datetime
import json
from bs4 import BeautifulSoup


class FinvizFetcher:
    """Fetches stock data from Finviz for faster fundamentals"""
    
    BASE_URL = "https://finviz.com"
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
    
    @staticmethod
    def fetch_stock_fundamentals(symbol: str) -> Dict:
        """
        Fetch comprehensive fundamentals from Finviz
        Much faster than yfinance for basic metrics
        """
        try:
            url = f"{FinvizFetcher.BASE_URL}/quote.ashx?t={symbol.upper()}"
            response = requests.get(url, headers=FinvizFetcher.HEADERS, timeout=5)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract fundamental data from table
            fundamentals = {}
            table = soup.find('table', class_='snapshot-table2')
            
            if table:
                rows = table.find_all('tr')
                for row in rows:
                    cells = row.find_all('td')
                    for i in range(0, len(cells), 2):
                        if i + 1 < len(cells):
                            key = cells[i].get_text(strip=True)
                            value = cells[i + 1].get_text(strip=True)
                            fundamentals[key] = value
            
            # Extract key metrics
            parsed_data = {
                "symbol": symbol.upper(),
                "company_name": FinvizFetcher._extract_company_name(soup),
                "sector": fundamentals.get("Sector", ""),
                "industry": fundamentals.get("Industry", ""),
                "country": fundamentals.get("Country", ""),
                
                # Price metrics
                "price": FinvizFetcher._parse_float(fundamentals.get("Price")),
                "change": fundamentals.get("Change", ""),
                "volume": FinvizFetcher._parse_volume(fundamentals.get("Volume")),
                "avg_volume": FinvizFetcher._parse_volume(fundamentals.get("Avg Volume")),
                
                # Valuation
                "market_cap": FinvizFetcher._parse_market_cap(fundamentals.get("Market Cap")),
                "pe_ratio": FinvizFetcher._parse_float(fundamentals.get("P/E")),
                "forward_pe": FinvizFetcher._parse_float(fundamentals.get("Forward P/E")),
                "peg_ratio": FinvizFetcher._parse_float(fundamentals.get("PEG")),
                "price_to_sales": FinvizFetcher._parse_float(fundamentals.get("P/S")),
                "price_to_book": FinvizFetcher._parse_float(fundamentals.get("P/B")),
                
                # Dividends
                "dividend_yield": FinvizFetcher._parse_percent(fundamentals.get("Dividend %")),
                
                # Profitability
                "profit_margin": FinvizFetcher._parse_percent(fundamentals.get("Profit Margin")),
                "operating_margin": FinvizFetcher._parse_percent(fundamentals.get("Oper. Margin")),
                "gross_margin": FinvizFetcher._parse_percent(fundamentals.get("Gross Margin")),
                "roa": FinvizFetcher._parse_percent(fundamentals.get("ROA")),
                "roe": FinvizFetcher._parse_percent(fundamentals.get("ROE")),
                "roi": FinvizFetcher._parse_percent(fundamentals.get("ROI")),
                
                # Financial Health
                "debt_to_equity": FinvizFetcher._parse_float(fundamentals.get("Debt/Eq")),
                "current_ratio": FinvizFetcher._parse_float(fundamentals.get("Current Ratio")),
                "quick_ratio": FinvizFetcher._parse_float(fundamentals.get("Quick Ratio")),
                
                # Performance
                "52w_high": FinvizFetcher._parse_float(fundamentals.get("52W High")),
                "52w_low": FinvizFetcher._parse_float(fundamentals.get("52W Low")),
                "rsi": FinvizFetcher._parse_float(fundamentals.get("RSI (14)")),
                "beta": FinvizFetcher._parse_float(fundamentals.get("Beta")),
                "atr": FinvizFetcher._parse_float(fundamentals.get("ATR")),
                
                # Earnings
                "eps": FinvizFetcher._parse_float(fundamentals.get("EPS (ttm)")),
                "eps_next_quarter": FinvizFetcher._parse_float(fundamentals.get("EPS next Q")),
                "eps_next_year": FinvizFetcher._parse_float(fundamentals.get("EPS next Y")),
                "earnings_date": fundamentals.get("Earnings", ""),
                
                # Trading
                "shares_outstanding": FinvizFetcher._parse_shares(fundamentals.get("Shs Outstand")),
                "shares_float": FinvizFetcher._parse_shares(fundamentals.get("Shs Float")),
                "short_float": FinvizFetcher._parse_percent(fundamentals.get("Short Float")),
                "short_ratio": FinvizFetcher._parse_float(fundamentals.get("Short Ratio")),
                "insider_ownership": FinvizFetcher._parse_percent(fundamentals.get("Insider Own")),
                "institutional_ownership": FinvizFetcher._parse_percent(fundamentals.get("Inst Own")),
                
                # Analyst
                "target_price": FinvizFetcher._parse_float(fundamentals.get("Target Price")),
                "recommendation": fundamentals.get("Recom", ""),
                
                "fetched_at": datetime.utcnow().isoformat()
            }
            
            return parsed_data
            
        except Exception as e:
            print(f"Finviz fetch error for {symbol}: {e}")
            return {
                "symbol": symbol.upper(),
                "error": str(e),
                "fetched_at": datetime.utcnow().isoformat()
            }
    
    @staticmethod
    def _extract_company_name(soup) -> str:
        """Extract company name from page"""
        try:
            title_tag = soup.find('h1', class_='quote-header_ticker-wrapper_company')
            if title_tag:
                return title_tag.get_text(strip=True)
            # Fallback
            title = soup.find('title')
            if title:
                return title.get_text(strip=True).split('Stock Quote')[0].strip()
        except:
            pass
        return ""
    
    @staticmethod
    def _parse_float(value: Optional[str]) -> Optional[float]:
        """Parse string to float, handle '-' and special cases"""
        if not value or value == '-':
            return None
        try:
            # Remove % and commas
            cleaned = value.replace('%', '').replace(',', '').strip()
            return float(cleaned)
        except:
            return None
    
    @staticmethod
    def _parse_percent(value: Optional[str]) -> Optional[float]:
        """Parse percentage string to float"""
        if not value or value == '-':
            return None
        try:
            return float(value.replace('%', '').strip())
        except:
            return None
    
    @staticmethod
    def _parse_market_cap(value: Optional[str]) -> Optional[float]:
        """Parse market cap (e.g., '2.5T', '150B', '500M')"""
        if not value or value == '-':
            return None
        try:
            value = value.strip().upper()
            multipliers = {'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3}
            
            for suffix, multiplier in multipliers.items():
                if suffix in value:
                    num = float(value.replace(suffix, '').strip())
                    return num * multiplier
            
            return float(value)
        except:
            return None
    
    @staticmethod
    def _parse_volume(value: Optional[str]) -> Optional[int]:
        """Parse volume (e.g., '2.5M', '150K')"""
        if not value or value == '-':
            return None
        try:
            value = value.strip().upper()
            multipliers = {'M': 1e6, 'K': 1e3}
            
            for suffix, multiplier in multipliers.items():
                if suffix in value:
                    num = float(value.replace(suffix, '').strip())
                    return int(num * multiplier)
            
            return int(float(value))
        except:
            return None
    
    @staticmethod
    def _parse_shares(value: Optional[str]) -> Optional[float]:
        """Parse shares outstanding/float (e.g., '2.5B')"""
        if not value or value == '-':
            return None
        try:
            value = value.strip().upper()
            multipliers = {'B': 1e9, 'M': 1e6, 'K': 1e3}
            
            for suffix, multiplier in multipliers.items():
                if suffix in value:
                    num = float(value.replace(suffix, '').strip())
                    return num * multiplier
            
            return float(value)
        except:
            return None
    
    @staticmethod
    def get_sp500_symbols() -> List[str]:
        """Fetch S&P 500 stock symbols from Finviz screener"""
        try:
            url = f"{FinvizFetcher.BASE_URL}/screener.ashx?v=111&f=idx_sp500"
            response = requests.get(url, headers=FinvizFetcher.HEADERS, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            symbols = []
            
            # Find ticker links
            for link in soup.find_all('a', class_='tab-link'):
                symbol = link.get_text(strip=True)
                if symbol and len(symbol) <= 5:  # Valid ticker
                    symbols.append(symbol)
            
            return list(set(symbols))  # Remove duplicates
            
        except Exception as e:
            print(f"Error fetching S&P 500 symbols: {e}")
            return []
    
    @staticmethod
    def get_nasdaq_symbols() -> List[str]:
        """Fetch NASDAQ 100 stock symbols from Finviz screener"""
        try:
            url = f"{FinvizFetcher.BASE_URL}/screener.ashx?v=111&f=idx_ndx"
            response = requests.get(url, headers=FinvizFetcher.HEADERS, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            symbols = []
            
            for link in soup.find_all('a', class_='tab-link'):
                symbol = link.get_text(strip=True)
                if symbol and len(symbol) <= 5:
                    symbols.append(symbol)
            
            return list(set(symbols))
            
        except Exception as e:
            print(f"Error fetching NASDAQ symbols: {e}")
            return []
    
    @staticmethod
    def screener_custom(filters: Dict[str, str]) -> List[Dict]:
        """
        Custom screener with filters
        Example filters: {'marketcap': '+mid', 'pe': 'u20', 'volume': 'o1000'}
        """
        try:
            # Build filter string
            filter_str = '&'.join([f"f={k}_{v}" for k, v in filters.items()])
            url = f"{FinvizFetcher.BASE_URL}/screener.ashx?v=111&{filter_str}"
            
            response = requests.get(url, headers=FinvizFetcher.HEADERS, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            results = []
            
            table = soup.find('table', class_='table-light')
            if table:
                rows = table.find_all('tr')[1:]  # Skip header
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) > 1:
                        results.append({
                            'symbol': cells[1].get_text(strip=True),
                            'company': cells[2].get_text(strip=True) if len(cells) > 2 else '',
                            'sector': cells[3].get_text(strip=True) if len(cells) > 3 else '',
                        })
            
            return results
            
        except Exception as e:
            print(f"Screener error: {e}")
            return []
