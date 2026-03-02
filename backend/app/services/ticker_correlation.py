"""
Ticker Impact Correlation Service
Correlates global events with stock tickers and ETFs
Powers the Ticker Impact Drawer feature
"""
from typing import Dict, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.global_monitor import EventCategory, ThreatLevel


class TickerCorrelationEngine:
    """
    Correlates global events with financial instruments
    Uses sector mapping, geographic exposure, and supply chain data
    """
    
    # Sector-to-event category mapping
    SECTOR_EVENT_CORRELATION = {
        EventCategory.CONFLICT: {
            "Defense": ("positive", 0.85, "Increased defense spending"),
            "Aerospace": ("positive", 0.75, "Military equipment demand"),
            "Energy": ("negative", 0.70, "Supply chain disruption"),
            "Materials": ("negative", 0.65, "Resource access issues"),
        },
        EventCategory.DISASTER: {
            "Insurance": ("negative", 0.90, "Claim payouts"),
            "Utilities": ("negative", 0.80, "Infrastructure damage"),
            "Construction": ("positive", 0.70, "Rebuild demand"),
            "Materials": ("positive", 0.65, "Construction materials"),
        },
        EventCategory.AVIATION: {
            "Airlines": ("negative", 0.95, "Flight disruptions"),
            "Travel": ("negative", 0.85, "Reduced bookings"),
            "Hospitality": ("negative", 0.70, "Tourism impact"),
            "Aerospace": ("negative", 0.60, "Safety concerns"),
        },
        EventCategory.SHIPPING: {
            "Transportation": ("negative", 0.90, "Logistics delays"),
            "Retail": ("negative", 0.75, "Supply chain issues"),
            "Energy": ("mixed", 0.70, "Oil transport impact"),
            "Consumer": ("negative", 0.65, "Product availability"),
        },
        EventCategory.CYBER: {
            "Technology": ("negative", 0.85, "Security concerns"),
            "Cybersecurity": ("positive", 0.90, "Increased demand"),
            "Financial": ("negative", 0.75, "Data breach risks"),
            "Healthcare": ("negative", 0.70, "Patient data exposure"),
        },
        EventCategory.ECONOMIC: {
            "Financial": ("negative", 0.85, "Credit risks"),
            "Real Estate": ("negative", 0.80, "Property values"),
            "Consumer": ("negative", 0.75, "Spending reduction"),
            "Technology": ("mixed", 0.60, "Varied impact"),
        },
        EventCategory.CLIMATE: {
            "Utilities": ("negative", 0.85, "Infrastructure stress"),
            "Agriculture": ("negative", 0.90, "Crop damage"),
            "Insurance": ("negative", 0.80, "Climate claims"),
            "Renewable Energy": ("positive", 0.70, "Alternative energy"),
        },
    }
    
    # Country-to-major-companies mapping (exposure)
    COUNTRY_COMPANY_EXPOSURE = {
        "CHN": ["AAPL", "TSLA", "NKE", "BABA", "JD", "PDD"],  # China
        "TWN": ["TSM", "NVDA", "AAPL", "AMD", "AVGO"],  # Taiwan (semiconductors)
        "JPN": ["SONY", "TM", "MUFG", "NTDOY"],  # Japan
        "KOR": ["SSNLF", "AAPL", "NVDA"],  # South Korea
        "DEU": ["BMW", "VLKAY", "SAP", "SIEGY"],  # Germany
        "GBR": ["HSBC", "BP", "RDS.A", "ULVR"],  # UK
        "FRA": ["LVMUY", "TOT", "SAN"],  # France
        "MEX": ["TSLA", "GM", "F", "KO"],  # Mexico (manufacturing)
        "BRA": ["VALE", "PBR", "ITUB"],  # Brazil
        "IND": ["INFY", "WIT", "HDB"],  # India
        "RUS": ["GAZP", "LUKOY", "XLE"],  # Russia (energy)
        "SAU": ["XLE", "CVX", "XOM"],  # Saudi Arabia (oil)
        "ARE": ["XLE", "BA"],  # UAE
        "ISR": ["INTC", "NVDA", "GOOG"],  # Israel (tech)
        "UKR": ["XLE", "WEAT", "CORN"],  # Ukraine (agriculture)
    }
    
    # Major ETFs by theme
    THEMATIC_ETFS = {
        "defense": ["ITA", "XAR", "PPA", "DFEN"],
        "energy": ["XLE", "XOP", "OIH", "AMLP"],
        "technology": ["XLK", "VGT", "FTEC", "IGM"],
        "semiconductors": ["SMH", "SOXX", "PSI"],
        "airlines": ["JETS", "XTN"],
        "shipping": ["SEA", "BOAT"],
        "insurance": ["KIE", "IAK"],
        "cybersecurity": ["HACK", "CIBR", "BUG"],
        "agriculture": ["DBA", "CORN", "WEAT", "SOYB"],
        "infrastructure": ["PAVE", "IFRA"],
        "emerging_markets": ["EEM", "VWO", "IEMG"],
    }
    
    def __init__(self, db: Session):
        self.db = db
    
    def correlate_event_to_tickers(
        self,
        event_data: Dict,
        max_results: int = 20
    ) -> List[Dict]:
        """
        Find tickers impacted by an event
        
        Args:
            event_data: Event with category, location, severity, etc.
            max_results: Maximum tickers to return
        
        Returns:
            List of ticker impacts sorted by impact score
        """
        impacts = []
        
        category = event_data.get("category")
        country_code = event_data.get("country_code")
        severity = event_data.get("severity", 50)
        threat_level = event_data.get("threat_level", ThreatLevel.MEDIUM)
        
        # 1. Sector-based correlation
        if category in self.SECTOR_EVENT_CORRELATION:
            sector_impacts = self._correlate_by_sector(
                category, severity, threat_level
            )
            impacts.extend(sector_impacts)
        
        # 2. Geographic exposure correlation
        if country_code and country_code in self.COUNTRY_COMPANY_EXPOSURE:
            geo_impacts = self._correlate_by_geography(
                country_code, severity, threat_level, event_data
            )
            impacts.extend(geo_impacts)
        
        # 3. ETF correlation
        etf_impacts = self._correlate_etfs(category, severity)
        impacts.extend(etf_impacts)
        
        # Sort by impact score and deduplicate
        impacts = self._deduplicate_and_rank(impacts, max_results)
        
        return impacts
    
    def _correlate_by_sector(
        self,
        category: EventCategory,
        severity: float,
        threat_level: ThreatLevel
    ) -> List[Dict]:
        """Find tickers in affected sectors"""
        impacts = []
        
        sector_correlations = self.SECTOR_EVENT_CORRELATION.get(category, {})
        
        for sector, (direction, base_confidence, reason) in sector_correlations.items():
            # Get representative tickers for sector
            tickers = self._get_sector_tickers(sector)
            
            for ticker in tickers:
                impact_score = self._calculate_impact_score(
                    severity, threat_level, base_confidence
                )
                
                impacts.append({
                    "ticker": ticker,
                    "sector": sector,
                    "impact_score": impact_score,
                    "correlation_type": "sector",
                    "confidence": base_confidence,
                    "expected_direction": direction,
                    "impact_reason": reason,
                    "correlation_factors": [f"{category.value} → {sector}"]
                })
        
        return impacts
    
    def _correlate_by_geography(
        self,
        country_code: str,
        severity: float,
        threat_level: ThreatLevel,
        event_data: Dict
    ) -> List[Dict]:
        """Find tickers with exposure to affected country"""
        impacts = []
        
        exposed_tickers = self.COUNTRY_COMPANY_EXPOSURE.get(country_code, [])
        
        for ticker in exposed_tickers:
            # Higher confidence for direct geographic exposure
            base_confidence = 0.80
            impact_score = self._calculate_impact_score(
                severity, threat_level, base_confidence
            )
            
            country_name = event_data.get("location_name", country_code)
            
            impacts.append({
                "ticker": ticker,
                "impact_score": impact_score,
                "correlation_type": "geographic",
                "confidence": base_confidence,
                "expected_direction": "negative",  # Usually negative for instability
                "impact_reason": f"Operations/supply chain exposure in {country_name}",
                "correlation_factors": [f"Geographic exposure: {country_code}"]
            })
        
        return impacts
    
    def _correlate_etfs(
        self,
        category: EventCategory,
        severity: float
    ) -> List[Dict]:
        """Find relevant thematic ETFs"""
        impacts = []
        
        # Map event categories to ETF themes
        category_to_theme = {
            EventCategory.CONFLICT: ["defense", "energy"],
            EventCategory.DISASTER: ["insurance", "infrastructure"],
            EventCategory.AVIATION: ["airlines"],
            EventCategory.SHIPPING: ["shipping"],
            EventCategory.CYBER: ["cybersecurity", "technology"],
            EventCategory.ECONOMIC: ["emerging_markets"],
            EventCategory.CLIMATE: ["agriculture", "insurance"],
        }
        
        themes = category_to_theme.get(category, [])
        
        for theme in themes:
            etfs = self.THEMATIC_ETFS.get(theme, [])
            
            for etf in etfs:
                # ETFs have moderate impact (diversified)
                impact_score = min(100, severity * 0.7)
                
                impacts.append({
                    "ticker": etf,
                    "impact_score": impact_score,
                    "correlation_type": "thematic",
                    "confidence": 0.70,
                    "expected_direction": "mixed",
                    "impact_reason": f"Thematic exposure: {theme}",
                    "correlation_factors": [f"{category.value} → {theme} ETF"]
                })
        
        return impacts
    
    def _calculate_impact_score(
        self,
        severity: float,
        threat_level: ThreatLevel,
        base_confidence: float
    ) -> float:
        """Calculate overall impact score (0-100)"""
        # Threat level multipliers
        multipliers = {
            ThreatLevel.CRITICAL: 1.5,
            ThreatLevel.HIGH: 1.2,
            ThreatLevel.MEDIUM: 1.0,
            ThreatLevel.LOW: 0.7,
            ThreatLevel.UNKNOWN: 0.5
        }
        
        multiplier = multipliers.get(threat_level, 1.0)
        impact_score = (severity * base_confidence * multiplier)
        
        return min(100, round(impact_score, 2))
    
    def _deduplicate_and_rank(
        self,
        impacts: List[Dict],
        max_results: int
    ) -> List[Dict]:
        """Remove duplicates and rank by impact score"""
        # Group by ticker, keep highest impact
        ticker_map: Dict[str, Dict] = {}
        
        for impact in impacts:
            ticker = impact["ticker"]
            if ticker not in ticker_map or impact["impact_score"] > ticker_map[ticker]["impact_score"]:
                ticker_map[ticker] = impact
        
        # Sort by impact score
        ranked = sorted(
            ticker_map.values(),
            key=lambda x: x["impact_score"],
            reverse=True
        )
        
        return ranked[:max_results]
    
    def _get_sector_tickers(self, sector: str, limit: int = 5) -> List[str]:
        """Get representative tickers for a sector"""
        # Top companies by sector (could be fetched from database)
        SECTOR_LEADERS = {
            "Defense": ["LMT", "RTX", "BA", "GD", "NOC"],
            "Aerospace": ["BA", "LMT", "GE", "RTX", "TXT"],
            "Energy": ["XOM", "CVX", "COP", "SLB", "EOG"],
            "Materials": ["LIN", "APD", "SHW", "ECL", "NEM"],
            "Insurance": ["BRK.B", "PGR", "MET", "ALL", "AIG"],
            "Utilities": ["NEE", "DUK", "SO", "D", "AEP"],
            "Construction": ["CAT", "DE", "URI", "HD", "LOW"],
            "Airlines": ["DAL", "UAL", "AAL", "LUV", "ALK"],
            "Travel": ["BKNG", "EXPE", "ABNB", "MAR", "HLT"],
            "Hospitality": ["MAR", "HLT", "H", "IHG", "WH"],
            "Transportation": ["UPS", "FDX", "CSX", "UNP", "NSC"],
            "Retail": ["WMT", "AMZN", "HD", "COST", "TGT"],
            "Consumer": ["PG", "KO", "PEP", "WMT", "COST"],
            "Technology": ["AAPL", "MSFT", "GOOGL", "META", "NVDA"],
            "Cybersecurity": ["CRWD", "PANW", "ZS", "FTNT", "CYBR"],
            "Financial": ["JPM", "BAC", "WFC", "C", "GS"],
            "Healthcare": ["UNH", "JNJ", "PFE", "ABBV", "TMO"],
            "Agriculture": ["ADM", "BG", "DE", "CTVA", "FMC"],
            "Renewable Energy": ["ENPH", "SEDG", "FSLR", "RUN", "PLUG"],
            "Real Estate": ["AMT", "PLD", "CCI", "EQIX", "SPG"],
        }
        
        return SECTOR_LEADERS.get(sector, [])[:limit]
    
    def get_related_etfs(self, ticker: str) -> List[str]:
        """Get ETFs that contain this ticker"""
        # Simplified - in production would query ETF holdings database
        etf_suggestions = []
        
        # Check if ticker appears in any thematic ETF group
        for theme, etfs in self.THEMATIC_ETFS.items():
            # Logic to determine if ticker is in this theme
            # For now, return general market ETFs
            pass
        
        # Return broad market ETFs as default
        return ["SPY", "VOO", "QQQ", "IWM", "DIA"][:3]
    
    def get_peer_tickers(self, ticker: str, sector: str) -> List[str]:
        """Get peer companies in same sector"""
        sector_tickers = self._get_sector_tickers(sector, limit=10)
        
        # Remove the input ticker itself
        peers = [t for t in sector_tickers if t != ticker]
        
        return peers[:5]
    
    def calculate_volatility_increase(
        self,
        impact_score: float,
        threat_level: ThreatLevel
    ) -> float:
        """Estimate expected volatility increase (%)"""
        base_volatility = impact_score / 10  # 0-10%
        
        multipliers = {
            ThreatLevel.CRITICAL: 2.0,
            ThreatLevel.HIGH: 1.5,
            ThreatLevel.MEDIUM: 1.0,
            ThreatLevel.LOW: 0.5
        }
        
        multiplier = multipliers.get(threat_level, 1.0)
        
        return round(base_volatility * multiplier, 1)
