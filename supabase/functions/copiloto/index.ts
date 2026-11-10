// Edge Function "copiloto" — a porta única entre o app e a API da Anthropic.
//
// Caminho de um pedido (desenho "Copiloto de IA: desenho do serviço e custos"):
//   1. origem permitida, método e tamanho
//   2. login válido e e-mail confirmado
//   3. recurso ligado, resumo com forma válida e tamanho dentro do limite
//   4. resumo confere com o banco (consumo por categoria do mês)
//   5. resposta guardada? devolve sem chamar a IA e sem gastar cota
//   6. reserva atômica no banco: testador ativo, aceites, 1 por vez,
//      pedidos por minuto, limite do recurso, cota do mês e disjuntor do dia
//   7. chamada à Anthropic (chave só no servidor), na ordem que aproveita o cache
//   8. verificação de números (1 nova tentativa); recusa do modelo tratada
//   9. acerta a cota com o custo real, guarda a resposta e registra sem dados pessoais
//
// Secrets (Painel do Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY      chave de um workspace só do copiloto, com teto de gasto
//   ORIGENS_PERMITIDAS     opcional; padrão: o domínio do Gênesis
// Já existem em toda Edge Function: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_DB_URL.

import Anthropic from "npm:@anthropic-ai/sdk@1.2.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import postgres from "npm:postgres@3.4.5";
import { MENSAGENS, RECURSOS, SISTEMA_FIXO } from "./recursos.ts";
import {
  custoMaximoUsd, custoUsd, divergencias, estimarTokens, impressaoDigital,
  type ResumoBase, type Uso, validarCardExplicar, validarResumo, valoresInventados,
} from "./regras.ts";

const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ??
  "https://xn--finanashgh-s6a.com,https://www.xn--finanashgh-s6a.com")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_CORPO_BYTES = 64 * 1024;
const MAX_PERGUNTA_CHARS = 500;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });
const auth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// maxRetries 0: uma nova tentativa automática gastaria fora da reserva.
// trim: um espaço ou quebra de linha colada junto no painel invalida a chave.
const CHAVE = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
const anthropic = new Anthropic({ apiKey: CHAVE, maxRetries: 0, timeout: 60_000 });

// Só o formato da chave, nunca a chave: ajuda a achar erro de cópia num 401.
function formatoDaChave(): string {
  const tipo = CHAVE.startsWith("sk-ant-api03-") ? "api03" : CHAVE.startsWith("sk-ant-admin") ? "admin"
    : CHAVE.startsWith("sk-ant-") ? "outra-sk-ant" : CHAVE ? "nao-sk-ant" : "vazia";
  return `tipo=${tipo} tamanho=${CHAVE.length}`;
}

function cabecalhos(origem: string | null): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  if (origem && ORIGENS.includes(origem)) {
    h["Access-Control-Allow-Origin"] = origem;
    h["Access-Control-Allow-Headers"] = "authorization, content-type, apikey, x-client-info";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

function responder(origem: string | null, status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });
}

function recusar(origem: string | null, status: number, motivo: string, extra: Record<string, unknown> = {}) {
  return responder(origem, status, { ok: false, motivo, mensagem: MENSAGENS[motivo] ?? MENSAGENS.erro, ...extra });
}

