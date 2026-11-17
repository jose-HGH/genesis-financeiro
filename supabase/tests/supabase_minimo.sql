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
-- Regras de acesso de public.transactions como estão no Supabase (criadas antes das migrations).
alter table public.transactions enable row level security;
create policy "select own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "insert own transactions" on public.transactions for insert with check (auth.uid() = user_id);
create policy "update own transactions" on public.transactions for update using (auth.uid() = user_id);
create policy "delete own transactions" on public.transactions for delete using (auth.uid() = user_id);
grant select, insert, update, delete on public.transactions to authenticated;
-- Gatilho interno (existe no Supabase); a migration de segurança tira o acesso pela API.
create function public.membro_saiu() returns trigger language plpgsql security definer as $$ begin return old; end $$;
