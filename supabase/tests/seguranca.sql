-- Revisão de segurança (migration 20261117000000). Rodar com: bash supabase/tests/rodar.sh
\set ON_ERROR_STOP 1
insert into public.transactions (id, user_id, tipo, valor) values ('seg-1', '11111111-1111-1111-1111-111111111111', 'despesa', 10);
set role authenticated; set test.uid = '11111111-1111-1111-1111-111111111111';
update public.transactions set valor = 20 where id = 'seg-1';
do $$ begin
  update public.transactions set user_id = '22222222-2222-2222-2222-222222222222' where id = 'seg-1';
  raise exception 'FALHA: deu para passar o lançamento para outra conta';
exception when insufficient_privilege then raise notice 'ok: editar não troca o dono do lançamento';
end $$;
set test.uid = '22222222-2222-2222-2222-222222222222';
do $$ declare n int; begin
  update public.transactions set valor = 99 where id = 'seg-1'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: outra conta editou o lançamento'; end if;
  raise notice 'ok: outra conta não edita';
end $$;
do $$ begin
  if has_function_privilege('authenticated', 'public.membro_saiu()', 'execute') or has_function_privilege('anon', 'public.membro_saiu()', 'execute') then
    raise exception 'FALHA: função interna aberta para a API';
  end if;
  raise notice 'ok: função interna fechada para a API';
end $$;
reset role; reset test.uid;
do $$ begin
  if (select valor from public.transactions where id = 'seg-1') <> 20 then raise exception 'FALHA: valor'; end if;
end $$;
