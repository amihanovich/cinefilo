-- La memoria del videoclub, por cuenta. Una fila por usuario con todo lo que
-- Miru sabe de sus gustos (lo mismo que la app guarda en el teléfono como
-- miru:taste + miru:opened + miru:platforms), para que lo siga a cualquier
-- dispositivo. La escribe y la lee SOLO el propio usuario (RLS), desde la app,
-- con su sesión de Google (Supabase Auth).

create table if not exists public.miru_taste (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- TasteStore de apps/mobile/src/lib/taste.ts: requests, rejected, verdicts,
  -- shown, sessions, profile, pending, askedAbout.
  data       jsonb not null default '{}'::jsonb,
  -- OpenedItem[] de apps/mobile/src/lib/opened.ts ("Abiertos recientemente").
  opened     jsonb not null default '[]'::jsonb,
  -- Plataformas elegidas en "¿Dónde busco?" (vacío = todas).
  platforms  text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.miru_taste enable row level security;

drop policy if exists "miru_taste: leer la propia" on public.miru_taste;
create policy "miru_taste: leer la propia" on public.miru_taste
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "miru_taste: crear la propia" on public.miru_taste;
create policy "miru_taste: crear la propia" on public.miru_taste
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "miru_taste: actualizar la propia" on public.miru_taste;
create policy "miru_taste: actualizar la propia" on public.miru_taste
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "miru_taste: borrar la propia" on public.miru_taste;
create policy "miru_taste: borrar la propia" on public.miru_taste
  for delete to authenticated using (auth.uid() = user_id);
