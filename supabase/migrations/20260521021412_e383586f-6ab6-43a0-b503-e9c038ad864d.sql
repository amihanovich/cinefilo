ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_bracket text,
  ADD COLUMN IF NOT EXISTS seed_loved text[] NOT NULL DEFAULT '{}'::text[];