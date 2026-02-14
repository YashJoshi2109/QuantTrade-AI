"""
RAG (Retrieval-Augmented Generation) service using Claude (Anthropic)
"""
from typing import List, Dict, Optional
from app.config import settings
from app.services.embedding_service import EmbeddingService
from app.models.filing import FilingChunk
from app.models.news import NewsArticle
from sqlalchemy.orm import Session
from sqlalchemy import text
import json
import numpy as np

# Import Anthropic
ANTHROPIC_AVAILABLE = False
try:
    from langchain_anthropic import ChatAnthropic
    from langchain.prompts import ChatPromptTemplate
    ANTHROPIC_AVAILABLE = True
    print("✅ LangChain Anthropic available")
except ImportError:
    print("⚠️ LangChain Anthropic not available - install with: pip install langchain-anthropic")


class RAGService:
    """RAG service for document retrieval and generation using Claude"""
    
    def __init__(self):
        self.embedding_service = EmbeddingService()
        self._llm = None
        self._llm_initialized = False
    
    @property
    def llm(self):
        """Lazy-initialize Claude LLM"""
        if not self._llm_initialized:
            self._llm_initialized = True
            
            if settings.ANTHROPIC_API_KEY and ANTHROPIC_AVAILABLE:
                try:
                    print(f"🤖 Initializing Claude (key: {settings.ANTHROPIC_API_KEY[:20]}...)")
                    self._llm = ChatAnthropic(
                        model="claude-3-haiku-20240307",
                        temperature=0.7,
                        anthropic_api_key=settings.ANTHROPIC_API_KEY,
                        max_tokens=1024
                    )
                    print("✅ Claude initialized successfully!")
                except Exception as e:
                    print(f"❌ Claude init failed: {e}")
                    self._llm = None
            else:
                if not settings.ANTHROPIC_API_KEY:
                    print("⚠️ ANTHROPIC_API_KEY not set in .env")
                if not ANTHROPIC_AVAILABLE:
                    print("⚠️ langchain-anthropic not installed")
                    
        return self._llm
    
    def retrieve_filing_chunks(
        self,
        db: Session,
        query: str,
        symbol_id: Optional[int] = None,
        top_k: int = 5
    ) -> List[Dict]:
        """Retrieve relevant filing chunks using vector similarity"""
        query_embedding = self.embedding_service.embed_text(query)
        
        # For now, use simple text search until pgvector is properly set up
        if symbol_id:
            chunks = db.query(FilingChunk).join(
                FilingChunk.filing
            ).filter(
                FilingChunk.filing.has(symbol_id=symbol_id)
            ).limit(top_k * 3).all()
        else:
            chunks = db.query(FilingChunk).limit(top_k * 3).all()
        
        # Calculate similarity scores
        results = []
        for chunk in chunks:
            if chunk.embedding:
                chunk_emb = json.loads(chunk.embedding)
                similarity = self.embedding_service.similarity(query_embedding, chunk_emb)
                results.append({
                    "id": chunk.id,
                    "content": chunk.content,
                    "section": chunk.section,
                    "filing_id": chunk.filing_id,
                    "form_type": chunk.filing.form_type,
                    "filing_date": chunk.filing.filing_date.isoformat(),
                    "symbol": chunk.filing.symbol.symbol,
                    "similarity": similarity,
                    "metadata": {
                        "source": f"{chunk.filing.symbol.symbol} {chunk.filing.form_type}",
                        "section": chunk.section,
                        "filing_date": chunk.filing.filing_date.isoformat()
                    }
                })
        
        # Sort by similarity and return top_k
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]
    
    def retrieve_news(
        self,
        db: Session,
        query: str,
        symbol_id: Optional[int] = None,
        top_k: int = 10
    ) -> List[Dict]:
        """Retrieve relevant news articles"""
        query_lower = query.lower()
        
        query_obj = db.query(NewsArticle)
        if symbol_id:
            query_obj = query_obj.filter(NewsArticle.symbol_id == symbol_id)
        
        # First, try keyword matching
        keywords = [word for word in query.split() if len(word) > 3]
        keyword_articles = []
        
        if keywords:
            for keyword in keywords[:3]:
                keyword_results = query_obj.filter(
                    (NewsArticle.title.ilike(f"%{keyword}%")) |
                    (NewsArticle.content.ilike(f"%{keyword}%"))
                ).limit(top_k).all()
                keyword_articles.extend(keyword_results)
        
        # If no keyword matches, get recent news for the symbol
        if not keyword_articles and symbol_id:
            keyword_articles = db.query(NewsArticle).filter(
                NewsArticle.symbol_id == symbol_id
            ).order_by(NewsArticle.published_at.desc()).limit(top_k).all()
        
        # If still nothing and we were querying for a specific symbol, avoid
        # falling back to generic world news (which can be off-topic for the
        # user's stock question). In that case, just return no news so the LLM
        # can explicitly say that symbol-specific headlines are unavailable.
        if not keyword_articles:
            if symbol_id is None:
                # Only for symbol-agnostic questions, fall back to general news
                keyword_articles = db.query(NewsArticle).order_by(
                    NewsArticle.published_at.desc()
                ).limit(top_k).all()
            else:
                keyword_articles = []
        
        # Deduplicate by id
        seen_ids = set()
        articles = []
        for article in keyword_articles:
            if article.id not in seen_ids:
                seen_ids.add(article.id)
                articles.append(article)
                if len(articles) >= top_k:
                    break
        
        return [
            {
                "id": article.id,
                "title": article.title,
                "content": article.content[:800] if article.content else "",
                "source": article.source,
                "url": article.url,
                "published_at": article.published_at.isoformat() if article.published_at else None,
                "sentiment": article.sentiment,
                "metadata": {
                    "source": article.source,
                    "sentiment": article.sentiment,
                    "url": article.url
                }
            }
            for article in articles
        ]
    
    def generate_response(
        self,
        query: str,
        context_docs: List[Dict],
        symbol: Optional[str] = None
    ) -> Dict:
        """Generate response using Claude with RAG context"""
        
        # Build context from documents
        context_parts = []
        news_items = []
        filing_items = []
        
        for doc in context_docs:
            if "sentiment" in doc.get("metadata", {}) or "sentiment" in doc:
                # News article
                sentiment = doc.get("sentiment") or doc.get("metadata", {}).get("sentiment", "Neutral")
                news_items.append({
                    "title": doc.get("title", ""),
                    "content": doc.get("content", "")[:400],
                    "source": doc.get("source", "Unknown"),
                    "sentiment": sentiment,
                    "published_at": doc.get("published_at", "")
                })
            elif "form_type" in doc:
                # Filing
                filing_items.append({
                    "form_type": doc.get("form_type", ""),
                    "section": doc.get("section", ""),
                    "content": doc.get("content", "")[:500],
                    "filing_date": doc.get("filing_date", "")
                })
        
        # Format context for Claude
        context_text = ""
        if news_items:
            context_text += "=== RECENT NEWS ===\n"
            for i, news in enumerate(news_items[:5], 1):
                context_text += f"\n[{i}] {news['title']}\n"
                context_text += f"Source: {news['source']} | Sentiment: {news['sentiment']}\n"
                context_text += f"Content: {news['content']}\n"
        
        if filing_items:
            context_text += "\n=== SEC FILINGS ===\n"
            for i, filing in enumerate(filing_items[:3], 1):
                context_text += f"\n[{i}] {filing['form_type']} - {filing['section']}\n"
                context_text += f"Content: {filing['content']}\n"
        
        # If we have Claude available, use it
        if self.llm:
            try:
                symbol_context = f" for {symbol}" if symbol else ""
                
                prompt = f"""You are an expert AI trading and financial research assistant. 
You have access to real-time market news and SEC filings.
Provide helpful, accurate, and actionable insights.

Current analysis context{symbol_context}:

{context_text if context_text else "No specific documents loaded, but I can still help with general questions."}

User Question: {query}

Instructions:
- If news is available, summarize the key insights and sentiment
- Provide specific, actionable analysis
- Be concise but comprehensive
- Use bullet points for clarity
- If discussing sentiment, explain why
- Always relate your answer to the user's specific question

Your response:"""

                response = self.llm.invoke(prompt)
                response_text = response.content if hasattr(response, 'content') else str(response)
                
                sources = list(set([doc.get("source", "Unknown") for doc in context_docs[:5]]))
                
                return {
                    "response": response_text,
                    "sources": sources,
                    "context_docs": len(context_docs),
                    "llm_used": "claude"
                }
                
            except Exception as e:
                print(f"❌ Claude error: {e}")
                # Fall through to fallback
        
        # Fallback: Generate intelligent response without LLM
        return {
            "response": self._generate_smart_response(query, context_docs, symbol),
            "sources": list(set([doc.get("source", "Unknown") for doc in context_docs[:5]])),
            "context_docs": len(context_docs),
            "llm_used": "fallback"
        }
    
    def _generate_smart_response(
        self, 
        query: str, 
        context_docs: List[Dict], 
        symbol: Optional[str] = None
    ) -> str:
        """Generate intelligent response based on context without LLM"""
        
        query_lower = query.lower()
        symbol_text = symbol if symbol else "the market"
        
        if not context_docs:
            return self._get_no_data_response(query, symbol)
        
        # Categorize documents
        news = [d for d in context_docs if "sentiment" in d.get("metadata", {}) or "sentiment" in d]
        filings = [d for d in context_docs if "form_type" in d]
        
        # Analyze query intent
        is_sentiment_query = any(w in query_lower for w in ['sentiment', 'feel', 'bullish', 'bearish', 'outlook', 'think'])
        is_news_query = any(w in query_lower for w in ['news', 'latest', 'recent', 'happening', 'update'])
        is_price_query = any(w in query_lower for w in ['price', 'stock', 'buy', 'sell', 'worth', 'value'])
        is_earnings_query = any(w in query_lower for w in ['earnings', 'revenue', 'profit', 'financial', 'quarter'])
        
        response_parts = []
        
        # Build response based on query type
        if news:
            sentiments = {"Bullish": 0, "Bearish": 0, "Neutral": 0}
            for doc in news:
                sent = doc.get("sentiment") or doc.get("metadata", {}).get("sentiment", "Neutral")
                sentiments[sent] = sentiments.get(sent, 0) + 1
            
            total = sum(sentiments.values())
            bullish_pct = (sentiments["Bullish"] / total * 100) if total > 0 else 0
            bearish_pct = (sentiments["Bearish"] / total * 100) if total > 0 else 0
            
            # Determine overall sentiment
            if bullish_pct > 60:
                overall = "bullish"
                emoji = "📈"
            elif bearish_pct > 60:
                overall = "bearish"
                emoji = "📉"
            else:
                overall = "mixed/neutral"
                emoji = "📊"
            
            if is_sentiment_query or is_news_query:
                response_parts.append(f"{emoji} **{symbol_text} Market Sentiment Analysis**\n")
                response_parts.append(f"Based on {total} recent news articles:\n")
                response_parts.append(f"• Overall sentiment: **{overall.upper()}**")
                response_parts.append(f"• 🟢 Bullish: {sentiments['Bullish']} ({bullish_pct:.0f}%)")
                response_parts.append(f"• 🔴 Bearish: {sentiments['Bearish']} ({bearish_pct:.0f}%)")
                response_parts.append(f"• ⚪ Neutral: {sentiments['Neutral']}\n")
            
            # Add key headlines
            response_parts.append("**📰 Key Headlines:**")
            for doc in news[:5]:
                title = doc.get("title", "Untitled")
                sent = doc.get("sentiment") or doc.get("metadata", {}).get("sentiment", "Neutral")
                source = doc.get("source", "Unknown")
                icon = "🟢" if sent == "Bullish" else "🔴" if sent == "Bearish" else "⚪"
                response_parts.append(f"{icon} {title}")
                response_parts.append(f"   ↳ *{source}*")
        
        if filings and (is_earnings_query or not news):
            response_parts.append(f"\n**📄 SEC Filings:**")
            for doc in filings[:3]:
                form = doc.get("form_type", "Filing")
                section = doc.get("section", "")
                response_parts.append(f"• {form}: {section}")
        
        if not response_parts:
            return self._get_no_data_response(query, symbol)
        
        return "\n".join(response_parts)
    
    def _get_no_data_response(self, query: str, symbol: Optional[str] = None) -> str:
        """Response when no data is available"""
        symbol_text = f" for {symbol}" if symbol else ""
        
        return f"""I don't have specific data loaded{symbol_text} yet.

I'm your AI Trading Copilot - ask me about:
• Market sentiment and news analysis
• Stock price movements
• Technical indicators
• Risk analysis

What would you like to know?"""
    
    def query(
        self,
        db: Session,
        query: str,
        symbol: Optional[str] = None,
        symbol_id: Optional[int] = None,
        include_news: bool = True,
        include_filings: bool = True,
        top_k: int = 10
    ) -> Dict:
        """Complete RAG query: retrieve + generate"""
        all_docs = []
        
        if include_filings and symbol_id:
            filing_docs = self.retrieve_filing_chunks(db, query, symbol_id, top_k)
            all_docs.extend(filing_docs)
        
        if include_news:
            news_docs = self.retrieve_news(db, query, symbol_id, top_k)
            all_docs.extend(news_docs)
        
        # Generate response using Claude
        result = self.generate_response(query, all_docs, symbol)
        
        return result
