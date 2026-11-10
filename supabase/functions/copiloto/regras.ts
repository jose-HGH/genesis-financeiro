// Regras puras do copiloto: sem rede, sem banco, sem Deno.
// Ficam aqui para poder testar com `node --test` (ver regras.test.ts).

// ---------------------------------------------------------------------
// Preços (US$ por milhão de tokens). Conferir na página de preços da
// Anthropic antes de mudar a cota; o custo é gravado em US$ em cada pedido.
// ---------------------------------------------------------------------
export const PRECOS: Record<string, { entrada: number; saida: number }> = {
  "claude-haiku-5-5": { entrada: 0.10, saida: 0.50 },
  "claude-sonnet-5-5": { entrada: 2.00, saida: 10.00 },
};
const LEITURA_CACHE = 0.10; // leitura de cache = 10% da entrada
const ESCRITA_CACHE = 1.25; // gravação de cache (5 min) = 125% da entrada

export interface Uso {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Custo real em US$ a partir do `usage` que a API devolve. */
export function custoUsd(modelo: string, uso: Uso): number {
  const p = PRECOS[modelo];
  if (!p) throw new Error(`modelo sem preço: ${modelo}`);
  const m = 1_000_000;
  return (
    (uso.input_tokens * p.entrada) / m +
    ((uso.cache_read_input_tokens ?? 0) * p.entrada * LEITURA_CACHE) / m +
    ((uso.cache_creation_input_tokens ?? 0) * p.entrada * ESCRITA_CACHE) / m +
    (uso.output_tokens * p.saida) / m
  );
}

/**
 * Estimativa conservadora de tokens de um texto: 1 token a cada 2 caracteres
 * (português com números costuma dar 3 a 4). Serve para reservar a cota e
 * recusar resumos grandes demais, nunca para cobrar.
 */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 2);
}

/** Pior caso do pedido, como se nada viesse do cache e a saída fosse até o limite. */
export function custoMaximoUsd(modelo: string, tokensEntrada: number, maxTokensSaida: number): number {
  const p = PRECOS[modelo];
  if (!p) throw new Error(`modelo sem preço: ${modelo}`);
  return (tokensEntrada * p.entrada * ESCRITA_CACHE + maxTokensSaida * p.saida) / 1_000_000;
}

// ---------------------------------------------------------------------
// Impressão digital do pedido (chave das respostas guardadas)
// ---------------------------------------------------------------------

/** JSON com as chaves em ordem, para o mesmo conteúdo dar sempre o mesmo texto. */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jsonCanonico).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + jsonCanonico(o[k])).join(",") + "}";
}

export async function impressaoDigital(partes: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(jsonCanonico(partes));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------
// Verificação de números: todo valor em R$ da resposta tem de existir no resumo
// ---------------------------------------------------------------------

/** Converte "1.234,56" / "1234,5" / "1,234.56" / "80" em centavos. */
export function paraCentavos(bruto: string): number | null {
  let s = bruto.trim();
  if (!s) return null;
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // O último separador é o decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (temVirgula) {
    s = s.replace(",", ".");
  } else if (temPonto) {
    // "1.234" no Brasil é milhar; "12.5" seria decimal em inglês.
    const partes = s.split(".");
    if (partes.length > 2 || partes[partes.length - 1].length === 3) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export interface ValorCitado { texto: string; centavos: number; temCentavos: boolean }

/** Acha todos os valores em reais escritos no texto ("R$ 1.234,56", "-R$ 80", "R$80"). */
export function valoresEmReais(texto: string): ValorCitado[] {
  const re = /R\$\s*-?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
  const achados: ValorCitado[] = [];
  for (const m of texto.matchAll(re)) {
    const num = m[1];
    const c = paraCentavos(num);
    if (c !== null) achados.push({ texto: m[0], centavos: Math.abs(c), temCentavos: /,\d{1,2}$/.test(num) });
  }
  return achados;
}

/** Todos os números que aparecem no resumo (em qualquer nível), em centavos e sem sinal. */
export function numerosDoResumo(resumo: unknown): Set<number> {
  const set = new Set<number>();
  const visitar = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) set.add(Math.abs(Math.round(v * 100)));
    else if (Array.isArray(v)) v.forEach(visitar);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(visitar);
  };
  visitar(resumo);
  return set;
}

/**
 * Lista os valores citados que NÃO existem no resumo. Vazio = resposta aprovada.
 * Valor escrito sem centavos ("R$ 80") aceita o número do resumo arredondado.
 */
export function valoresInventados(texto: string, resumo: unknown): string[] {
  const permitidos = numerosDoResumo(resumo);
  const arredondados = new Set<number>([...permitidos].map((c) => Math.round(c / 100) * 100));
  return valoresEmReais(texto)
    .filter((v) => !(permitidos.has(v.centavos) || (!v.temCentavos && arredondados.has(v.centavos))))
    .map((v) => v.texto);
}

// ---------------------------------------------------------------------
// Conferência do resumo com o banco
// ---------------------------------------------------------------------

export interface ResumoBase {
  versao: number;
  mes: string; // "AAAA-MM"
  categorias: Record<string, number>; // consumo do mês por categoria (despesa − estorno)
  [extra: string]: unknown;
}

/** Valida a forma mínima do resumo. Devolve a mensagem de erro ou null. */
export function validarResumo(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "resumo precisa ser um objeto";
  const o = r as Record<string, unknown>;
  if (o.versao !== 1) return "versão do resumo não suportada";
  if (typeof o.mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(o.mes)) return "mes precisa ser AAAA-MM";
  if (!o.categorias || typeof o.categorias !== "object" || Array.isArray(o.categorias)) return "categorias ausentes";
  for (const [k, v] of Object.entries(o.categorias as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return `categoria "${k}" sem valor numérico`;
  }
  return null;
}

/**
 * Compara as categorias do resumo com os totais do banco. Devolve as
 * categorias que diferem mais que a tolerância (inclui as que faltam de um lado).
 */
export function divergencias(
  doResumo: Record<string, number>,
  doBanco: Record<string, number>,
  toleranciaBrl: number,
): string[] {
  const nomes = new Set([...Object.keys(doResumo), ...Object.keys(doBanco)]);
  const ruins: string[] = [];
  for (const n of nomes) {
    const a = doResumo[n] ?? 0, b = doBanco[n] ?? 0;
    if (Math.abs(a - b) > toleranciaBrl) ruins.push(n);
  }
  return ruins.sort();
}
