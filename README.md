# Time Tracker App

Personal time and task tracker built with Next.js, Ant Design, Tailwind CSS, and Supabase. Track tasks with a live stopwatch, pause/resume, edit history, and export to Excel.

## Features
- Username/password auth (Supabase Auth) with simple username handling.
- Projects and tasks with running, paused, finished, and canceled states.
- Live stopwatch with pause/resume and automatic session recovery.
- History table with pagination, edit, delete, and Excel export.
- App Router, TypeScript, Ant Design UI, Tailwind utilities.

## Tech Stack
- Next.js 16 (App Router), React 19, TypeScript
- Ant Design 5 and @ant-design/icons
- Tailwind CSS v4
- Supabase (Auth + Postgres)
- XLSX for exports

## Prerequisites
- Node.js 20.11.1 (see `.nvmrc`)
- A Supabase project

## Quick Start (use this repo)
1. Install dependencies:
```bash
npm install
```
2. Create `.env.local` at the repo root:
```bash
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```
3. Run the dev server:
```bash
npm run dev
```
4. Open `http://localhost:3000`.

## Supabase Setup (step-by-step)
1. Create a new Supabase project.
2. Auth settings:
   - Disable email confirmation (Auth -> Providers -> Email -> Confirm email OFF).
3. Copy keys from Project Settings -> API:
   - Project URL -> `NEXT_PUBLIC_SUPABASE_URL`
   - anon public key -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key -> `SUPABASE_SERVICE_ROLE_KEY` (server-only)
4. Create the database tables and policies using the SQL below (SQL Editor).

## Database Schema (SQL)
Run this in the Supabase SQL Editor:
```sql
create extension if not exists "pgcrypto";

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists user_profiles_username_lower_key
  on public.user_profiles (lower(username));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx
  on public.projects (user_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  notes text,
  status text not null check (status in ('running','paused','finished','canceled')),
  started_at timestamptz not null,
  ended_at timestamptz,
  accumulated_ms bigint not null default 0,
  duration_ms bigint not null default 0,
  pause_count integer not null default 0,
  paused_ms bigint not null default 0,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_project_id_idx
  on public.tasks (project_id);

create index if not exists tasks_user_id_idx
  on public.tasks (user_id);

create index if not exists tasks_ended_at_idx
  on public.tasks (ended_at);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;

create policy "User profiles are viewable by owner"
on public.user_profiles
for select
using (auth.uid() = id);

create policy "Users can insert own profile"
on public.user_profiles
for insert
with check (auth.uid() = id);

create policy "Users can update own profile"
on public.user_profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Projects are viewable by owner"
on public.projects
for select
using (auth.uid() = user_id);

create policy "Users can insert own projects"
on public.projects
for insert
with check (auth.uid() = user_id);

create policy "Users can update own projects"
on public.projects
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own projects"
on public.projects
for delete
using (auth.uid() = user_id);

create policy "Tasks are viewable by owner"
on public.tasks
for select
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

create policy "Users can insert own tasks"
on public.tasks
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

create policy "Users can update own tasks"
on public.tasks
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own tasks"
on public.tasks
for delete
using (auth.uid() = user_id);
```

## Project Setup From Scratch (Next.js + Ant Design + Tailwind + Supabase)
1. Create the Next.js app:
```bash
npx create-next-app@latest time-tracker-app --ts --eslint --app
cd time-tracker-app
```
2. Install core dependencies:
```bash
npm install antd @ant-design/icons @supabase/supabase-js xlsx
```
3. Install Tailwind v4 tooling:
```bash
npm install -D tailwindcss @tailwindcss/postcss
```
4. Add `postcss.config.mjs`:
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```
5. Add Tailwind to `app/globals.css`:
```css
@import "tailwindcss";
```
6. Import Ant Design reset CSS in `app/layout.tsx`:
```ts
import "antd/dist/reset.css";
```
7. Add Supabase clients:
```ts
// app/lib/supabaseBrowser.ts
import { createClient } from "@supabase/supabase-js";

export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```
```ts
// app/lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
```
8. Create `.env.local` with Supabase keys and restart the dev server.
9. Run the SQL schema in Supabase (see Database Schema section).

## Scripts
- `npm run dev` - Start the dev server
- `npm run build` - Build for production
- `npm run start` - Run production build
- `npm run lint` - Run ESLint

## Contributing
- Fork the repo and create a feature branch.
- Keep PRs focused and add context in the description.
- If you add features, update this README or include migration SQL.

## License
This project is intended to be open source. Add a `LICENSE` file before publishing publicly.
