-- Registro de erros do navegador (diagnóstico). Nenhuma tabela existente é alterada.
-- O app só consegue CHAMAR public.registrar_erro_navegador; ninguém lê os erros pela API.
-- Sem dados financeiros: só a mensagem técnica do erro (números longos e e-mails mascarados),
-- arquivo/linha, versão do app, página (sem ?parâmetros e sem #), navegador e o id da conta.

create schema if not exists monitor;
revoke all on schema monitor from public;
revoke all on schema monitor from anon, authenticated;

create table if not exists monitor.erros_navegador (
  id          bigint generated always as identity primary key,
  criado_em   timestamptz not null default now(),
  user_id     uuid,
  versao      text,
  tipo        text,
  mensagem    text not null,
  fonte       text,
  linha       int,
  coluna      int,
  pilha       text,
  pagina      text,
  navegador   text,
  repeticoes  int not null default 1,
  assinatura  text not null
);
create index if not exists erros_navegador_criado on monitor.erros_navegador (criado_em desc);
create index if not exists erros_navegador_assinatura on monitor.erros_navegador (assinatura, criado_em desc);

-- Tira o que poderia identificar alguém ou revelar valores: e-mails e sequências longas de dígitos.
create or replace function monitor.limpar(t text, maximo int) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(
    regexp_replace(
      regexp_replace(coalesce(t, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail]', 'g'),
      '\d[\d.,/-]{4,}\d', '#', 'g'),
    maximo), '')
$$;

create or replace function public.registrar_erro_navegador(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg text := monitor.limpar(p->>'mensagem', 500);
  v_fonte text := monitor.limpar(split_part(split_part(p->>'fonte', '?', 1), '#', 1), 200);
  v_linha int;
  v_ass text;
begin
  if v_msg is null then return; end if;
  begin v_linha := nullif(p->>'linha', '')::int; exception when others then v_linha := null; end;

  -- anti-abuso: no máximo 300 registros novos por hora no total e 30 por conta
  if (select count(*) from monitor.erros_navegador where criado_em > now() - interval '1 hour') >= 300 then return; end if;
  if v_uid is not null and (select count(*) from monitor.erros_navegador
      where user_id = v_uid and criado_em > now() - interval '1 hour') >= 30 then return; end if;

  -- o mesmo erro da mesma conta na última hora só soma uma repetição
  v_ass := md5(v_msg || '|' || coalesce(v_fonte, '') || '|' || coalesce(v_linha::text, ''));
  update monitor.erros_navegador set repeticoes = repeticoes + 1
   where id = (select id from monitor.erros_navegador
                where assinatura = v_ass and user_id is not distinct from v_uid and criado_em > now() - interval '1 hour'
                order by id desc limit 1);
  if found then return; end if;

  insert into monitor.erros_navegador (user_id, versao, tipo, mensagem, fonte, linha, coluna, pilha, pagina, navegador, assinatura)
  values (v_uid,
          monitor.limpar(p->>'versao', 40),
          monitor.limpar(p->>'tipo', 40),
          v_msg, v_fonte, v_linha,
          case when (p->>'coluna') ~ '^\d{1,7}$' then (p->>'coluna')::int end,
          monitor.limpar(p->>'pilha', 2000),
          monitor.limpar(split_part(split_part(p->>'pagina', '?', 1), '#', 1), 200),
          monitor.limpar(p->>'navegador', 300),
          v_ass);

  -- guarda só 90 dias
  if random() < 0.02 then delete from monitor.erros_navegador where criado_em < now() - interval '90 days'; end if;
end $$;

revoke all on function public.registrar_erro_navegador(jsonb) from public;
grant execute on function public.registrar_erro_navegador(jsonb) to anon, authenticated;
revoke all on function monitor.limpar(text, int) from public;
