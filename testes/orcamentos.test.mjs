// Orçamentos descontados da Previsão: o que ainda falta gastar de cada orçamento sai do saldo previsto do mês.
// Números inventados. Confere a conta, que nada é descontado duas vezes (gasto já lançado, previstas)
// e, com centenas de casos sorteados, que a conta sempre fecha sem erro na página.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boa_Vista" }).format(new Date());
const mes = hoje.slice(0, 7);
const diaHoje = Number(hoje.slice(8, 10));
const [ano, mesNum] = mes.split("-").map(Number);
const ultimoDia = new Date(ano, mesNum, 0).getDate();
const ant = mesNum === 1 ? `${ano - 1}-12` : `${ano}-${String(mesNum - 1).padStart(2, "0")}`;
const prox = mesNum === 12 ? `${ano + 1}-01` : `${ano}-${String(mesNum + 1).padStart(2, "0")}`;
const dia = (ym, d) => `${ym}-${String(d).padStart(2, "0")}`;
const c2 = (v) => Math.round(v * 100) / 100;
const base = { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu" };
// Dia já passado (ou hoje) e dia ainda por vir neste mês; no último dia do mês não há dia por vir.
const diaPassado = Math.max(1, diaHoje - 1);
const diaFuturo = diaHoje < ultimoDia ? diaHoje + 1 : null;

async function painel(lancamentos, saldo) {
  const p = await abrirPainel(browser, servidor.base);
  await p.page.evaluate(([l, s]) => {
    const t = window.__genesisTeste;
    t.definirLancamentos(l);
    if (s !== null) t.informarSaldo("manual|conta teste", "Conta teste", s);
  }, [lancamentos, saldo]);
  return p;
}
const dados = (page) => page.evaluate(() => window.__genesisTeste.previsaoDados());

test("orçamento: o que falta gastar sai da Previsão, com a linha nos detalhes e a nota no quadro", async () => {
  const l = [
    { ...base, tipo: "receita", valor: 5000, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "SALARIO", categoria: "Salário" },
    { ...base, tipo: "despesa", valor: 572.66, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "POSTO TESTE", categoria: "Transporte" },
    { ...base, tipo: "despesa", valor: 217, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "IFOOD", categoria: "delivery" },
  ];
  const { ctx, page, erros } = await painel(l, 2000);
  try {
    const antes = await dados(page);
    assert.equal(antes.reservado_orcamentos, undefined, "sem orçamento, nada é descontado");
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Transporte: 1800, delivery: 500 }));
    const d = await dados(page);
    assert.equal(d.reservado_orcamentos, c2(1800 - 572.66 + 500 - 217)); // 1.227,34 + 283,00
    assert.equal(d.previsao_sem_orcamentos, antes.previsao);
    assert.equal(d.previsao, c2(antes.previsao - d.reservado_orcamentos));

    // Na tela: valor novo, nota e, nos detalhes, a linha com cada orçamento.
    const hero = page.locator("#heroCard");
    assert.match(await hero.innerText(), /Já descontando R\$\s?1\.510,34 que ainda falta gastar/);
    await hero.locator('[data-resumo="detalhes"]').click();
    await hero.locator('[data-resumo="orcamentos"]').click();
    const det = await hero.innerText();
    assert.match(det, /Ainda falta gastar nos orçamentos/);
    assert.match(det, /Transporte[\s\S]*1\.227,34/);
    assert.match(det, /delivery[\s\S]*283,00/);
    // Quadro de Orçamentos avisa que o resto já saiu da Previsão.
    assert.match(await page.locator("#budgetList").innerText(), /faltam R\$\s?1\.227,34, já descontados da Previsão/);

    // Tirar o orçamento devolve a Previsão ao valor de antes.
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({}));
    assert.equal((await dados(page)).previsao, antes.previsao);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("orçamento estourado não desconta nada e não fica negativo", async () => {
  const l = [{ ...base, tipo: "despesa", valor: 950, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "POSTO", categoria: "Transporte" }];
  const { ctx, page, erros } = await painel(l, 1000);
  try {
    const antes = (await dados(page)).previsao;
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Transporte: 300 }));
    const d = await dados(page);
    assert.equal(d.reservado_orcamentos, undefined);
    assert.equal(d.previsao, antes);
    assert.doesNotMatch(await page.locator("#heroCard").innerText(), /Já descontando/);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("gasto já lançado para depois de hoje e parcela prevista não são descontados duas vezes", { skip: diaFuturo ? false : "hoje é o último dia do mês" }, async () => {
  const l = [
    { ...base, tipo: "despesa", valor: 100, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "POSTO", categoria: "Transporte" },
    // conta lançada para um dia que ainda vem: já está no "a pagar"
    { ...base, tipo: "despesa", valor: 60, dataLanc: dia(mes, diaFuturo), dataEfet: dia(mes, diaFuturo), descricao: "IPVA", categoria: "Transporte" },
    // parcela prevista: já está nas previstas
    { ...base, tipo: "despesa", modalidade: "Crédito", valor: 40, dataLanc: dia(mes, diaFuturo), dataEfet: dia(mes, diaFuturo), descricao: "PNEU 2/3", categoria: "Transporte",
      parcela: "2/3", parcelaAtual: 2, totalParcelas: 3, idCompra: "p1", seriesId: "p1", statusParcela: "prevista" },
  ];
  const { ctx, page, erros } = await painel(l, 1000);
  try {
    const antes = (await dados(page)).previsao; // 1000 − 60 − 40 = 900
    assert.equal(antes, 900);
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Transporte: 300 }));
    const d = await dados(page);
    assert.equal(d.reservado_orcamentos, 100); // 300 − 100 − 60 − 40
    // No total, sai do saldo exatamente o orçamento do mês ainda não gasto até hoje: 1000 − (300 − 100).
    assert.equal(d.previsao, 800);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("mês passado não desconta; mês seguinte desconta o limite inteiro; estorno devolve ao orçamento", async () => {
  const l = [
    { ...base, tipo: "despesa", valor: 100, dataLanc: dia(ant, 5), dataEfet: dia(ant, 5), descricao: "MERCADO", categoria: "Mercado" },
    { ...base, tipo: "despesa", valor: 250, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "MERCADO", categoria: "Mercado" },
    { ...base, tipo: "estorno", valor: 50, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "ESTORNO", categoria: "Mercado" },
    { ...base, tipo: "receita", valor: 3000, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "SALARIO", categoria: "Salário" },
  ];
  const { ctx, page, erros } = await painel(l, 1500);
  try {
    const antes = (await dados(page)).previsao;
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Mercado: 800, Lazer: 150 }));
    const r = await page.evaluate(([ant, mes, prox]) => {
      const t = window.__genesisTeste;
      return { ant: t.reservaOrcamentos(`${ant}-15`), mes: t.reservaOrcamentos(`${mes}-15`), prox: t.reservaOrcamentos(`${prox}-15`) };
    }, [ant, mes, prox]);
    assert.equal(r.ant.total, 0);
    assert.equal(r.mes.total, 800 - 200 + 150); // estorno de 50 devolve ao Mercado; Lazer sem gasto entra inteiro
    assert.equal(r.prox.total, 950);
    const d = await dados(page);
    assert.equal(d.previsao, c2(antes - 750));
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

