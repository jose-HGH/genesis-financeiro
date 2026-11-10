# Supabase do Gênesis

Tudo o que roda no servidor fica nesta pasta, versionado:

| Pasta | O que é |
|---|---|
| `migrations/` | Mudanças no banco, em ordem. Nunca editar uma que já foi aplicada; criar outra. |
| `schema/atual.sql` | Fotografia da estrutura do banco (sem dados), gerada pela ação do GitHub. |
| `functions/copiloto/` | Edge Function do copiloto de IA: a única porta entre o app e a Anthropic. |

## Passo 1 (Base, sem IA visível)

A migration `20261110120000_base_termos_e_copiloto.sql` cria:

- `public.aceites_termos`: quem aceitou qual versão dos Termos, da Política de Privacidade e do consentimento de IA. O app pede o aceite no login.
- Schema `copiloto` (fora da API pública): `config`, `planos`, `admins`, `testadores`, `pedidos` (registro sem dados pessoais) e `respostas` (respostas guardadas).
- Funções `copiloto.reservar` / `copiloto.acertar` (cota atômica e disjuntor), `copiloto.totais_por_categoria` (conferência do resumo) e ajudantes `copiloto.convidar` / `copiloto.mudar_status`.
- `public.copiloto_meu_status()` e `public.termos_versoes()`, as únicas coisas novas que o app enxerga.

Nenhuma tabela existente é alterada.

## Como publicar (uma vez)

1. **Chave da Anthropic**: no Console da Anthropic, crie um workspace só para o copiloto, com limite de gasto de US$ 15/mês e alertas em 50% e 80%. Crie a chave dentro dele.
2. **Painel do Supabase → Edge Functions → Secrets**: adicione `ANTHROPIC_API_KEY` com essa chave. Ela nunca vai para o GitHub nem para o navegador.
3. **GitHub → Settings → Secrets and variables → Actions**: adicione `SUPABASE_ACCESS_TOKEN` (supabase.com/dashboard/account/tokens) e `SUPABASE_DB_PASSWORD` (senha do banco).
4. **GitHub → Actions → Supabase → Run workflow** com `tudo`: salva a fotografia do banco atual, aplica a migration e publica a função.

## Ajustes do dia a dia (SQL Editor do painel)

```sql
-- Liberar um testador (a pessoa precisa ter conta no Gênesis)
select copiloto.convidar('pessoa@email.com');
-- Cota própria em R$ para alguém
select copiloto.convidar('pessoa@email.com', 8.00);
-- Pausar ou remover
select copiloto.mudar_status('pessoa@email.com', 'pausado');

-- Desligar a IA para todos na hora
update copiloto.config set valor = 'false' where chave = 'ia_ligada';
-- Mudar o disjuntor diário (US$) ou o câmbio
update copiloto.config set valor = '2.0' where chave = 'disjuntor_diario_usd';
-- Mudar a cota padrão do plano de testes (R$) ou um limite por recurso
update copiloto.planos set cota_mensal_brl = 6.00 where codigo = 'teste';
update copiloto.planos set limites = jsonb_set(limites, '{chat_mes}', '150') where codigo = 'teste';

-- Quanto foi gasto (US$) hoje e no mês, e por quê pedidos foram bloqueados
select copiloto.gasto_usd(null, copiloto.inicio_dia()) as hoje, copiloto.gasto_usd(null, copiloto.inicio_mes()) as mes;
select status, motivo, count(*) from copiloto.pedidos where criado_em > now() - interval '7 days' group by 1, 2;
```

Valores iniciais (do desenho do copiloto): cota R$ 4/mês por pessoa (metade no primeiro mês de conta), disjuntor US$ 1/dia, 10 pedidos por minuto, 1 de cada vez, limites por recurso no plano `teste`, câmbio R$ 5,50.

## Prova das travas (portão do passo 1)

Com a função publicada, entre no Gênesis com uma conta liberada (`copiloto.convidar`), aceite o consentimento de IA que aparece e rode no console do navegador:

```js
await genesisCopilotoTeste()
```

A resposta deve ser `{ok: true, texto: "...", guardada: false}`; rodando de novo, `guardada: true` (sem chamar a IA). Sem login, fora da lista, sem aceite ou acima da cota, a resposta é `{ok: false, motivo: "..."}`.

## Testes locais

```bash
node --experimental-strip-types --test supabase/functions/copiloto/regras.test.ts
```
