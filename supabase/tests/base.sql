-- Testes da base do copiloto. Rodar com: bash supabase/tests/rodar.sh
\set ON_ERROR_STOP 1
insert into auth.users (id,email,created_at) values
 ('11111111-1111-1111-1111-111111111111','ana@x.com', now()-interval '90 days'),
 ('22222222-2222-2222-2222-222222222222','novo@x.com', now()),
 ('33333333-3333-3333-3333-333333333333','fora@x.com', now()-interval '90 days');
select copiloto.convidar('ANA@x.com'); select copiloto.convidar('novo@x.com'); select copiloto.convidar('ninguem@x.com');
-- sem aceite
select 'sem aceite' t, * from copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',0.001);
-- aceite via RLS como authenticated
set role authenticated; set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.aceites_termos (documento, versao) values ('termos','2026-11-10'),('privacidade','2026-11-10'),('ia','2026-11-10');
select public.copiloto_meu_status();
-- tentar inserir aceite em nome de outro
do $$ begin insert into public.aceites_termos (user_id, documento, versao) values ('22222222-2222-2222-2222-222222222222','termos','x'); raise notice 'FALHA: inseriu por outro'; exception when others then raise notice 'ok bloqueou insert alheio: %', sqlerrm; end $$;
do $$ begin perform * from copiloto.pedidos; raise notice 'FALHA leu copiloto'; exception when others then raise notice 'ok sem acesso ao schema copiloto: %', sqlerrm; end $$;
reset role;
select 'fora' t, * from copiloto.reservar('33333333-3333-3333-3333-333333333333','teste','m','v1',0.001);
select 'ok1' t, (r).motivo is null as passou from (select copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',0.001) r) x;
select 'concorrente' t, * from copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',0.001);
select copiloto.acertar(id,'ok',0.0004,100,50,0,0) from copiloto.pedidos where status='reservado';
-- cota: 4 BRL / 5.5 = 0.727 USD
select 'cota' t, * from copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',0.8);
-- disjuntor: 1 USD/dia
update copiloto.testadores set cota_mensal_brl = 100 where email='ana@x.com';
select 'disjuntor' t, * from copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',1.2);
-- conta nova: metade
set role authenticated; set test.uid = '22222222-2222-2222-2222-222222222222'; select public.copiloto_meu_status(); reset role;
-- limite por dia (teste_dia 20) e por minuto (10)
do $$ declare i int; r record; begin
  for i in 1..12 loop
    select * into r from copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',0.0001);
    if r.pedido_id is not null then perform copiloto.acertar(r.pedido_id,'ok',0.0001,1,1,0,0); else raise notice 'iteração % bloqueada: %', i, r.motivo; end if;
  end loop; end $$;
update copiloto.config set valor='false' where chave='ia_ligada';
select 'desligada' t, * from copiloto.reservar('11111111-1111-1111-1111-111111111111','teste','m','v1',0.0001);
-- totais
insert into public.transactions values
 ('a','11111111-1111-1111-1111-111111111111','despesa',100,to_char(current_date,'YYYY-MM-DD'),'Mercado',null,null),
 ('b','11111111-1111-1111-1111-111111111111','estorno',20,to_char(current_date,'YYYY-MM-DD'),'Mercado',null,null),
 ('c','11111111-1111-1111-1111-111111111111','despesa',50,to_char(current_date,'YYYY-MM-DD'),'Lazer',null,now()),
 ('d','11111111-1111-1111-1111-111111111111','receita',900,to_char(current_date,'YYYY-MM-DD'),'Salário',null,null),
 ('e','22222222-2222-2222-2222-222222222222','despesa',70,to_char(current_date,'YYYY-MM-DD'),'Mercado',null,null);
select * from copiloto.totais_por_categoria('11111111-1111-1111-1111-111111111111', current_date);
select status, motivo, count(*) from copiloto.pedidos group by 1,2 order by 1,2;
set role anon; select public.termos_versoes(); reset role;
