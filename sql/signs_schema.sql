-- ============================================================
--  MitaCatalogue — Sign Wall (Guestbook) schema
--  Run this ONCE in the Supabase SQL editor when setting up the
--  project. The site itself never executes this — it lives here so
--  the schema is version-controlled and reproducible.
-- ============================================================

create table if not exists signs (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) <= 60),
  grid_x integer not null,
  grid_y integer not null,
  color text default 'oak',        -- reserved for future variants, unused in MVP
  created_at timestamptz default now(),
  approved boolean default true,
  ip_hash text                     -- hashed, never store raw IP (Edge Function fast-follow only)
);

alter table signs enable row level security;

-- Anyone can read approved signs. RLS filters the rest server-side so a
-- misbehaving client can't read unapproved rows even via direct API calls.
drop policy if exists "public read approved signs" on signs;
create policy "public read approved signs"
  on signs for select
  using (approved = true);

-- Anyone can insert a sign. No update/delete policies are created, so update
-- and delete are locked down by default (RLS denies anything without a policy).
-- The CHECK constraint on `text` is the real server-side enforcement of the
-- 60-char limit for MVP — the client-side guard is bypassable on purpose.
drop policy if exists "public insert signs" on signs;
create policy "public insert signs"
  on signs for insert
  with check (char_length(text) <= 60);

-- Optional hard-fail guard against double-booking a cell. MVP JavaScript checks
-- occupancy client-side before opening the modal, but two browsers racing the
-- same empty cell can still both insert. Uncomment this UNIQUE index if you
-- want the DB to reject the loser of that race (the loser's optimistic sign is
-- then rolled back client-side). Left commented out by default so the MVP
-- degrades gracefully to "last writer wins" instead of throwing.
-- create unique index if not exists signs_cell_uniq on signs (grid_x, grid_y);