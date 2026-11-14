// Início do visual v7: "Você pode gastar hoje", card do Gen, Gastos do mês e "Fica de olho".
// Tudo é só interface sobre números que o app já calcula; aqui conferimos as contas na tela. Dados inventados.
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
const dia = (d) => `${mes}-${String(d).padStart(2, "0")}`;
const base = { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu", tipo: "despesa" };
const brl = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const limpo = (t) => t.replace(/\s+/g, " ").trim();

async function painel(lancamentos, saldo, orcamentos) {
  const p = await abrirPainel(browser, servidor.base);
  await p.page.evaluate(([l, s, o]) => {
    const t = window.__genesisTeste;
    t.definirLancamentos(l);
    if (o) t.definirOrcamentos(o);
    if (s !== null) t.informarSaldo("manual|conta teste", "Conta teste", s);
  }, [lancamentos, saldo, orcamentos || null]);
  await p.page.evaluate(() => { location.hash = "#inicio"; });
  return p;
}
const dados = (page) => page.evaluate(() => window.__genesisTeste.previsaoDados());

test("gastar hoje = previsão ÷ dias que faltam (contando hoje), arredondado para baixo", async () => {
  const l = [{ ...base, valor: 300, dataLanc: dia(1), dataEfet: dia(1), descricao: "MERCADO TESTE", categoria: "Mercado" }];
  const { ctx, page, erros } = await painel(l, 2000);
  try {
    const d = await dados(page);
    const faltam = ultimoDia - diaHoje + 1;
    const esperado = d.previsao > 0 ? Math.floor(d.previsao / faltam) : 0;
    assert.equal(limpo(await page.locator("#heroCard .gh-valor").innerText()), "R$ " + brl(esperado));
    assert.match(limpo(await page.locator("#heroCard .gh-selo").innerText()), /^no azul até \d\d\/\d\d$/);
    assert.match(limpo(await page.locator("#heroCard .gh-frase").innerText()), new RegExp("termina o mês com R\\$ " + brl(d.previsao).replace(".", "\\.") + " sobrando"));
    assert.equal(await page.locator("#heroCard .gh-mes i").count(), ultimoDia);
    assert.equal(await page.locator("#heroCard .gh-mes i.hoje").count(), 1);
    // a Previsão de sempre continua no cartão
    assert.match(await page.locator("#heroCard").innerText(), /Previsão para/);
    // Gastos do mês: total e a categoria com a parte do total
    assert.match(limpo(await page.locator("#gastosIniCard").innerText()), /R\$ 300,00[\s\S]*Mercado R\$ 300,00 · 100%/);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("previsão negativa: R$ 0 por dia, selo de atenção, Gen em alerta e aviso no Fica de olho", async () => {
  const l = [{ ...base, valor: 900, dataLanc: dia(1), dataEfet: dia(1), descricao: "ALUGUEL TESTE", categoria: "Casa" }];
  const { ctx, page, erros } = await painel(l, -500);
  try {
    assert.ok((await dados(page)).previsao < 0);
    assert.equal(limpo(await page.locator("#heroCard .gh-valor").innerText()), "R$ 0,00");
    assert.match(await page.locator("#heroCard .gh-selo").getAttribute("class"), /alerta/);
    assert.match(await page.locator("#genCard svg.gen").getAttribute("class"), /gen--alert/);
    assert.match(await page.locator("#olhoCorpo").innerText(), /previsão do mês ficou em/);
    await page.locator("#olhoCorpo button").click();
    assert.equal(await page.evaluate(() => location.hash), "#planejamento");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("orçamento estourado aparece no Fica de olho; sem nada urgente, o card fica calmo", async () => {
  const l = [{ ...base, valor: 250, dataLanc: dia(1), dataEfet: dia(1), descricao: "MERCADO TESTE", categoria: "Mercado" }];
  const { ctx, page, erros } = await painel(l, 5000, { Mercado: 100 });
  try {
    assert.match(limpo(await page.locator("#olhoCorpo").innerText()), /Mercado passou R\$ 150,00 da meta de R\$ 100,00/);
    await page.evaluate(() => window.__genesisTeste.definirOrcamentos({}));
    assert.match(await page.locator("#olhoCorpo").innerText(), /Nada pedindo atenção/);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("Gen: sem o chat liberado abre o lançamento; com o chat, leva até a pergunta", async () => {
  const { ctx, page, erros } = await painel([], 1000);
  try {
    assert.match(await page.locator("#genPerguntar").innerText(), /Lança:/);
    await page.click("#genFab");
    await page.waitForSelector("#v5Drawer.on");
    await page.keyboard.press("Escape");
    await page.evaluate(() => { location.hash = "#analises"; });
    await page.evaluate(() => window.__genesisTeste.ligarChat(() => ({ ok: true, texto: "ok" })));
    await page.click("#genFab");
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "chatPergunta");
    assert.equal(await page.evaluate(() => location.hash), "#inicio");
    assert.match(await page.locator("#genPerguntar").innerText(), /Pergunte qualquer coisa ao Gen/);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
