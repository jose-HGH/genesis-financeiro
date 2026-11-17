-- Revisão de segurança (17/11/2026).
-- 1. Editar um lançamento: deixa escrito que ele tem de continuar sendo de quem edita.
--    (O Postgres já usava a mesma regra do "using" quando falta o "with check"; aqui fica explícito.)
-- 2. Funções internas (gatilhos e um auxiliar) deixam de poder ser chamadas pela API.
--    Os gatilhos continuam funcionando: a permissão só é conferida quando o gatilho é criado.
-- Algumas tabelas e funções foram criadas antes das migrations; por isso cada passo
-- confere se o objeto existe (o banco descartável dos testes não tem todos).

do $$
begin
  if to_regclass('public.transactions') is not null and exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'transactions' and policyname = 'update own transactions'
  ) then
    execute 'alter policy "update own transactions" on public.transactions with check (auth.uid() = user_id)';
  end if;

  if to_regprocedure('public.escopo_guard()') is not null then
    execute 'revoke execute on function public.escopo_guard() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.escopo_guard_cp()') is not null then
    execute 'revoke execute on function public.escopo_guard_cp() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.membro_saiu()') is not null then
    execute 'revoke execute on function public.membro_saiu() from public, anon, authenticated';
  end if;
  if to_regprocedure('public._eh_membro(uuid)') is not null then
    execute 'revoke execute on function public._eh_membro(uuid) from public, anon, authenticated';
  end if;
end $$;
