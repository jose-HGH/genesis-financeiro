-- =====================================================================
-- Base do Gênesis (passo 1, sem IA visível)
--
-- 1. public.aceites_termos: registro de quem aceitou qual versão dos
--    Termos de Uso, da Política de Privacidade e do uso de IA.
-- 2. schema copiloto: configuração, planos, admins, testadores, registro
--    de pedidos (cota e disjuntor), respostas guardadas e as funções que
--    a Edge Function "copiloto" usa.
--
-- Nenhuma tabela existente é alterada. O schema copiloto NÃO é exposto na
-- API (PostgREST): só a Edge Function o acessa, pela conexão direta do
-- servidor. O app só enxerga public.aceites_termos e a função
-- public.copiloto_meu_status().
--
-- Valores iniciais (cota, teto, limites) são conservadores e ficam em
-- tabelas, para ajustar sem publicar nada. Ver supabase/README.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Aceite de termos (vale para o app inteiro, com ou sem IA)
-- ---------------------------------------------------------------------
create table if not exists public.aceites_termos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  documento   text not null check (documento in ('termos', 'privacidade', 'ia')),
  versao      text not null check (length(versao) between 1 and 40),
  aceito_em   timestamptz not null default now(),
  unique (user_id, documento, versao)
);

comment on table public.aceites_termos is
  'Cada linha = uma pessoa aceitou uma versão de um documento. Só inserção; nunca editar ou apagar.';

alter table public.aceites_termos enable row level security;

drop policy if exists "aceites: ver os meus" on public.aceites_termos;
create policy "aceites: ver os meus" on public.aceites_termos
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "aceites: registrar os meus" on public.aceites_termos;
create policy "aceites: registrar os meus" on public.aceites_termos
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.aceites_termos from anon;
grant select, insert on public.aceites_termos to authenticated;

-- ---------------------------------------------------------------------
-- 2. Schema do copiloto
-- ---------------------------------------------------------------------
create schema if not exists copiloto;
revoke all on schema copiloto from public, anon, authenticated;

-- Configuração geral, chave → valor (jsonb). Mudar aqui vale no próximo pedido.
create table if not exists copiloto.config (
  chave      text primary key,
  valor      jsonb not null,
  descricao  text,
  mudado_em  timestamptz not null default now()
);

insert into copiloto.config (chave, valor, descricao) values
  ('ia_ligada',            'true',          'Chave geral. false desliga a IA para todos na hora.'),
  ('cambio_brl_por_usd',   '5.5',           'Câmbio usado para converter o custo (gravado em US$) para a cota em R$.'),
  ('disjuntor_diario_usd', '1.0',           'Se o gasto total do dia (todas as pessoas) passar disso, a IA pausa até o dia seguinte.'),
  ('fuso',                 '"America/Boa_Vista"', 'Fuso usado para virar o dia e o mês da cota.'),
  ('pedidos_por_minuto',   '10',            'Limite de pedidos por pessoa por minuto.'),
  ('max_tokens_resumo',    '8000',          'Resumo maior que isso (estimado) é recusado.'),
  ('diferenca_max_brl',    '1.0',           'Diferença máxima entre o total por categoria do resumo e o do banco.'),
  ('versao_termos',        '"2026-11-10"',  'Versão dos Termos de Uso exigida.'),
  ('versao_privacidade',   '"2026-11-10"',  'Versão da Política de Privacidade exigida.'),
  ('versao_ia',            '"2026-11-10"',  'Versão do consentimento específico para o uso de IA.'),
  ('conta_nova_dias',      '30',            'Conta criada há menos que isso recebe metade da cota.')
on conflict (chave) do nothing;

-- Planos. Na fase de testes só existe o plano "teste".
-- limites: chaves <recurso>_dia / <recurso>_mes = quantidade máxima de pedidos NOVOS
-- (respostas guardadas não contam). Recurso sem chave = sem limite próprio, só a cota.
create table if not exists copiloto.planos (
  codigo           text primary key,
  nome             text not null,
  cota_mensal_brl  numeric(10,2) not null check (cota_mensal_brl >= 0),
  limites          jsonb not null default '{}'::jsonb,
  ativo            boolean not null default true
);

