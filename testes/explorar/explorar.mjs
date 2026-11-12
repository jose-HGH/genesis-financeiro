// Testes em massa: gera N casos fictícios, roda cada um no painel isolado e confere regras.
// Uso: node testes/explorar/explorar.mjs [--semente 1] [--casos 200] [--saida pasta] [--so 7-19,7-47]
// Os casos que falham são gravados na pasta de saída para reproduzir (mesma semente = mesmos casos).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { gerarCasos } from "./gerador.mjs";
import { iniciarServidor, abrirNavegador, abrirPainel, importarArquivo, responderAvisos } from "../ambiente.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SEMENTE = +arg("semente", 1), N = +arg("casos", 200);
const SAIDA = path.resolve(arg("saida", path.join(os.tmpdir(), "genesis-explorar")));
fs.mkdirSync(SAIDA, { recursive: true });

const assinado = (l) => Math.round((l.sinal === "-" ? -1 : 1) * l.valor * 100);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
function multiset(arr, chave) { const m = new Map(); arr.forEach((x) => { const k = chave(x); m.set(k, (m.get(k) || 0) + 1); }); return m; }
function diferenca(a, b) { // o que tem em a e não em b
  const out = []; for (const [k, n] of a) { const d = n - (b.get(k) || 0); for (let i = 0; i < d; i++) out.push(k); } return out;
}

function gravar(caso, arquivo) {
  const p = path.join(SAIDA, arquivo.nome);
  if (arquivo.bytes) fs.writeFileSync(p, arquivo.bytes); else fs.writeFileSync(p, JSON.stringify({ linhas: arquivo.linhas }, null, 1));
  return p;
}

async function confirmar(page) {
  await responderAvisos(page);
  const inicio = await page.evaluate(() => window.__genesisTeste.lancamentos().length);
  const btn = await page.$("#btnConfirmStaging");
  if (!btn || !(await btn.isEnabled())) return { ok: false, motivo: btn ? (await btn.textContent()).trim() : "sem botão de importar" };
  await btn.click();
  await page.waitForFunction((n) => window.__genesisTeste.lancamentos().length > n, inicio, { timeout: 10000 }).catch(() => {});
  return { ok: true, entraram: (await page.evaluate(() => window.__genesisTeste.lancamentos().length)) - inicio };
}