// Gerador simples com semente fixa: o mesmo sorteio a cada execução.
function sorteador(semente) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test("400 casos sorteados: Previsão = sem orçamentos − o que falta, conferido por fora, sem erro na página", async () => {
  const rnd = sorteador(20261112);
  const CATS = ["Transporte", "Mercado", "delivery", "Lazer", "Saúde"];
  const casos = [];
  for (let n = 0; n < 400; n++) {
    const l = [];
    const qtd = Math.floor(rnd() * 14);
    for (let i = 0; i < qtd; i++) {
      const r = rnd();
      const tipo = r < 0.62 ? "despesa" : r < 0.72 ? "estorno" : r < 0.9 ? "receita" : "transferencia_interna";
      const ym = rnd() < 0.8 ? mes : rnd() < 0.5 ? ant : prox;
      const d = 1 + Math.floor(rnd() * (ym === mes ? ultimoDia : 28));
      const prevista = tipo === "despesa" && ym === mes && d > diaHoje && rnd() < 0.4;
      l.push({ ...base, tipo, valor: c2(1 + rnd() * 900), dataLanc: dia(ym, d), dataEfet: dia(ym, d), descricao: "LANC " + i,
        categoria: tipo === "receita" ? "Salário" : CATS[Math.floor(rnd() * CATS.length)],
        ...(prevista ? { parcela: "2/4", parcelaAtual: 2, totalParcelas: 4, idCompra: "s" + i, seriesId: "s" + i, statusParcela: "prevista", modalidade: "Crédito" } : {}),
        ...(rnd() < 0.15 ? { pagoManual: rnd() < 0.5 } : {}) });
    }
    const orc = {};
    CATS.forEach((c) => { if (rnd() < 0.5) orc[c] = c2(rnd() * 1500); });
    const saldo = c2(rnd() * 6000 - 1000);
    // Conta esperada feita aqui fora, sem usar o código do painel.
    let falta = 0;
    Object.keys(orc).forEach((c) => {
      let usado = 0;
      l.forEach((t) => {
        if (t.categoria !== c || t.dataEfet.slice(0, 7) !== mes) return;
        if (t.tipo === "despesa") usado += t.valor;
        else if (t.tipo === "estorno") usado -= t.valor;
      });
      falta += Math.max(c2(orc[c] - usado), 0);
    });
    casos.push({ l, orc, saldo, falta: c2(falta) });
  }
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    const res = await page.evaluate((casos) => {
      const t = window.__genesisTeste, out = [];
      casos.forEach((c, i) => {
        t.definirOrcamentos({});
        t.definirLancamentos(c.l);
        t.informarSaldo("manual|conta teste", "Conta teste", c.saldo);
        const sem = t.previsaoDados();
        t.definirOrcamentos(c.orc);
        const com = t.previsaoDados();
        out.push({ i, sem: sem && sem.previsao, com: com && com.previsao, res: com && (com.reservado_orcamentos || 0), semO: com && com.previsao_sem_orcamentos });
      });
      return out;
    }, casos);
    let comSaldo = 0;
    res.forEach((r, i) => {
      const c = casos[i];
      comSaldo++;
      assert.equal(r.res, c.falta, `caso ${i}: falta`);
      assert.equal(r.com, c2(r.sem - c.falta), `caso ${i}: previsão`);
      if (c.falta > 0) assert.equal(r.semO, r.sem, `caso ${i}: previsão sem orçamentos`);
    });
    assert.equal(comSaldo, 400);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