insert into copiloto.planos (codigo, nome, cota_mensal_brl, limites) values
  ('teste', 'Testador', 4.00,
   '{"teste_dia": 20, "explicar_dia": 20, "resumo_mensal_mes": 3, "simulador_mes": 30, "chat_mes": 100, "analise_mes": 5}'::jsonb)
on conflict (codigo) do nothing;

-- Quem administra (vê painel e convida testadores no futuro).
create table if not exists copiloto.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  criado_em  timestamptz not null default now()
);

-- Lista de testadores: a trava de verdade do copiloto. Só status 'ativo' passa.
create table if not exists copiloto.testadores (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  status           text not null default 'ativo' check (status in ('ativo', 'pausado', 'removido')),
  plano            text not null default 'teste' references copiloto.planos(codigo),
  cota_mensal_brl  numeric(10,2) check (cota_mensal_brl is null or cota_mensal_brl >= 0),
  convidado_em     timestamptz not null default now(),
  observacao       text
);

-- Registro de cada pedido. Sem dados pessoais: nada do resumo, da pergunta ou da resposta.
create table if not exists copiloto.pedidos (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  recurso               text not null,
  modelo                text,
  versao_prompt         text,
  status                text not null check (status in ('reservado', 'ok', 'cache', 'erro', 'recusado', 'bloqueado')),
  motivo                text,
  custo_reservado_usd   numeric(12,6) not null default 0,
  custo_usd             numeric(12,6),
  tokens_entrada        integer,
  tokens_saida          integer,
  tokens_cache_leitura  integer,
  tokens_cache_escrita  integer,
  criado_em             timestamptz not null default now(),
  concluido_em          timestamptz
);
create index if not exists pedidos_user_criado on copiloto.pedidos (user_id, criado_em desc);
create index if not exists pedidos_criado on copiloto.pedidos (criado_em desc);

-- Respostas guardadas pela impressão digital do pedido (inclui o user_id,
-- então uma pessoa nunca recebe a resposta de outra).
create table if not exists copiloto.respostas (
  impressao      text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  recurso        text not null,
  modelo         text not null,
  versao_prompt  text not null,
  texto          text not null,
  criado_em      timestamptz not null default now(),
  usos           integer not null default 0
);
create index if not exists respostas_user on copiloto.respostas (user_id);

-- RLS ligado e sem políticas: ninguém além do servidor lê ou escreve.
alter table copiloto.config     enable row level security;
alter table copiloto.planos     enable row level security;
alter table copiloto.admins     enable row level security;
alter table copiloto.testadores enable row level security;
alter table copiloto.pedidos    enable row level security;
alter table copiloto.respostas  enable row level security;
revoke all on all tables in schema copiloto from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções internas (só o servidor chama)
-- ---------------------------------------------------------------------
create or replace function copiloto.cfg(p_chave text)
returns jsonb language sql stable
set search_path = copiloto, pg_temp
as $$ select valor from copiloto.config where chave = p_chave $$;

