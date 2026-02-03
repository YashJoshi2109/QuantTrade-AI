// Frontend Integration Examples for Rate Limiting

/**
 * =============================================================================
 * PRIORITY LEVELS GUIDE
 * =============================================================================
 * 
 * HIGH PRIORITY (priority=high)
 * - Research page (viewing stock details)
 * - Markets page (indices and trending stocks)
 * - User-initiated actions (clicking "Refresh" button)
 * Behavior: Will wait up to 10 seconds if rate limited
 * 
 * NORMAL PRIORITY (priority=normal)
 * - Dashboard (multiple tickers at once)
 * - Background polling (auto-refresh every 30s)
 * - Secondary data (news, sentiment)
 * Behavior: Will skip API call and return cached/empty data if rate limited
 */

// =============================================================================
// 1. RESEARCH PAGE - High Priority Real-time Quotes
// =============================================================================

// File: frontend/src/app/research/page.tsx
import { useEffect, useState } from 'react';

const ResearchPage = () => {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchQuoteHighPriority = async (symbol: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=high`
      );
      const data = await response.json();
      setQuote(data);
    } catch (error) {
      console.error('Quote fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={() => fetchQuoteHighPriority('AAPL')}>
        {loading ? 'Loading...' : 'Get Real-time Quote'}
      </button>
      {quote && (
        <div>
          <h3>{quote.symbol}: ${quote.current_price}</h3>
          <p>Change: {quote.change_percent.toFixed(2)}%</p>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// 2. MARKETS PAGE - High Priority Market Indices
// =============================================================================

// File: frontend/src/app/markets/page.tsx
const MarketsPage = () => {
  const [indices, setIndices] = useState([]);

  useEffect(() => {
    const fetchMarketIndices = async () => {
      try {
        // High priority - market indices are critical data
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/market-indices?priority=high`
        );
        const data = await response.json();
        setIndices(data);
      } catch (error) {
        console.error('Market indices error:', error);
      }
    };

    fetchMarketIndices();
    const interval = setInterval(fetchMarketIndices, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>Market Indices</h2>
      {indices.map((index) => (
        <div key={index.symbol}>
          <strong>{index.name}</strong>: ${index.price.toFixed(2)} 
          ({index.change_percent.toFixed(2)}%)
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// 3. DASHBOARD - Normal Priority Multiple Tickers
// =============================================================================

// File: frontend/src/app/page.tsx
const DashboardPage = () => {
  const [tickers, setTickers] = useState([]);

  useEffect(() => {
    const fetchDashboardQuotes = async () => {
      const symbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'];
      
      try {
        // Normal priority - dashboard updates are non-critical
        const promises = symbols.map(symbol =>
          fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=normal`
          ).then(res => res.json())
        );
        
        const results = await Promise.all(promises);
        setTickers(results);
      } catch (error) {
        console.error('Dashboard quotes error:', error);
      }
    };

    fetchDashboardQuotes();
    const interval = setInterval(fetchDashboardQuotes, 60000); // Refresh every 60s
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>Your Watchlist</h2>
      {tickers.map((ticker) => (
        <div key={ticker.symbol}>
          {ticker.symbol}: ${ticker.current_price || 'N/A'}
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// 4. CUSTOM HOOK - useRealtimeQuote with Priority
// =============================================================================

// File: frontend/src/hooks/useRealtimeQuote.ts
import { useState, useEffect } from 'react';

interface QuoteOptions {
  symbol: string;
  priority?: 'high' | 'normal';
  refreshInterval?: number;
  enabled?: boolean;
}

export const useRealtimeQuote = ({
  symbol,
  priority = 'normal',
  refreshInterval = 30000,
  enabled = true
}: QuoteOptions) => {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return;

    const fetchQuote = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=${priority}`
        );
        
        if (!response.ok) throw new Error('Quote fetch failed');
        
        const data = await response.json();
        setQuote(data);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchQuote();
    const interval = setInterval(fetchQuote, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, priority, refreshInterval, enabled]);

  return { quote, loading, error };
};

// Usage in Research Page:
// const { quote, loading, error } = useRealtimeQuote({
//   symbol: 'AAPL',
//   priority: 'high',
//   refreshInterval: 5000  // 5 seconds for research page
// });

// Usage in Dashboard:
// const { quote, loading, error } = useRealtimeQuote({
//   symbol: 'AAPL',
//   priority: 'normal',
//   refreshInterval: 30000  // 30 seconds for dashboard
// });

// =============================================================================
// 5. API STATS MONITORING COMPONENT
// =============================================================================

// File: frontend/src/components/ApiStatsMonitor.tsx
const ApiStatsMonitor = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/api-stats`
        );
        const data = await response.json();
        setStats(data.finnhub);
      } catch (error) {
        console.error('API stats error:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  const { rate_limit, cache } = stats;
  const usagePercent = ((60 - rate_limit.remaining_calls) / 60) * 100;

  return (
    <div className="api-stats-monitor">
      <h4>API Status</h4>
      <div className="rate-limit">
        <span>Rate Limit: </span>
        <strong>{rate_limit.remaining_calls} / {rate_limit.max_calls_per_minute}</strong>
        <div className="progress-bar">
          <div style={{ width: `${usagePercent}%` }} />
        </div>
      </div>
      <div className="cache-stats">
        <span>Cache Entries: </span>
        <strong>{cache.entries}</strong>
      </div>
      {rate_limit.status === 'rate_limited' && (
        <div className="warning">
          ⚠️ Rate limited - wait {rate_limit.wait_time_seconds}s
        </div>
      )}
    </div>
  );
};

// =============================================================================
// 6. NEWS FETCHER WITH PRIORITY
// =============================================================================

// File: frontend/src/lib/newsApi.ts
export const fetchCompanyNews = async (
  symbol: string, 
  priority: 'high' | 'normal' = 'normal'
) => {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/news/${symbol}/finnhub?priority=${priority}&limit=20`
  );
  return response.json();
};

export const fetchMarketNews = async (
  priority: 'high' | 'normal' = 'high'
) => {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/news/market/finnhub?priority=${priority}&limit=20`
  );
  return response.json();
};

// =============================================================================
// 7. REACT QUERY INTEGRATION
// =============================================================================

// File: frontend/src/hooks/useFinnhubData.ts
import { useQuery } from '@tanstack/react-query';

export const useFinnhubQuote = (
  symbol: string, 
  priority: 'high' | 'normal' = 'normal'
) => {
  return useQuery({
    queryKey: ['finnhub-quote', symbol, priority],
    queryFn: async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=${priority}`
      );
      if (!response.ok) throw new Error('Failed to fetch quote');
      return response.json();
    },
    refetchInterval: priority === 'high' ? 5000 : 30000,
    staleTime: priority === 'high' ? 5000 : 30000,
  });
};

export const useFinnhubNews = (
  symbol: string, 
  priority: 'high' | 'normal' = 'normal'
) => {
  return useQuery({
    queryKey: ['finnhub-news', symbol, priority],
    queryFn: async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/news/${symbol}/finnhub?priority=${priority}`
      );
      if (!response.ok) throw new Error('Failed to fetch news');
      return response.json();
    },
    refetchInterval: priority === 'high' ? 180000 : 300000, // 3-5 minutes
    staleTime: 180000,
  });
};

// Usage:
// const { data: quote, isLoading } = useFinnhubQuote('AAPL', 'high');

// =============================================================================
// 8. BEST PRACTICES SUMMARY
// =============================================================================

/**
 * DO's:
 * ✅ Use priority=high for user-facing, real-time pages (Research, Markets)
 * ✅ Use priority=normal for background updates (Dashboard polling)
 * ✅ Monitor API stats endpoint to display rate limit status
 * ✅ Leverage cache by using longer refresh intervals for normal priority
 * ✅ Show loading states to users when waiting for high-priority data
 * 
 * DON'Ts:
 * ❌ Don't use priority=high for all requests (defeats rate limiting)
 * ❌ Don't poll with <5 second intervals (cache won't help)
 * ❌ Don't make parallel requests for same symbol (cache will deduplicate)
 * ❌ Don't ignore rate limit status (show user-friendly messages)
 */

/**
 * REFRESH INTERVAL RECOMMENDATIONS:
 * 
 * Research Page (high priority):
 * - Quotes: 5 seconds
 * - News: 3 minutes
 * - Profile: On mount only
 * 
 * Markets Page (high priority):
 * - Indices: 10 seconds
 * - Trending: 30 seconds
 * 
 * Dashboard (normal priority):
 * - Watchlist quotes: 30 seconds
 * - News: 5 minutes
 * - Sentiment: On mount only
 */

export default {
  useRealtimeQuote,
  useFinnhubQuote,
  useFinnhubNews,
  fetchCompanyNews,
  fetchMarketNews,
};
