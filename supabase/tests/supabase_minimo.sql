-- Imitação mínima do que o Supabase já tem (roles, auth.users, auth.uid() e
-- as colunas de public.transactions que o copiloto lê). Só para teste local.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.transactions (id text primary key, user_id uuid, tipo text, valor numeric, data_efet text, categoria text, status_parcela text, deleted_at timestamptz);
