"""
Quick Start Script for QuantTrade AI RAG System
Run this to test the RAG system with a single stock
"""

import os
from rag_engine import RAGEngine, RAGConfig, VectorDB
from data_ingestion import DataIngestionPipeline
import asyncio

def main():
    print("=" * 60)
    print("QuantTrade AI - RAG System Quick Start")
    print("=" * 60)
    
    # Check environment variables
    print("\n1. Checking environment variables...")
    required_keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ALPHA_VANTAGE_API_KEY"]
    missing_keys = [key for key in required_keys if not os.getenv(key)]
    
    if missing_keys:
        print(f"❌ Missing environment variables: {', '.join(missing_keys)}")
        print("Please set them in your .env file")
        return
    
    print("✅ All required API keys found")
    
    # Initialize RAG system
    print("\n2. Initializing RAG system...")
    config = RAGConfig()
    vector_db = VectorDB(config)
    rag_engine = RAGEngine(config)
    print("✅ RAG system initialized")
    
    # Ingest sample data
    print("\n3. Ingesting sample data for AAPL...")
    pipeline = DataIngestionPipeline(
        vector_db=vector_db,
        alpha_vantage_key=os.getenv("ALPHA_VANTAGE_API_KEY")
    )
    
    try:
        pipeline.ingest_stock("AAPL")
        print("✅ Data ingested successfully")
    except Exception as e:
        print(f"⚠️  Ingestion warning: {e}")
        print("Continuing with demo using existing data...")
    
    # Test analysis
    print("\n4. Running sample analyses...")
    
    print("\n--- Fundamental Analysis for AAPL ---")
    try:
        result = rag_engine.analyze(
            symbol="AAPL",
            analysis_type="fundamental",
            stream=False
        )
        print(result[:500] + "...\n")  # Print first 500 chars
        print("✅ Fundamental analysis completed")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    print("\n--- Chat Demo ---")
    try:
        response = rag_engine.chat(
            symbol="AAPL",
            message="What's the current valuation of Apple?",
            conversation_history=[]
        )
        print(response[:500] + "...\n")
        print("✅ Chat completed")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    print("\n" + "=" * 60)
    print("Quick start completed!")
    print("\nNext steps:")
    print("1. Run 'python api_server.py' to start the API server")
    print("2. Visit http://localhost:8000/docs for API documentation")
    print("3. Integrate with your frontend using the API client")
    print("=" * 60)

if __name__ == "__main__":
    main()
