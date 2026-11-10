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

// ---------------------------------------------------------------------
// Botão "Explicar" (passo 3): os números do quadro vão junto do resumo
// ---------------------------------------------------------------------

/** Quadros que têm botão "Explicar". O nome é também o campo do resumo com os números. */
export const CARDS_EXPLICAR = ["previsao", "fluxo", "diferencas", "simulacao"] as const;
export type CardExplicar = typeof CARDS_EXPLICAR[number];

const CHAVE_OK = /^[a-z_]{1,40}$/;
// Texto só como data (AAAA-MM-DD ou AAAA-MM) ou rótulo curto: nada de texto livre,
// para nenhuma descrição de lançamento (nomes, CPF) nem instrução ir para a IA.
const TEXTO_OK = /^(\d{4}-\d{2}(-\d{2})?|[a-z_]{1,24})$/;
const MAX_CAMPOS_CARD = 80;

/**
 * Valida o resumo do "Explicar": campo "card" com um quadro conhecido e o campo
 * de mesmo nome com só números, verdadeiro/falso, datas e rótulos curtos, até 3
 * níveis. Nenhum outro campo extra. Devolve a mensagem de erro ou null.
 */
export function validarCardExplicar(r: ResumoBase): string | null {
  const card = r.card;
  if (typeof card !== "string" || !(CARDS_EXPLICAR as readonly string[]).includes(card)) return "card desconhecido";
  const extras = Object.keys(r).filter((k) => !["versao", "mes", "categorias", "card", card].includes(k));
  if (extras.length) return `campo inesperado: ${extras[0]}`;
  let campos = 0;
  // No quadro do simulador, dois textos a mais: o nome de uma categoria que já
  // está no resumo e os termos de busca (minúsculas, sem acento) que a pessoa usou.
  const textoExtraOk = (chave: string, v: string): boolean =>
    card === "simulacao" && (
      (chave === "categoria" && Object.prototype.hasOwnProperty.call(r.categorias, v)) ||
      (chave === "termos" && v.length <= 80 && /^[a-z0-9]+( [a-z0-9]+)*(, [a-z0-9]+( [a-z0-9]+)*){0,5}$/.test(v))
    );
  const visitar = (v: unknown, nivel: number, chave = ""): string | null => {
    if (v === null || typeof v === "boolean") return null;
    if (typeof v === "number") return Number.isFinite(v) ? null : "número inválido";
    if (typeof v === "string") return TEXTO_OK.test(v) || textoExtraOk(chave, v) ? null : "texto não permitido";
    if (typeof v !== "object" || Array.isArray(v)) return "tipo não permitido";
    if (nivel > 3) return "níveis demais";
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!CHAVE_OK.test(k)) return `nome de campo inválido: ${k}`;
      if (++campos > MAX_CAMPOS_CARD) return "campos demais";
      const e = visitar(x, nivel + 1, k);
      if (e) return e;
    }
    return null;
  };
  const dados = r[card];
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return "números do quadro ausentes";
  return visitar(dados, 1);
}

// ---------------------------------------------------------------------
// Simulador "e se" (passo 6): a IA só transforma o pedido em texto livre
// nos campos do formulário. Quem calcula é o app; a IA explica depois
// pelo "Explicar" com o quadro "simulacao".
// ---------------------------------------------------------------------

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resumo do pedido do simulador: o resumo base mais "hoje" (para a IA
 * entender "dia 20" ou "mês que vem"). Nenhum outro campo, para nada além das
 * categorias e da pergunta da própria pessoa ir para a IA.
 */
export function validarResumoSimulador(r: ResumoBase): string | null {
  const extras = Object.keys(r).filter((k) => !["versao", "mes", "categorias", "hoje"].includes(k));
  if (extras.length) return `campo inesperado: ${extras[0]}`;
  if (typeof r.hoje !== "string" || !DATA_ISO.test(r.hoje)) return "hoje precisa ser AAAA-MM-DD";
  if (Object.keys(r.categorias).length > 60) return "categorias demais";
  return null;
}

export const TIPOS_CENARIO = ["cortar", "saida", "entrada", "parcelada", "nao_entendi"] as const;
export type TipoCenario = typeof TIPOS_CENARIO[number];

export interface Cenario {
  tipo: TipoCenario;
  categoria: string | null;
  termos: string[];
  percentual: number | null;
  valor: number | null;
  valor_parcela: number | null;
  parcelas: number | null;
  data: string | null;
  repetir: "unica" | "mensal" | null;
}

const anulavel = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });

