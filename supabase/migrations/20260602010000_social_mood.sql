-- Add mood/context columns to user_presence for mood-based matching
ALTER TABLE user_presence
  ADD COLUMN IF NOT EXISTS mood_filter TEXT,
  ADD COLUMN IF NOT EXISTS company_filter TEXT,
  ADD COLUMN IF NOT EXISTS attention_filter TEXT,
  ADD COLUMN IF NOT EXISTS type_filter TEXT;
