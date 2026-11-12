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

// ---- Sem data certa: o que falta dos orçamentos, um pouco por dia, no Fluxo de caixa, no Simulador e no gráfico do saldo ----

test("o que falta é espalhado de hoje até o último dia, e a soma fecha nos centavos", async () => {
  const l = [{ ...base, tipo: "despesa", valor: 100, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "POSTO", categoria: "Transporte" }];
  const { ctx, page, erros } = await painel(l, 1000);
  try {
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Transporte: 400.01 }));
    const r = await page.evaluate(() => ({ dias: window.__genesisTeste.orcamentoPorDia(), res: window.__genesisTeste.reservaOrcamentos() }));
    const datas = Object.keys(r.dias).sort();
    assert.equal(r.res.total, 300.01);
    assert.equal(datas[0], hoje);
    assert.equal(datas[datas.length - 1], dia(mes, ultimoDia));
    assert.equal(datas.length, ultimoDia - diaHoje + 1);
    assert.equal(c2(Object.values(r.dias).reduce((a, b) => a + b, 0)), 300.01);
    const vals = Object.values(r.dias);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 0.011, "dias com valores quase iguais");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("Fluxo de caixa e gráfico do saldo terminam o mês igual à Previsão; hoje o gráfico continua no saldo real", { skip: diaFuturo ? false : "hoje é o último dia do mês" }, async () => {
  const l = [
    { ...base, tipo: "despesa", valor: 100, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "POSTO", categoria: "Transporte" },
    { ...base, tipo: "despesa", valor: 250, dataLanc: dia(mes, diaFuturo), dataEfet: dia(mes, diaFuturo), descricao: "ALUGUEL", categoria: "Moradia" },
    { ...base, tipo: "receita", valor: 700, dataLanc: dia(mes, ultimoDia), dataEfet: dia(mes, ultimoDia), descricao: "FREELA", categoria: "Renda extra" },
  ];
  const { ctx, page, erros } = await painel(l, 1161);
  try {
    const sem = await page.evaluate(() => ({ f: window.__genesisTeste.fluxo(), g: window.__genesisTeste.graficoSaldo(), p: window.__genesisTeste.previsaoDados() }));
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Transporte: 400, delivery: 120 }));
    const com = await page.evaluate(() => ({ f: window.__genesisTeste.fluxo(), g: window.__genesisTeste.graficoSaldo(), p: window.__genesisTeste.previsaoDados() }));
    assert.equal(com.p.reservado_orcamentos, 420);
    assert.equal(com.p.previsao, c2(1161 - 250 + 700 - 420));
    assert.equal(c2(sem.f.saldoNoFim - com.f.saldoNoFim), 420);
    assert.equal(com.f.saldoNoFim, com.p.previsao, "Fluxo termina o mês igual à Previsão");
    assert.equal(com.f.dados.orcamentos_espalhados, 420);
    assert.equal(c2(com.f.orcamento.reduce((a, e) => a + e.valor, 0)), 420);
    assert.equal(c2(sem.g[ultimoDia] - com.g[ultimoDia]), 420, "gráfico: fim do mês desce o que falta");
    assert.equal(com.g[diaHoje], sem.g[diaHoje], "gráfico: hoje continua no saldo real");
    assert.equal(com.g[diaHoje], 1161);
    // Na tela do Fluxo, o dia mostra a etiqueta própria.
    assert.ok(com.f.orcamento.every((e) => e.data >= hoje && e.data <= dia(mes, ultimoDia)));
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("sugestão pela média dos últimos 3 meses: conta só meses com dados, ignora categoria que já tem orçamento e preenche o formulário", async () => {
  const m = (k) => { let [y, mm] = mes.split("-").map(Number); mm -= k; while (mm < 1) { mm += 12; y--; } return `${y}-${String(mm).padStart(2, "0")}`; };
  const l = [
    { ...base, tipo: "despesa", valor: 300, dataLanc: dia(m(1), 3), dataEfet: dia(m(1), 3), descricao: "POSTO", categoria: "Transporte" },
    { ...base, tipo: "despesa", valor: 200, dataLanc: dia(m(2), 3), dataEfet: dia(m(2), 3), descricao: "POSTO", categoria: "Transporte" },
    { ...base, tipo: "estorno", valor: 50, dataLanc: dia(m(2), 4), dataEfet: dia(m(2), 4), descricao: "ESTORNO", categoria: "Transporte" },
    { ...base, tipo: "despesa", valor: 900, dataLanc: dia(m(1), 5), dataEfet: dia(m(1), 5), descricao: "MERCADO", categoria: "Mercado" },
    { ...base, tipo: "despesa", valor: 999, dataLanc: dia(m(4), 5), dataEfet: dia(m(4), 5), descricao: "ANTIGO", categoria: "Lazer" }, // fora dos 3 meses
    { ...base, tipo: "despesa", valor: 80, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "ESTE MES", categoria: "Lazer" }, // mês atual não entra
  ];
  const { ctx, page, erros } = await painel(l, 1000);
  try {
    const media = await page.evaluate(() => window.__genesisTeste.mediaTresMeses());
    assert.deepEqual(media, { Transporte: 225, Mercado: 450 }); // 2 meses com dados: (300+200−50)/2 e 900/2
    await page.evaluate(() => { location.hash = "#planejamento"; });
    const sug = page.locator("#budgetSugestoes");
    assert.match(await sug.innerText(), /Mercado R\$\s?450,00[\s\S]*Transporte R\$\s?225,00/);
    await sug.locator('[data-sug-cat="Transporte"]').click();
    assert.equal(await page.locator("#budgetCategoria").inputValue(), "Transporte");
    assert.equal(await page.locator("#budgetLimite").inputValue(), "225.00");
    await page.locator("#budgetForm button[type=submit]").click();
    assert.doesNotMatch(await sug.innerText(), /Transporte/, "categoria com orçamento sai das sugestões");
    // Digitar uma categoria mostra a média como dica no campo do limite.
    await page.locator("#budgetCategoria").fill("Mercado");
    assert.match(await page.locator("#budgetLimite").getAttribute("placeholder"), /Média de 3 meses: R\$\s?450,00/);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("aviso de ritmo: aparece quando o gasto até hoje projeta passar do limite, some quando já estourou", { skip: diaHoje >= 5 ? false : "antes do dia 5 não há aviso de ritmo" }, async () => {
  // Gasto até hoje = 60% do limite: no ritmo, passa do limite se 0,6 × dias do mês / dia de hoje > 1.
  const limite = 1000, gasto = 600, proj = c2(gasto / diaHoje * ultimoDia);
  const l = [
    { ...base, tipo: "despesa", valor: gasto, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "POSTO", categoria: "Transporte" },
    { ...base, tipo: "despesa", valor: 1200, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "MERCADO", categoria: "Mercado" },
  ];
  const { ctx, page, erros } = await painel(l, 1000);
  try {
    await page.evaluate(([limite]) => window.__genesisTeste.definirOrcamentos({ Transporte: limite, Mercado: 1000 }), [limite]);
    const txt = await page.locator("#budgetList").innerText();
    if (proj > limite) assert.match(txt, /No ritmo atual, chega a/);
    else assert.doesNotMatch(txt, /No ritmo atual/);
    assert.match(txt, /excedido em R\$\s?200,00/);
    assert.equal((txt.match(/No ritmo atual/g) || []).length, proj > limite ? 1 : 0, "Mercado estourado não ganha aviso de ritmo");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("300 casos sorteados: Fluxo e gráfico descem exatamente o que falta dos orçamentos", async () => {
  const rnd = sorteador(777);
  const CATS = ["Transporte", "Mercado", "delivery", "Lazer"];
  const casos = [];
  for (let n = 0; n < 300; n++) {
    const l = [];
    const qtd = Math.floor(rnd() * 12);
    for (let i = 0; i < qtd; i++) {
      const r = rnd(), tipo = r < 0.65 ? "despesa" : r < 0.75 ? "estorno" : "receita";
      const d = 1 + Math.floor(rnd() * ultimoDia);
      l.push({ ...base, tipo, valor: c2(1 + rnd() * 700), dataLanc: dia(mes, d), dataEfet: dia(mes, d), descricao: "L" + i,
        categoria: tipo === "receita" ? "Salário" : CATS[Math.floor(rnd() * CATS.length)] });
    }
    const orc = {};
    CATS.forEach((c) => { if (rnd() < 0.6) orc[c] = c2(rnd() * 1200); });
    casos.push({ l, orc, saldo: c2(rnd() * 5000 - 500) });
  }
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    const res = await page.evaluate((casos) => casos.map((c) => {
      const t = window.__genesisTeste;
      t.definirOrcamentos({}); t.definirLancamentos(c.l); t.informarSaldo("manual|conta teste", "Conta teste", c.saldo);
      const f0 = t.fluxo(), g0 = t.graficoSaldo();
      t.definirOrcamentos(c.orc);
      const f1 = t.fluxo(), g1 = t.graficoSaldo(), p = t.previsaoDados();
      return { falta: p.reservado_orcamentos || 0, df: f0.saldoNoFim - f1.saldoNoFim, dg: g0[g0.length - 1] - g1[g1.length - 1],
        soma: f1.orcamento.reduce((a, e) => a + e.valor, 0) };
    }), casos);
    res.forEach((r, i) => {
      assert.equal(c2(r.df), r.falta, `caso ${i}: fluxo`);
      assert.equal(c2(r.dg), r.falta, `caso ${i}: gráfico`);
      assert.equal(c2(r.soma), r.falta, `caso ${i}: soma dos dias`);
    });
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("Lançamentos: partes como no app do banco (planejado, à vista, parcelas, entradas, transferências) e filtros", async () => {
  const l = [
    { ...base, tipo: "despesa", valor: 46, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "EMPORIO FICTICIO", categoria: "Mercado" },
    { ...base, tipo: "estorno", valor: 6, dataLanc: dia(mes, diaPassado), dataEfet: dia(mes, diaPassado), descricao: "ESTORNO FICTICIO", categoria: "Mercado" },
    { ...base, tipo: "despesa", modalidade: "Crédito", valor: 383.71, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "LOJA FICTICIA", categoria: "Compras",
      parcela: "4/5", parcelaAtual: 4, totalParcelas: 5, idCompra: "k1", seriesId: "k1" },
    { ...base, tipo: "receita", valor: 3000, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "SALARIO FICTICIO", categoria: "Salário" },
    { ...base, tipo: "transferencia_interna", valor: 299, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "POUPANCA FICTICIA", categoria: "Transferência interna" },
    { ...base, tipo: "despesa", valor: 572.66, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "POSTO FICTICIO", categoria: "Transporte" },
  ];
  const { ctx, page, erros } = await painel(l, 1000);
  try {
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({ Transporte: 872.66, Mercado: 100 }));
    await page.evaluate(() => { location.hash = "#lancamentos"; });
    const ver = page.locator("#btnLedgerToggle");
    if (await ver.isVisible()) await ver.click();
    const grupos = await page.locator("#ledgerBody tr.ledger-grupo td").allInnerTexts();
    assert.deepEqual(grupos.map((g) => g.split(" · ")[0]),
      ["Planejado nos orçamentos", "Compras e contas à vista", "Parcelas", "Entradas", "Transferências e pagamentos de fatura"]);
    assert.match(grupos[0], /· 2/); assert.match(grupos[0], /-R\$\s?360,00/); // 300 do Transporte + 60 do Mercado (100 − 46 + 6)
    assert.match(grupos[1], /· 3/); // 2 compras e o estorno
    assert.match(grupos[2], /-R\$\s?383,71/);
    const plan = await page.locator("#ledgerBody tr.ledger-plan").allInnerTexts();
    assert.equal(plan.length, 2);
    assert.match(plan.join("\n"), /Planejado[\s\S]*Ainda falta gastar em Mercado[\s\S]*limite R\$\s?100,00 · gasto até agora R\$\s?40,00/);
    assert.match(await page.locator("#ledgerCount").innerText(), /2 planejados/);
    // Filtro "Realizado" e busca escondem o planejado; categoria filtra.
    await page.selectOption("#fStatus", "realizado");
    assert.equal(await page.locator("#ledgerBody tr.ledger-plan").count(), 0);
    await page.selectOption("#fStatus", "");
    await page.selectOption("#fCategoria", "Transporte");
    assert.equal(await page.locator("#ledgerBody tr.ledger-plan").count(), 1);
    await page.selectOption("#fCategoria", "");
    // Mês passado: nada planejado.
    await page.fill("#fMes", ant); await page.locator("#fMes").dispatchEvent("change");
    assert.equal(await page.locator("#ledgerBody tr.ledger-plan").count(), 0);
    // "Ver orçamento" leva ao Planejamento.
    await page.fill("#fMes", mes); await page.locator("#fMes").dispatchEvent("change");
    await page.locator("[data-plan-ver]").first().click();
    assert.equal(await page.evaluate(() => location.hash), "#planejamento");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
