// Resumo do mês (passo 5), sem nuvem: a Edge Function é trocada por uma função falsa.
// Confere o fechamento que o app calcula, o quadro no Início e que nenhuma descrição vai para a IA.
// Números inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boa_Vista" }).format(new Date());
const mudar = (ym, n) => { let [y, m] = ym.split("-").map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, "0")}`; };
const mes = hoje.slice(0, 7), alvo = mudar(mes, -1), a2 = mudar(mes, -2), a3 = mudar(mes, -3), a4 = mudar(mes, -4);
const dia = (ym, d) => `${ym}-${String(d).padStart(2, "0")}`;
const base = { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu" };
const L = (tipo, valor, d, desc, categoria, x = {}) => ({ ...base, tipo, valor, dataLanc: d, dataEfet: d, descricao: desc, categoria, ...x });
const parc = (ym, n, tot, valor, desc, categoria, id) => L("despesa", valor, dia(ym, 5), `${desc} ${n}/${tot}`, categoria,
  { modalidade: "Crédito", parcela: `${n}/${tot}`, parcelaAtual: n, totalParcelas: tot, idCompra: id, seriesId: id, statusParcela: ym > mes ? "prevista" : undefined });

const LANC = [];
// 3 meses de histórico iguais: salário 5.000; mercado 600; lazer 300; transporte 250; casa 200
for (const m of [a4, a3, a2]) {
  LANC.push(L("receita", 5000, dia(m, 1), "SALARIO FICTICIO", "Salário"));
  LANC.push(L("despesa", 600, dia(m, 3), "MERCADO FICTICIO", "Mercado"));
  LANC.push(L("despesa", 300, dia(m, 8), "CINEMA FICTICIO", "Lazer"));
  LANC.push(L("despesa", 250, dia(m, 9), "POSTO FICTICIO", "Transporte"));
}
LANC.push(L("despesa", 200, dia(a4, 12), "LOJA DE CASA FICTICIA", "Casa"));
// sofá em 3x (termina no mês do fechamento) e celular em 5x (termina no mês atual)
LANC.push(parc(a3, 1, 3, 200, "LOJA SOFA FICTICIA", "Casa", "sofa"), parc(a2, 2, 3, 200, "LOJA SOFA FICTICIA", "Casa", "sofa"), parc(alvo, 3, 3, 200, "LOJA SOFA FICTICIA", "Casa", "sofa"));
[a4, a3, a2, alvo, mes].forEach((m, i) => LANC.push(parc(m, i + 1, 5, 150, "CELULAR FICTICIO", "Eletrônicos", "cel")));
// mês do fechamento: mercado 900 (500 + 400), lazer 100, transporte 250
LANC.push(L("receita", 5000, dia(alvo, 1), "SALARIO FICTICIO", "Salário"));
LANC.push(L("despesa", 500, dia(alvo, 4), "SUPERMERCADO CENTRAL FICTICIO", "Mercado"));
LANC.push(L("despesa", 400, dia(alvo, 20), "MERCADO FICTICIO", "Mercado"));
LANC.push(L("despesa", 100, dia(alvo, 8), "CINEMA FICTICIO", "Lazer"));
LANC.push(L("despesa", 250, dia(alvo, 9), "POSTO FICTICIO", "Transporte"));

async function painel() {
  const p = await abrirPainel(browser, servidor.base);
  await p.page.evaluate(([l, orc]) => { window.__genesisTeste.definirLancamentos(l); window.__genesisTeste.definirOrcamentos(orc); }, [LANC, { Mercado: 800, Lazer: 400 }]);
  return p;
}

test("resumo do mês: fechamento calculado pelo app", async () => {
  const { ctx, page, erros } = await painel();
  try {
    const f = await page.evaluate((ym) => window.__genesisTeste.resumoMesDados(ym), alvo);
    const d = f.dados;
    assert.deepEqual([d.receitas, d.despesas, d.resultado], [5000, 1600, 3400]);
    assert.deepEqual(d.mes_anterior, { receitas: 5000, despesas: 1500, resultado: 3500 });
    assert.deepEqual(d.maiores_categorias, [
      { categoria: "Mercado", valor: 900, media_3_meses: 600 },
      { categoria: "Transporte", valor: 250, media_3_meses: 250 },
      { categoria: "Casa", valor: 200, media_3_meses: 200 },
    ]);
    assert.deepEqual(d.subiram, [{ categoria: "Mercado", valor: 900, media_3_meses: 600, a_mais: 300 }]);
    assert.deepEqual(d.desceram, [{ categoria: "Lazer", valor: 100, media_3_meses: 300, a_menos: 200 }]);
    assert.deepEqual(d.orcamentos, { dentro: 1, estourados: [{ categoria: "Mercado", limite: 800, gasto: 900, passou: 100 }] });
    assert.deepEqual(d.maior_gasto, { valor: 500, categoria: "Mercado", data: dia(alvo, 4) });
    assert.equal(f.local.maior_gasto, "SUPERMERCADO CENTRAL FICTICIO");
    assert.deepEqual(d.parcelas, { no_mes: 350, compras_que_terminaram: 1, deixa_de_sair: 200 });
    assert.deepEqual(d.proximo_mes, { mes, parcelas: 150, contas_previstas: 0, ja_comprometido: 150 });
    assert.equal(d.conferido, undefined); // sem contas conciliáveis, o campo não vai

    const pedido = await page.evaluate((ym) => window.__genesisTeste.resumoMesPedido(ym), alvo);
    assert.equal(pedido.recurso, "resumo_mensal");
    assert.equal(pedido.resumo.mes, alvo);
    assert.equal(pedido.resumo.categorias.Mercado, 900);
    assert.equal(pedido.resumo.categorias.Lazer, 100);
    const json = JSON.stringify(pedido);
    for (const desc of ["SUPERMERCADO", "SOFA", "CELULAR", "SALARIO", "FICTICI"]) assert.ok(!json.includes(desc), `descrição "${desc}" não pode ir para a IA`);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("resumo do mês: quadro no Início e carta escrita pelo copiloto falso", async () => {
  const { ctx, page, erros } = await painel();
  try {
    await page.evaluate((d) => { const el = document.getElementById("refDate"); el.value = d; el.dispatchEvent(new Event("change", { bubbles: true })); }, dia(alvo, 15));
    const card = page.locator("#resumoMesCard");
    await card.waitFor({ state: "visible" });
    const txt = await card.innerText();
    assert.match(txt, /Fechamento de /);
    assert.match(txt, /SUPERMERCADO CENTRAL FICTICIO/); // descrição só na tela
    assert.match(txt, /passou R\$\s?100,00/);
    assert.match(txt, /LOJA SOFA FICTICIA 3\/3/);
    assert.equal(await card.locator('[data-rmes="escrever"]').count(), 0, "sem copiloto, sem botão");

    const pedidos = [];
    await page.exposeFunction("guardarPedido", (p) => { pedidos.push(p); });
    await page.evaluate(() => window.__genesisTeste.ligarChat((corpo) => { window.guardarPedido(corpo);
      return { ok: true, texto: "O mês fechou com R$ 3.400,00 de sobra.\n\nMercado passou do limite em R$ 100,00.\n\nO sofá acabou: R$ 200,00 a menos por mês." }; }));
    await card.locator('[data-rmes="escrever"]').click();
    await card.locator(".ia-caixa").waitFor();
    const carta = await card.locator(".ia-caixa").innerText();
    assert.match(carta, /fechou com R\$ 3\.400,00/);
    assert.match(carta, /Texto escrito por IA/);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].recurso, "resumo_mensal");
    assert.equal(pedidos[0].resumo.fechamento.resultado, 3400);
    assert.ok(!JSON.stringify(pedidos[0]).includes("FICTICI"));
    assert.equal(await card.locator('[data-rmes="escrever"]').count(), 0, "depois da carta, o botão some");

    // mês mais antigo escolhido no seletor: números aparecem, mas sem carta (uma por mês, só do mês que acabou)
    await page.evaluate((d) => { const el = document.getElementById("refDate"); el.value = d; el.dispatchEvent(new Event("change", { bubbles: true })); }, dia(a2, 15));
    await page.waitForFunction(() => /Fechamento de /.test(document.getElementById("resumoMesT").textContent) && !document.querySelector("#resumoMesCard .ia-caixa"));
    assert.equal(await card.locator('[data-rmes="escrever"]').count(), 0);
    assert.match(await card.innerText(), /uma vez por mês, só para o mês que acabou/);
    assert.equal(pedidos.length, 1);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