async function rodarCaso(browser, base, caso) {
  const problemas = [];
  const prob = (regra, detalhe) => problemas.push({ regra, detalhe });
  const { ctx, page, erros } = await abrirPainel(browser, base);
  try {
    const arq = gravar(caso, caso.arquivo);
    let r;
    try { r = await importarArquivo(page, arq, caso.opcoes || {}); }
    catch (e) { prob("travou-na-importacao", String(e.message).split("\n")[0]); return problemas; }
    const esp = caso.esperado;

    if (esp.soSaldo) { if (!r.soSaldo) prob("ofx-vazio-sem-tela-de-saldo", r.erroTela || "abriu outra coisa"); return problemas; }
    if (caso.formato === "bb-texto" && !esp.linhas.length) { // extrato sem movimento: avisar, nunca transformar saldo em lançamento
      if (!r.erroTela || !/não tem lançamentos/.test(r.erroTela)) prob("extrato-vazio-virou-lancamento", r.erroTela || `${r.previa.linhas.length} linha(s) na prévia`);
      return problemas;
    }
    if (r.erroTela) { prob("erro-na-tela", r.erroTela.slice(0, 200)); return problemas; }
    const linhas = r.previa.linhas;

    if (linhas.length !== esp.linhas.length) prob("quantidade-de-linhas", `esperado ${esp.linhas.length}, lido ${linhas.length}`);
    const chaveData = caso.formato === "fatura-nubank" ? (l) => `${l.data}|${Math.round(Math.abs(l.valor) * 100)}` : (l) => `${l.data}|${l.sinal ? assinado(l) : Math.round(l.valor * 100)}`;
    const mEsp = multiset(esp.linhas, chaveData), mLido = multiset(linhas, chaveData);
    const faltam = diferenca(mEsp, mLido), sobram = diferenca(mLido, mEsp);
    if (faltam.length || sobram.length) prob("data-ou-valor-errado", `faltam ${JSON.stringify(faltam.slice(0, 4))} sobram ${JSON.stringify(sobram.slice(0, 4))}`);
    if (caso.formato === "bb-texto") {
      const me = multiset(esp.linhas, (l) => `${l.dataEfet}|${Math.round(l.valor * 100)}`), ml = multiset(linhas, (l) => `${l.dataEfet}|${assinado(l)}`);
      const f = diferenca(me, ml); if (f.length) prob("data-efetiva-errada", JSON.stringify(f.slice(0, 4)));
    }
    if (esp.linhas[0] && esp.linhas[0].descricao) {
      const lidas = linhas.map((l) => norm(l.descricao));
      const perdidas = esp.linhas.filter((e) => !lidas.some((d) => d.includes(norm(e.descricao).slice(0, 25))));
      if (perdidas.length) prob("descricao-alterada", JSON.stringify(perdidas.slice(0, 3).map((e) => e.descricao)) + " lidas: " + JSON.stringify(linhas.slice(0, 2).map((l) => l.descricao)));
    }
    if (caso.formato === "fatura-nubank") {
      if (r.previa.meta.vencimento !== esp.vencimento) prob("vencimento-errado", `esperado ${esp.vencimento}, lido ${r.previa.meta.vencimento}`);
      if ((r.previa.meta.fechamentoDia || null) !== esp.fechamentoDia) prob("fechamento-errado", `esperado ${esp.fechamentoDia}, lido ${r.previa.meta.fechamentoDia}`);
      const pe = multiset(esp.linhas.filter((l) => l.parcela), (l) => l.parcela), pl = multiset(linhas.filter((l) => l.parcela), (l) => String(l.parcela).replace(/\s/g, ""));
      const pf = diferenca(pe, pl); if (pf.length) prob("parcela-perdida", JSON.stringify(pf.slice(0, 4)));
    }
    const naoSel = linhas.filter((l) => !l.selecionada);
    if (naoSel.length) prob("linha-desmarcada-sem-motivo", `${naoSel.length} linha(s): ${JSON.stringify(naoSel.slice(0, 2).map((l) => l.descricao))}`);

    // importar e reimportar / importar o período maior
    if (caso.formato !== "fatura-nubank") {
      const c = await confirmar(page);
      if (!c.ok) prob("nao-consegue-importar", c.motivo);
      else {
        if (c.entraram !== linhas.filter((l) => l.selecionada).length) prob("importou-quantidade-diferente", `selecionadas ${linhas.filter((l) => l.selecionada).length}, entraram ${c.entraram}`);
        const prox = caso.segundo ? gravar(caso, caso.segundo.arquivo) : arq;
        const r2 = await importarArquivo(page, prox, caso.opcoes || {});
        if (r2.erroTela) prob("erro-na-segunda-importacao", r2.erroTela.slice(0, 200));
        else {
          const novasLidas = r2.previa.linhas.filter((l) => l.selecionada);
          const novasEsp = caso.segundo ? caso.segundo.novas : [];
          const k = (l) => `${l.data}|${l.sinal ? assinado(l) : Math.round(l.valor * 100)}`;
          const dup = diferenca(multiset(novasLidas, k), multiset(novasEsp, k)), perdeu = diferenca(multiset(novasEsp, k), multiset(novasLidas, k));
          if (dup.length) prob(caso.segundo ? "duplicou-no-periodo-maior" : "duplicou-ao-reimportar", JSON.stringify(dup.slice(0, 4)));
          if (perdeu.length) prob("nova-linha-escondida-como-duplicada", JSON.stringify(perdeu.slice(0, 4)));
        }
      }
    }
    if (erros.length) prob("erro-de-javascript", erros.slice(0, 2).join(" | ").slice(0, 300));
  } finally { await ctx.close(); }
  return problemas;
}

const SO = arg("so", "") ? new Set(arg("so").split(",")) : null; // repetir só alguns casos de um relatório
const casos = gerarCasos(SEMENTE, N).filter((c) => !SO || SO.has(c.id));
const servidor = await iniciarServidor(), browser = await abrirNavegador();
const resultados = [];
const t0 = Date.now();
for (const caso of casos) {
  let problemas;
  try { problemas = await rodarCaso(browser, servidor.base, caso); }
  catch (e) { problemas = [{ regra: "falha-do-teste", detalhe: String(e.message).split("\n")[0] }]; }
  resultados.push({ id: caso.id, formato: caso.formato, variante: caso.variante, problemas });
  if (problemas.length) process.stdout.write("x"); else process.stdout.write(".");
}
await browser.close(); servidor.srv.close();

const porRegra = {};
for (const r of resultados) for (const p of r.problemas) {
  const k = `${r.formato} · ${p.regra}`;
  (porRegra[k] ||= { casos: 0, variantes: {}, exemplos: [] }).casos++;
  porRegra[k].variantes[r.variante] = (porRegra[k].variantes[r.variante] || 0) + 1;
  if (porRegra[k].exemplos.length < 3) porRegra[k].exemplos.push({ id: r.id, variante: r.variante, detalhe: p.detalhe });
}
const resumo = { semente: SEMENTE, casos: casos.length, comProblema: resultados.filter((r) => r.problemas.length).length, segundos: Math.round((Date.now() - t0) / 1000), porRegra };
fs.writeFileSync(path.join(SAIDA, "relatorio.json"), JSON.stringify({ resumo, resultados }, null, 1));
console.log(`\n${resumo.comProblema}/${casos.length} casos com problema em ${resumo.segundos}s. Relatório: ${path.join(SAIDA, "relatorio.json")}`);
for (const [k, v] of Object.entries(porRegra).sort((a, b) => b[1].casos - a[1].casos)) {
  console.log(`\n## ${k}: ${v.casos} caso(s)  variantes ${JSON.stringify(v.variantes)}`);
  v.exemplos.forEach((e) => console.log(`   ${e.id} [${e.variante}] ${e.detalhe}`));
}
