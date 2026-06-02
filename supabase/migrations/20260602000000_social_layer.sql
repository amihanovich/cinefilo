-- Social layer: user presence + social matches + profile display name

-- 1. Add display_name and avatar_color to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT '#6366f1';

-- 2. user_presence: opt-in location sharing for social mode
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lat          FLOAT       NOT NULL,
  lng          FLOAT       NOT NULL,
  display_name TEXT        NOT NULL,
  avatar_color TEXT        NOT NULL DEFAULT '#6366f1',
  is_visible   BOOLEAN     NOT NULL DEFAULT true,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read presence (needed to discover nearby users)
CREATE POLICY "presence_select_auth"
  ON user_presence FOR SELECT
  TO authenticated
  USING (is_visible = true);

-- Users can only upsert/delete their own row
CREATE POLICY "presence_upsert_own"
  ON user_presence FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "presence_update_own"
  ON user_presence FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "presence_delete_own"
  ON user_presence FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 3. social_matches: record when two nearby users liked the same title
CREATE TABLE IF NOT EXISTS social_matches (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  platform    TEXT        NOT NULL,
  matched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b, title)
);

ALTER TABLE social_matches ENABLE ROW LEVEL SECURITY;

-- Each user can see matches where they are user_a or user_b
CREATE POLICY "matches_select_own"
  ON social_matches FOR SELECT
  TO authenticated
  USING (user_a = auth.uid() OR user_b = auth.uid());

-- Authenticated users can insert (server fn validates no self-match)
CREATE POLICY "matches_insert_auth"
  ON social_matches FOR INSERT
  TO authenticated
  WITH CHECK (user_a = auth.uid() OR user_b = auth.uid());

-- Enable Realtime on social_matches so subscribers receive INSERT events
ALTER PUBLICATION supabase_realtime ADD TABLE social_matches;
