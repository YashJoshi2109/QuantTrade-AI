"""
Background tasks for generating embeddings
"""
from app.tasks.celery_app import celery_app
from app.services.embedding_service import EmbeddingService
from app.models.filing import FilingChunk
from app.db.database import SessionLocal
from sqlalchemy.orm import Session

embedding_service = EmbeddingService()


@celery_app.task(name="generate_embeddings")
def generate_embeddings_task(texts: list[str]):
    """Generate embeddings for a list of texts"""
    embeddings = embedding_service.embed_batch(texts)
    return {
        "embeddings": embeddings,
        "count": len(texts)
    }


@celery_app.task(name="process_filing_chunks")
def process_filing_chunks_task(filing_id: int):
    """Generate embeddings for all chunks of a filing"""
    db = SessionLocal()
    try:
        chunks = db.query(FilingChunk).filter(
            FilingChunk.filing_id == filing_id,
            FilingChunk.embedding.is_(None)
        ).all()
        
        if not chunks:
            return {"filing_id": filing_id, "chunks_processed": 0}
        
        texts = [chunk.content for chunk in chunks]
        embeddings = embedding_service.embed_batch(texts)
        
        import json
        for chunk, embedding in zip(chunks, embeddings):
            chunk.embedding = json.dumps(embedding)
        
        db.commit()
        
        return {
            "filing_id": filing_id,
            "chunks_processed": len(chunks)
        }
    finally:
        db.close()
