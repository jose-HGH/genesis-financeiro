import fs from "node:fs";
import path from "node:path";

const PASTA = path.join(import.meta.dirname, "arquivos");
const EXTENSOES = /\.(pdf|ofx|qfx|csv|txt|xlsx)$|\.linhas\.json$/i;

export function listarArquivos(dir = PASTA) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listarArquivos(p);
    return EXTENSOES.test(e.name) ? [p] : [];
  }).sort();
}

const centavos = (v) => Math.round(v * 100);

// O que conferimos de cada leitura: tipo, banco, totais e cada linha com data, valor, sinal e tipo.
export function resumir({ erroTela, previa }) {
  if (erroTela) return { erro: erroTela };
  const linhas = previa.linhas.map((l) => ({
    data: l.data, dataEfet: l.dataEfet, valor: l.valor, sinal: l.sinal, descricao: l.descricao,
    tipo: l.tipo, parcela: l.parcela, final: l.final, selecionada: l.selecionada,
  }));
  const soma = linhas.reduce((s, l) => s + (l.sinal === "-" ? -1 : 1) * centavos(l.valor), 0) / 100;
  return { meta: previa.meta, total_linhas: linhas.length, soma, linhas };
}