-- Início do dia e do mês no fuso configurado.
create or replace function copiloto.inicio_dia() returns timestamptz
language sql stable set search_path = copiloto, pg_temp as $$
  select (date_trunc('day', now() at time zone (copiloto.cfg('fuso') #>> '{}')))
         at time zone (copiloto.cfg('fuso') #>> '{}')
$$;
create or replace function copiloto.inicio_mes() returns timestamptz
language sql stable set search_path = copiloto, pg_temp as $$
  select (date_trunc('month', now() at time zone (copiloto.cfg('fuso') #>> '{}')))
         at time zone (copiloto.cfg('fuso') #>> '{}')
$$;

-- Gasto em US$ de uma pessoa (ou de todos, se p_user for null) desde p_desde.
-- Conta o custo real quando já existe; senão, a reserva (pedido em andamento
-- ou que caiu no meio). Assim o erro é sempre para o lado seguro.
create or replace function copiloto.gasto_usd(p_user uuid, p_desde timestamptz)
returns numeric language sql stable
set search_path = copiloto, pg_temp
as $$
  select coalesce(sum(coalesce(custo_usd, custo_reservado_usd)), 0)
  from copiloto.pedidos
  where criado_em >= p_desde
    and status in ('reservado', 'ok', 'erro', 'recusado')
    and (p_user is null or user_id = p_user)
$$;

-- Cota do mês em R$ para uma pessoa (null = não é testador ativo).
create or replace function copiloto.cota_brl(p_user uuid)
returns numeric language plpgsql stable
set search_path = copiloto, pg_temp
as $$
declare
  v_cota numeric;
  v_criado timestamptz;
begin
  select coalesce(t.cota_mensal_brl, p.cota_mensal_brl) into v_cota
  from copiloto.testadores t join copiloto.planos p on p.codigo = t.plano
  where t.user_id = p_user and t.status = 'ativo' and p.ativo;
  if v_cota is null then return null; end if;

  select created_at into v_criado from auth.users where id = p_user;
  if v_criado is not null
     and v_criado > now() - make_interval(days => (copiloto.cfg('conta_nova_dias') #>> '{}')::int) then
    v_cota := round(v_cota / 2, 2);
  end if;
  return v_cota;
end $$;

-- Aceite em dia: termos, privacidade e IA na versão exigida.
create or replace function copiloto.aceites_em_dia(p_user uuid)
returns boolean language sql stable
set search_path = copiloto, public, pg_temp
as $$
  select count(*) = 3 from public.aceites_termos a
  where a.user_id = p_user
    and ((a.documento = 'termos'      and a.versao = copiloto.cfg('versao_termos')      #>> '{}')
      or (a.documento = 'privacidade' and a.versao = copiloto.cfg('versao_privacidade') #>> '{}')
      or (a.documento = 'ia'          and a.versao = copiloto.cfg('versao_ia')          #>> '{}'))
$$;

-- Reserva atômica. Confere, nesta ordem: IA ligada, testador ativo, aceites,
-- um pedido por vez, pedidos por minuto, limite do recurso, cota do mês e
-- disjuntor do dia. Se tudo passa, grava o pedido como 'reservado' com o
-- custo máximo possível e devolve o id. Se não passa, grava 'bloqueado'
-- com o motivo e devolve só o motivo.
create or replace function copiloto.reservar(
  p_user uuid, p_recurso text, p_modelo text, p_versao_prompt text, p_custo_max_usd numeric
) returns table (pedido_id uuid, motivo text)
language plpgsql volatile
set search_path = copiloto, pg_temp
as $$
declare
  v_motivo   text;
  v_cota     numeric;
  v_cambio   numeric := (copiloto.cfg('cambio_brl_por_usd') #>> '{}')::numeric;
  v_limites  jsonb;
  v_lim      int;
  v_qtd      int;
  v_id       uuid;
begin
  if p_custo_max_usd is null or p_custo_max_usd < 0 then
    raise exception 'custo máximo inválido';
  end if;

  -- Um cadeado por pessoa e um geral (disjuntor). Sempre nesta ordem.
  perform pg_advisory_xact_lock(hashtext('copiloto:user:' || p_user::text));
  perform pg_advisory_xact_lock(hashtext('copiloto:disjuntor'));

  -- Reservas antigas que nunca foram acertadas (servidor caiu no meio):
  -- viram erro, mas o custo reservado continua contando.
  update copiloto.pedidos set status = 'erro', motivo = 'reserva_expirada', concluido_em = now()
  where user_id = p_user and status = 'reservado' and criado_em < now() - interval '5 minutes';

  if coalesce((copiloto.cfg('ia_ligada'))::boolean, false) is not true then
    v_motivo := 'ia_desligada';
  end if;

  if v_motivo is null then
    v_cota := copiloto.cota_brl(p_user);
    if v_cota is null then v_motivo := 'fora_da_lista'; end if;
  end if;

  if v_motivo is null and not copiloto.aceites_em_dia(p_user) then
    v_motivo := 'sem_aceite';
  end if;

  if v_motivo is null and exists (
    select 1 from copiloto.pedidos where user_id = p_user and status = 'reservado'
  ) then
    v_motivo := 'um_de_cada_vez';
  end if;

  if v_motivo is null then
    select count(*) into v_qtd from copiloto.pedidos
    where user_id = p_user and criado_em > now() - interval '1 minute' and status <> 'bloqueado';
    if v_qtd >= (copiloto.cfg('pedidos_por_minuto') #>> '{}')::int then
      v_motivo := 'muitos_pedidos';
    end if;
  end if;

  if v_motivo is null then
    select p.limites into v_limites
    from copiloto.testadores t join copiloto.planos p on p.codigo = t.plano
    where t.user_id = p_user;

    v_lim := (v_limites ->> (p_recurso || '_dia'))::int;
    if v_lim is not null then
      select count(*) into v_qtd from copiloto.pedidos
      where user_id = p_user and recurso = p_recurso and criado_em >= copiloto.inicio_dia()
        and status in ('reservado', 'ok', 'erro', 'recusado');
      if v_qtd >= v_lim then v_motivo := 'limite_do_dia'; end if;
    end if;

    v_lim := (v_limites ->> (p_recurso || '_mes'))::int;
    if v_motivo is null and v_lim is not null then
      select count(*) into v_qtd from copiloto.pedidos
      where user_id = p_user and recurso = p_recurso and criado_em >= copiloto.inicio_mes()
        and status in ('reservado', 'ok', 'erro', 'recusado');
      if v_qtd >= v_lim then v_motivo := 'limite_do_mes'; end if;
    end if;
  end if;

  if v_motivo is null
     and (copiloto.gasto_usd(p_user, copiloto.inicio_mes()) + p_custo_max_usd) * v_cambio > v_cota then
    v_motivo := 'cota_esgotada';
  end if;

  if v_motivo is null
     and copiloto.gasto_usd(null, copiloto.inicio_dia()) + p_custo_max_usd
         > (copiloto.cfg('disjuntor_diario_usd') #>> '{}')::numeric then
    v_motivo := 'disjuntor';
  end if;

  if v_motivo is not null then
    insert into copiloto.pedidos (user_id, recurso, modelo, versao_prompt, status, motivo, concluido_em)
    values (p_user, p_recurso, p_modelo, p_versao_prompt, 'bloqueado', v_motivo, now());
    return query select null::uuid, v_motivo;
    return;
  end if;

  insert into copiloto.pedidos (user_id, recurso, modelo, versao_prompt, status, custo_reservado_usd)
  values (p_user, p_recurso, p_modelo, p_versao_prompt, 'reservado', p_custo_max_usd)
  returning id into v_id;
  return query select v_id, null::text;
end $$;

-- Troca a reserva pelo custo real que a API informou.
create or replace function copiloto.acertar(
  p_pedido uuid, p_status text, p_custo_usd numeric,
  p_tokens_entrada int, p_tokens_saida int, p_cache_leitura int, p_cache_escrita int,
  p_motivo text default null
) returns void language sql volatile
set search_path = copiloto, pg_temp
as $$
  update copiloto.pedidos set
    status = p_status, custo_usd = p_custo_usd,
    tokens_entrada = p_tokens_entrada, tokens_saida = p_tokens_saida,
    tokens_cache_leitura = p_cache_leitura, tokens_cache_escrita = p_cache_escrita,
    motivo = p_motivo, concluido_em = now()
  where id = p_pedido and status = 'reservado'
$$;

-- Totais de consumo por categoria de um mês, lidos do banco, para conferir o
-- resumo que o app mandou. Mesma regra do app (isConsumo/despVal):
-- despesa soma, estorno subtrai; excluídos e previstas futuras ficam de fora.
-- Só os lançamentos da própria pessoa (como o app carrega).
create or replace function copiloto.totais_por_categoria(p_user uuid, p_mes date)
returns table (categoria text, total numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  return query
  select coalesce(t.categoria, 'Sem categoria')::text,
         round(sum(case when t.tipo = 'estorno' then -t.valor else t.valor end)::numeric, 2)
  from public.transactions t
  where t.user_id = p_user
    and t.deleted_at is null
    and t.tipo in ('despesa', 'estorno')
    and nullif(t.data_efet::text, '')::date >= date_trunc('month', p_mes)::date
    and nullif(t.data_efet::text, '')::date <  (date_trunc('month', p_mes) + interval '1 month')::date
    and not (coalesce(t.status_parcela, '') = 'prevista'
             and nullif(t.data_efet::text, '')::date > (now() at time zone (copiloto.cfg('fuso') #>> '{}'))::date)
  group by 1;
end $$;

-- Ajudantes para o SQL Editor do painel (dono do projeto):
--   select copiloto.convidar('pessoa@email.com');
--   select copiloto.mudar_status('pessoa@email.com', 'pausado');
create or replace function copiloto.convidar(p_email text, p_cota_brl numeric default null)
returns text language plpgsql volatile
set search_path = copiloto, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    return 'Nenhuma conta com esse e-mail. A pessoa precisa criar a conta no Gênesis primeiro.';
  end if;
  insert into copiloto.testadores (user_id, email, cota_mensal_brl)
  values (v_id, lower(trim(p_email)), p_cota_brl)
  on conflict (user_id) do update set status = 'ativo',
    cota_mensal_brl = coalesce(excluded.cota_mensal_brl, copiloto.testadores.cota_mensal_brl);
  return 'Testador ativo: ' || lower(trim(p_email));
end $$;

create or replace function copiloto.mudar_status(p_email text, p_status text)
returns text language sql volatile
set search_path = copiloto, pg_temp
as $$
  update copiloto.testadores set status = p_status where lower(email) = lower(trim(p_email))
  returning 'Status de ' || email || ': ' || status
$$;

revoke all on all functions in schema copiloto from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- O que o app pode perguntar: "a IA está liberada para mim e quanto resta?"
-- Não expõe nada de outras pessoas.
-- ---------------------------------------------------------------------
create or replace function public.copiloto_meu_status()
returns jsonb language plpgsql stable security definer
set search_path = copiloto, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cota numeric;
  v_status text;
  v_cambio numeric := (copiloto.cfg('cambio_brl_por_usd') #>> '{}')::numeric;
begin
  if v_user is null then return jsonb_build_object('liberado', false, 'motivo', 'sem_login'); end if;
  select status into v_status from copiloto.testadores where user_id = v_user;
  v_cota := copiloto.cota_brl(v_user);
  return jsonb_build_object(
    'liberado', v_cota is not null and coalesce((copiloto.cfg('ia_ligada'))::boolean, false),
    'testador', v_status,
    'aceites_em_dia', copiloto.aceites_em_dia(v_user),
    'versoes', jsonb_build_object(
      'termos', copiloto.cfg('versao_termos') #>> '{}',
      'privacidade', copiloto.cfg('versao_privacidade') #>> '{}',
      'ia', copiloto.cfg('versao_ia') #>> '{}'),
    'cota_brl', v_cota,
    'gasto_mes_brl', round(copiloto.gasto_usd(v_user, copiloto.inicio_mes()) * v_cambio, 2)
  );
end $$;

revoke all on function public.copiloto_meu_status() from public, anon;
grant execute on function public.copiloto_meu_status() to authenticated;

-- Versões exigidas dos documentos, para o app saber se precisa pedir o aceite.
-- Pública (sem dados pessoais), para funcionar também antes do login.
create or replace function public.termos_versoes()
returns jsonb language sql stable security definer
set search_path = copiloto, pg_temp
as $$
  select jsonb_build_object(
    'termos', copiloto.cfg('versao_termos') #>> '{}',
    'privacidade', copiloto.cfg('versao_privacidade') #>> '{}',
    'ia', copiloto.cfg('versao_ia') #>> '{}')
$$;
grant execute on function public.termos_versoes() to anon, authenticated;
