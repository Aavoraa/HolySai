-- Files attached to a circular (exam timetables, fee notices, permission slips …).
-- The bytes live in storage under a random key (see documents.service); this table
-- only records them. Attachments can change while the circular is Draft or Under
-- Review and are locked once it is released, like its text.
CREATE TABLE circular_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circular_id     uuid NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  storage_key     text NOT NULL,
  original_name   text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  uploaded_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX ix_circular_attachments_circular ON circular_attachments (circular_id) WHERE deleted_at IS NULL;
