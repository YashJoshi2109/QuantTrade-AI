# Reddit-Style Messaging System - High-Level Design

> Version 1.0 | April 2026
> Direct Messages + Group Conversations for QuantTrade Community

---

## 1. Overview

Reddit-style messaging for QuantTrade: 1:1 DMs, group conversations, in-thread replies, real-time delivery via WebSocket, block/report integration with existing moderation pipeline, markdown-formatted messages with R2-hosted attachments.

---

## 2. Database Schema

```
conversations            conversation_participants       messages
+-----------------+      +------------------------+      +-------------------+
| id (PK)         |--+   | conversation_id (FK,PK)|<--+  | id (PK)           |
| title (nullable)|  +-->| user_id (FK, PK)       |   +--| conversation_id   |
| type (dm|group) |      | role (member|admin)     |      | sender_id (FK)    |
| created_by (FK) |      | last_read_at            |      | parent_id (FK)    |
| last_message_at |      | is_muted                |      | body              |
| last_message_   |      | joined_at               |      | body_html         |
|   preview       |      +------------------------+      | attachments (JSON)|
| is_archived     |                                       | is_removed        |
| created_at      |      user_blocks                      | ai_mod_score      |
+-----------------+      +-----------------+              | created_at        |
                         | blocker_id (PK) |              | updated_at        |
message_reactions        | blocked_id (PK) |              +-------------------+
+-----------------+      | created_at      |
| id (PK)         |      +-----------------+
| message_id (FK) |
| user_id (FK)    |      message_read_receipts
| emoji           |      +------------------+
| created_at      |      | message_id (PK)  |
+-----------------+      | user_id (PK)     |
                         | read_at          |
                         +------------------+
```

Key design decisions:
- `last_message_at` + `last_message_preview` denormalized on conversation for fast inbox queries
- `conversation_participants.last_read_at` = per-user read cursor (unread = messages after cursor)
- `parent_id` on messages enables single-level thread replies
- `user_blocks` is platform-wide, not per-community

---

## 3. Migration SQL

```sql
CREATE TABLE conversations (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(200),
    type            VARCHAR(10) NOT NULL DEFAULT 'dm',
    created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_preview TEXT,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_conversations_last_message ON conversations(last_message_at DESC);

CREATE TABLE conversation_participants (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(10) NOT NULL DEFAULT 'member',
    last_read_at    TIMESTAMPTZ DEFAULT NOW(),
    is_muted        BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX ix_conv_participants_user ON conversation_participants(user_id, last_read_at);

CREATE TABLE messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id       INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    body            TEXT NOT NULL,
    body_html       TEXT,
    attachments     JSONB DEFAULT '[]'::jsonb,
    is_removed      BOOLEAN NOT NULL DEFAULT FALSE,
    ai_mod_score    REAL,
    ai_risk_flags   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX ix_messages_sender ON messages(sender_id);

ALTER TABLE messages ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', COALESCE(body, ''))) STORED;
CREATE INDEX ix_messages_search ON messages USING gin(search_vector);

CREATE TABLE message_read_receipts (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE TABLE message_reactions (
    id          SERIAL PRIMARY KEY,
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(20) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE user_blocks (
    blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX ix_user_blocks_blocked ON user_blocks(blocked_id);
```

---

## 4. API Endpoints

All under `/api/v1/messages/...`, authenticated.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/messages/conversations` | Start DM or group (reuse existing DM if pair exists) |
| `GET` | `/messages/inbox` | List conversations (cursor=last_message_at, includes unread count) |
| `GET` | `/messages/conversations/{id}` | Get conversation metadata |
| `PATCH` | `/messages/conversations/{id}` | Update title / archive / mute |
| `DELETE` | `/messages/conversations/{id}/leave` | Leave group (DMs: archive only) |
| `POST` | `/messages/conversations/{id}/participants` | Add participant (admin only) |
| `DELETE` | `/messages/conversations/{id}/participants/{uid}` | Remove participant |
| `POST` | `/messages/conversations/{id}/messages` | Send message |
| `GET` | `/messages/conversations/{id}/messages` | List messages (cursor-paginated) |
| `PATCH` | `/messages/{id}` | Edit message (sender, 15min window) |
| `DELETE` | `/messages/{id}` | Soft-delete (sender or admin) |
| `POST` | `/messages/conversations/{id}/read` | Mark conversation read |
| `GET` | `/messages/unread-count` | Total unread (Redis-cached) |
| `POST` | `/messages/{id}/reactions` | Add reaction |
| `DELETE` | `/messages/{id}/reactions/{emoji}` | Remove reaction |
| `GET` | `/messages/search?q=` | Full-text search (scoped to user's convos) |
| `POST` | `/messages/block/{uid}` | Block user |
| `DELETE` | `/messages/block/{uid}` | Unblock |
| `POST` | `/messages/{id}/report` | Report (reuses ModerationReport) |

---

## 5. WebSocket Events

New endpoint: `/ws/messages?token={jwt}`

**Server -> Client:**
```jsonc
{ "type": "message.new",     "conversation_id": 42, "message": {...} }
{ "type": "message.typing",  "conversation_id": 42, "user_id": 7 }
{ "type": "message.edited",  "conversation_id": 42, "message_id": 1001 }
{ "type": "message.deleted", "conversation_id": 42, "message_id": 1001 }
{ "type": "message.reaction","conversation_id": 42, "action": "add", "emoji": "bullish" }
{ "type": "message.read",    "conversation_id": 42, "user_id": 7 }
{ "type": "presence.update",  "user_id": 7, "status": "online" }
{ "type": "unread.update",    "count": 3 }
```

**Client -> Server:**
```jsonc
{ "type": "typing", "conversation_id": 42 }
```

**Redis channels:** `qt:ws:msg:user:{uid}` per-user delivery, `qt:presence:{uid}` SET with 60s TTL.

---

## 6. Delivery Flow

```
POST /conversations/{id}/messages
  -> Validate auth + participant + blocks
  -> ModerationService.keyword_filter(body)
  -> INSERT message
  -> UPDATE conversation.last_message_at
  -> For each participant (except sender):
     redis.publish(f"qt:ws:msg:user:{uid}", event)
     redis.delete(f"qt:msg:unread:{uid}")
  -> Return 201
```

---

## 7. Anti-Spam

- Existing 3-stage ModerationService on all messages
- New accounts (< 24h): 5 DM conversations/day max
- Rate limit: 30 messages/min, 10 new convos/hour
- Cannot message users who don't share a community or follow you
- Blocked users cannot create conversations

---

## 8. Frontend Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/community/messages` | MessagesInbox | Conversation list with previews |
| `/community/messages/[id]` | ConversationView | Message thread |
| `/community/messages/new` | NewConversation | Start DM/group |

---

## 9. Implementation Phases

| Phase | Scope | Est. Days |
|-------|-------|-----------|
| 1 | Core backend: models, CRUD, DM only | 3 |
| 2 | Real-time: WebSocket, typing, presence | 2.5 |
| 3 | Frontend UI: inbox, thread, compose | 4.5 |
| 4 | Group convos + thread replies | 2.5 |
| 5 | Reactions, search, report, polish | 2.5 |
| **Total** | | **15 days** |

Phase 1+2 ship together as backend foundation. Phase 3 can start in parallel with Phase 2 using mocked WS data.

---

*Document version 1.0 - April 2026*