/** Esquema da saída estruturada (output_config.format). Todos os campos sempre presentes. */
export const ESQUEMA_CENARIO = {
  type: "object",
  additionalProperties: false,
  required: ["tipo", "categoria", "termos", "percentual", "valor", "valor_parcela", "parcelas", "data", "repetir"],
  properties: {
    tipo: { type: "string", enum: [...TIPOS_CENARIO] },
    categoria: anulavel({ type: "string" }),
    termos: { type: "array", items: { type: "string" } },
    percentual: anulavel({ type: "number" }),
    valor: anulavel({ type: "number" }),
    valor_parcela: anulavel({ type: "number" }),
    parcelas: anulavel({ type: "integer" }),
    data: anulavel({ type: "string", format: "date" }),
    repetir: anulavel({ type: "string", enum: ["unica", "mensal"] }),
  },
} as const;

const TERMO_OK = /^[a-z0-9]+( [a-z0-9]+){0,2}$/;
const VALOR_MAX = 1_000_000;

function normalizarTermo(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function dinheiro(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= VALOR_MAX ? Math.round(v * 100) / 100 : null;
}
function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Confere e normaliza o cenário que a IA devolveu. Devolve {cenario} pronto
 * para o formulário ou {erro}. A categoria tem de ser uma das categorias do
 * resumo; termos viram minúsculas sem acento; datas ficam entre hoje e 1 ano.
 */
export function validarCenario(
  bruto: unknown, categorias: Record<string, number>, hoje: string,
): { cenario: Cenario } | { erro: string } {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { erro: "não é objeto" };
  const o = bruto as Record<string, unknown>;
  const tipo = o.tipo as TipoCenario;
  if (!(TIPOS_CENARIO as readonly string[]).includes(tipo)) return { erro: "tipo desconhecido" };
  const vazio: Cenario = {
    tipo: "nao_entendi", categoria: null, termos: [], percentual: null, valor: null,
    valor_parcela: null, parcelas: null, data: null, repetir: null,
  };
  if (tipo === "nao_entendi") return { cenario: vazio };

  if (tipo === "cortar") {
    let categoria: string | null = null;
    if (typeof o.categoria === "string" && o.categoria.trim()) {
      if (!Object.prototype.hasOwnProperty.call(categorias, o.categoria)) return { erro: "categoria fora da lista" };
      categoria = o.categoria;
    }
    const termos = Array.isArray(o.termos)
      ? [...new Set(o.termos.filter((t) => typeof t === "string").map((t) => normalizarTermo(t as string))
        .filter((t) => t.length >= 2 && t.length <= 24 && TERMO_OK.test(t)))].slice(0, 6)
      : [];
    if (!categoria && !termos.length) return { erro: "cortar sem categoria nem termos" };
    const p = typeof o.percentual === "number" && Number.isFinite(o.percentual) ? Math.round(o.percentual) : NaN;
    if (!(p >= 1 && p <= 100)) return { erro: "percentual fora de 1 a 100" };
    return { cenario: { ...vazio, tipo, categoria, termos, percentual: p } };
  }

  let data: string | null = null;
  if (typeof o.data === "string" && o.data) {
    if (!DATA_ISO.test(o.data) || isNaN(Date.parse(o.data + "T00:00:00Z"))) return { erro: "data inválida" };
    if (o.data < hoje || o.data > somarDias(hoje, 366)) return { erro: "data fora de hoje até 1 ano" };
    data = o.data;
  }

  if (tipo === "saida" || tipo === "entrada") {
    const valor = dinheiro(o.valor);
    if (valor === null) return { erro: "valor inválido" };
    const repetir = o.repetir === "mensal" ? "mensal" : "unica";
    return { cenario: { ...vazio, tipo, valor, data, repetir } };
  }

  // parcelada; sem número de parcelas = comparar opções (o app escolhe por regra)
  let parcelas: number | null = null;
  if (o.parcelas !== null && o.parcelas !== undefined) {
    parcelas = typeof o.parcelas === "number" && Number.isInteger(o.parcelas) ? o.parcelas : NaN;
    if (!(parcelas >= 1 && parcelas <= 48)) return { erro: "parcelas fora de 1 a 48" };
  }
  const valor = dinheiro(o.valor), valorParcela = dinheiro(o.valor_parcela);
  if (valor === null && valorParcela === null) return { erro: "parcelada sem valor" };
  if (parcelas === null && valor === null) return { erro: "comparar parcelas precisa do valor total" };
  return { cenario: { ...vazio, tipo, parcelas, valor: valorParcela === null ? valor : null, valor_parcela: valorParcela, data } };
}
