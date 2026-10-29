-- An achievement can carry an optional certificate or photo. The file is stored as one of
-- the student's documents (category "Achievement certificate"), so it also shows in the
-- student's Documents and downloads through the same authorised route.
ALTER TABLE achievements ADD COLUMN document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
CREATE INDEX ix_achievements_document ON achievements (document_id) WHERE document_id IS NOT NULL;
