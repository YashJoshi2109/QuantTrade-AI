-- Community Platform V2 columns (Week 1)
-- Run against Neon PostgreSQL

-- Post model additions
ALTER TABLE posts ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS source_platform VARCHAR(20);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS sentiment_confidence FLOAT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS flair VARCHAR(50);

-- Full-text search vector (for Week 6)
-- ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector;
-- CREATE INDEX IF NOT EXISTS ix_posts_search ON posts USING GIN(search_vector);

-- Bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS ix_bookmarks_user ON bookmarks(user_id, created_at DESC);

-- Community bans table
CREATE TABLE IF NOT EXISTS community_bans (
    id           SERIAL PRIMARY KEY,
    community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by    INTEGER NOT NULL REFERENCES users(id),
    reason       TEXT,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(community_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_community_bans_community ON community_bans(community_id);
