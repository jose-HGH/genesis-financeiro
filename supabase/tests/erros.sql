-- Testes do registro de erros do navegador. Rodar com: bash supabase/tests/rodar.sh
\set ON_ERROR_STOP 1
set role anon; reset test.uid;
select public.registrar_erro_navegador('{"mensagem":"TypeError: x is undefined (valor 1.234,56 de ana@x.com, cpf 123.456.789-00)","fonte":"https://site/index.html?v=1#importar","linha":"9500","coluna":"12","versao":"20261112-000000","pagina":"/index.html?token=abc#conta","tipo":"erro"}');
select public.registrar_erro_navegador('{"mensagem":"TypeError: x is undefined (valor 1.234,56 de ana@x.com, cpf 123.456.789-00)","fonte":"https://site/index.html?v=2","linha":"9500"}');
select public.registrar_erro_navegador('{"mensagem":""}');
select public.registrar_erro_navegador('{"mensagem":"outro","linha":"abc","coluna":"zz"}');
do $$ begin perform * from monitor.erros_navegador; raise exception 'FALHA: anon leu monitor'; exception when insufficient_privilege then raise notice 'ok: anon não lê os erros'; end $$;
reset role;
do $$
declare n int; r record;
begin
  select count(*) into n from monitor.erros_navegador; if n <> 2 then raise exception 'FALHA: esperava 2 registros, há %', n; end if;
  select * into r from monitor.erros_navegador where mensagem like 'TypeError%';
  if r.repeticoes <> 2 then raise exception 'FALHA: repetição não somou (%).', r.repeticoes; end if;
  if r.mensagem ~ '@|1\.234|456\.789' then raise exception 'FALHA: dado pessoal na mensagem: %', r.mensagem; end if;
  if r.fonte like '%?%' or r.pagina like '%?%' or r.pagina like '%#%' then raise exception 'FALHA: endereço com parâmetros: % %', r.fonte, r.pagina; end if;
  if r.linha <> 9500 or r.coluna <> 12 then raise exception 'FALHA: linha/coluna'; end if;
  select * into r from monitor.erros_navegador where mensagem = 'outro';
  if r.linha is not null or r.coluna is not null then raise exception 'FALHA: linha/coluna inválidas gravadas'; end if;
  raise notice 'ok: registro de erros limpa dados pessoais e soma repetições';
end $$;
-- limite por conta: 30 por hora
set role authenticated; set test.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin for i in 1..40 loop perform public.registrar_erro_navegador(jsonb_build_object('mensagem', 'erro ' || i)); end loop; end $$;
reset role;
do $$ declare n int; begin
  select count(*) into n from monitor.erros_navegador where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 30 then raise exception 'FALHA: limite por conta deixou % registros', n; end if;
  raise notice 'ok: limite de 30 por conta por hora';
end $$;