async function lerConfig(): Promise<Record<string, unknown>> {
  const linhas = await sql<{ chave: string; valor: unknown }[]>`select chave, valor from copiloto.config`;
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

function textoDaResposta(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");

  // 1. Origem, método e tamanho
  if (!origem || !ORIGENS.includes(origem)) return recusar(null, 403, "erro");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos(origem) });
  if (req.method !== "POST") return recusar(origem, 405, "erro");
  const bruto = await req.text();
  if (new TextEncoder().encode(bruto).length > MAX_CORPO_BYTES) return recusar(origem, 413, "resumo_grande");

  // 2. Login e e-mail confirmado (o token é conferido pelo próprio Supabase Auth)
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return recusar(origem, 401, "sem_login");
  const { data: quem, error: erroAuth } = await auth.auth.getUser(token);
  if (erroAuth || !quem?.user) return recusar(origem, 401, "sem_login");
  if (!quem.user.email_confirmed_at) return recusar(origem, 403, "email_nao_confirmado");
  const userId = quem.user.id;

  // 3. Recurso e resumo
  let corpo: { recurso?: unknown; resumo?: unknown; pergunta?: unknown };
  try { corpo = JSON.parse(bruto); } catch { return recusar(origem, 400, "resumo_invalido"); }
  const nomeRecurso = typeof corpo.recurso === "string" ? corpo.recurso : "";
  const recurso = RECURSOS[nomeRecurso];
  if (!recurso || !recurso.ativo) return recusar(origem, 404, "recurso_indisponivel");
  if (validarResumo(corpo.resumo) !== null) return recusar(origem, 400, "resumo_invalido");
  const resumo = corpo.resumo as ResumoBase;
  // Explicar: só os números do quadro, sem texto livre (ver regras.ts).
  if (recurso.instrucaoPorCard && validarCardExplicar(resumo) !== null) return recusar(origem, 400, "resumo_invalido");
  const instrucao = recurso.instrucao +
    (recurso.instrucaoPorCard ? "\n\n" + (recurso.instrucaoPorCard[String(resumo.card)] ?? "") : "");
  const pergunta = recurso.aceitaPergunta && typeof corpo.pergunta === "string"
    ? corpo.pergunta.trim().slice(0, MAX_PERGUNTA_CHARS) : "";
  if (recurso.aceitaPergunta && !pergunta) return recusar(origem, 400, "resumo_invalido");

  let cfg: Record<string, unknown>;
  try { cfg = await lerConfig(); } catch (e) {
    console.error("copiloto: config", (e as Error).message);
    return recusar(origem, 503, "erro");
  }
  const resumoJson = JSON.stringify(resumo);
  if (estimarTokens(resumoJson) > Number(cfg.max_tokens_resumo ?? 8000)) return recusar(origem, 413, "resumo_grande");

  // 4. Confere o consumo por categoria com o banco
  const totais = await sql<{ categoria: string; total: string }[]>`
    select categoria, total from copiloto.totais_por_categoria(${userId}::uuid, ${resumo.mes + "-01"}::date)`;
  const doBanco = Object.fromEntries(totais.map((t) => [t.categoria, Number(t.total)]));
  const ruins = divergencias(resumo.categorias, doBanco, Number(cfg.diferenca_max_brl ?? 1));
  if (ruins.length) return recusar(origem, 409, "resumo_nao_confere", { categorias: ruins });

  // 5. Resposta guardada
  const impressao = await impressaoDigital({
    u: userId, r: nomeRecurso, s: resumo, p: pergunta, v: recurso.versaoPrompt, m: recurso.modelo,
  });
  const [guardada] = await sql<{ texto: string }[]>`
    update copiloto.respostas set usos = usos + 1 where impressao = ${impressao} and user_id = ${userId}::uuid
    returning texto`;
  if (guardada) {
    await sql`insert into copiloto.pedidos (user_id, recurso, modelo, versao_prompt, status, concluido_em)
              values (${userId}::uuid, ${nomeRecurso}, ${recurso.modelo}, ${recurso.versaoPrompt}, 'cache', now())`;
    return responder(origem, 200, { ok: true, texto: guardada.texto, guardada: true });
  }

  // 6. Reserva: o pior caso de duas chamadas (a original e uma nova tentativa)
  const tokensEntrada = estimarTokens(SISTEMA_FIXO + resumoJson + instrucao + pergunta);
  const reserva = 2 * custoMaximoUsd(recurso.modelo, tokensEntrada, recurso.maxTokensSaida);
  const [r] = await sql<{ pedido_id: string | null; motivo: string | null }[]>`
    select * from copiloto.reservar(${userId}::uuid, ${nomeRecurso}, ${recurso.modelo}, ${recurso.versaoPrompt}, ${reserva})`;
  if (!r?.pedido_id) {
    const motivo = r?.motivo ?? "erro";
    const status = ["fora_da_lista", "sem_aceite", "ia_desligada"].includes(motivo) ? 403 : 429;
    return recusar(origem, status, motivo);
  }
  const pedidoId = r.pedido_id;

  // 7 e 8. Chamada à Anthropic e verificação de números
  const uso = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let custo = 0;
  let texto: string | null = null;
  let status: "ok" | "recusado" | "erro" = "erro";
  let motivo: string | null = null;

  try {
    for (let tentativa = 1; tentativa <= 2 && texto === null; tentativa++) {
      const params = {
        model: recurso.modelo,
        max_tokens: recurso.maxTokensSaida,
        output_config: { effort: recurso.esforco },
        // Ordem fixa para o cache: instruções iguais para todos → resumo da pessoa → pedido.
        system: [{ type: "text" as const, text: SISTEMA_FIXO, cache_control: { type: "ephemeral" as const } }],
        messages: [{
          role: "user" as const,
          content: [
            { type: "text" as const, text: "RESUMO:\n" + resumoJson, cache_control: { type: "ephemeral" as const } },
            {
              type: "text" as const,
              text: instrucao + (pergunta ? "\n\nPERGUNTA DA PESSOA:\n" + pergunta : "") +
                (tentativa > 1 ? "\n\nAtenção: a resposta anterior citou valores que não estão no RESUMO. Cite só valores do RESUMO." : ""),
            },
          ],
        }],
      };
      // Sonnet 5.5: se o modelo recusar, a própria API tenta o modelo reserva.
      // Haiku 5.5 não tem esse modo; a recusa é tratada aqui.
      const msg = recurso.modelo === "claude-sonnet-5-5"
        ? await anthropic.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await anthropic.messages.create(params);

      uso.input_tokens += msg.usage.input_tokens ?? 0;
      uso.output_tokens += msg.usage.output_tokens ?? 0;
      uso.cache_read_input_tokens += msg.usage.cache_read_input_tokens ?? 0;
      uso.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens ?? 0;
      custo += custoUsd(recurso.modelo, msg.usage as Uso);

      if (msg.stop_reason === "refusal") {
        status = "recusado"; motivo = "recusado";
        break;
      }
      const candidato = textoDaResposta(msg as { content: Array<{ type: string; text?: string }> });
      if (!candidato) { motivo = "resposta_vazia"; continue; }
      if (valoresInventados(candidato, resumo).length === 0) {
        texto = candidato; status = "ok"; motivo = null;
      } else {
        status = "ok"; motivo = "numeros_reprovados";
      }
    }
  } catch (e) {
    // Sem texto do erro no registro: pode conter trechos do pedido.
    const err = e as { status?: number; name?: string };
    console.error("copiloto: anthropic", err.name ?? "erro", err.status ?? "",
      err.status === 401 ? formatoDaChave() : "");
    status = "erro"; motivo = "api_" + (err.status ?? "falhou");
  }

  // 9. Acerta a cota, guarda e responde
  await sql`select copiloto.acertar(${pedidoId}::uuid, ${status}, ${custo}, ${uso.input_tokens}, ${uso.output_tokens},
            ${uso.cache_read_input_tokens}, ${uso.cache_creation_input_tokens}, ${motivo})`;

  if (texto !== null) {
    await sql`insert into copiloto.respostas (impressao, user_id, recurso, modelo, versao_prompt, texto)
              values (${impressao}, ${userId}::uuid, ${nomeRecurso}, ${recurso.modelo}, ${recurso.versaoPrompt}, ${texto})
              on conflict (impressao) do nothing`;
    return responder(origem, 200, { ok: true, texto, guardada: false });
  }
  if (status === "recusado") return recusar(origem, 200, "recusado");
  if (motivo === "numeros_reprovados") return recusar(origem, 200, "numeros_reprovados");
  return recusar(origem, 502, "erro");
});
