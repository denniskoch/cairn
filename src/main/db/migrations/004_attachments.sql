-- Persist attachment metadata alongside the cached full message so that
-- re-viewing a previously fetched message still shows the V (attachments)
-- list. Only the metadata is cached (id, name, contentType, sizeBytes,
-- isInline) — actual file bytes still fetch on demand via getAttachment.

ALTER TABLE messages ADD COLUMN attachments TEXT;
