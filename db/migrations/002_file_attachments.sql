-- File attachments for the chat. Files are stored on the local filesystem at
-- ./uploads/{user_id}/{deal_id}/{file_id}_{filename}. The DB row tracks
-- metadata + extracted text (for DOCX/TXT/MD/CSV) so we can re-display the
-- attachment in conversation history without re-reading the file.
CREATE TABLE IF NOT EXISTS file_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,        -- relative to project root, e.g. uploads/{user}/{deal}/{file}.pdf
  extracted_text TEXT,               -- populated for DOCX/TXT/MD/CSV; null for PDF/image (sent as native blob)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_attachments_deal ON file_attachments(deal_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_user ON file_attachments(user_id);
