// Lançamento à mão no crédito pergunta o cartão (final e dias da fatura), para a compra entrar na fatura certa.
// Cartões e números inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const CARTOES = {
  "banco do brasil|1111": { banco: "Banco do Brasil", final: "1111", fechamento: 17, vencimento: 26 },
  "banco do brasil|2222": { banco: "Banco do Brasil", final: "2222", fechamento: 3, vencimento: 10 },
  "nubank|3333": { banco: "Nubank", final: "3333", fechamento: 8, vencimento: 15 },
};
const valor = (page, id, v) => page.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === "SELECT" ? "change" : "input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);

test("crédito: escolhe o cartão pelo final e dias da fatura, e a data vira o vencimento", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((c) => { const t = window.__genesisTeste; t.definirLancamentos([]); t.definirCartoes(c); }, CARTOES);
    await page.click("#v5New");
    await valor(page, "txModalidade", "Débito");
    assert.equal(await page.locator("#campoCartao").isHidden(), true, "fora do crédito o campo some");
    await valor(page, "txModalidade", "Crédito");
    await valor(page, "txBanco", "Banco do Brasil");
    const opcoes = await page.locator("#txCartao option").allInnerTexts();
    assert.deepEqual(opcoes, ["Não sei / outro cartão", "Banco do Brasil final 1111 · fecha dia 17 · vence dia 26", "Banco do Brasil final 2222 · fecha dia 3 · vence dia 10"]);
    assert.equal(await page.inputValue("#txCartao"), "", "dois cartões do banco: a pessoa escolhe");
    await valor(page, "txDataLanc", "2026-03-20");
    await valor(page, "txCartao", "banco do brasil|1111");
    assert.equal(await page.inputValue("#txDataEfet"), "2026-04-26", "compra depois do fechamento (17) vai para a fatura que vence 26/04");
    await valor(page, "txCartao", "banco do brasil|2222");
    assert.equal(await page.inputValue("#txDataEfet"), "2026-04-10");
    await valor(page, "txValor", "50");
    await valor(page, "txDescricao", "COMPRA FICTICIA");
    await valor(page, "txCategoria", "Compras");
    await page.click("#txFormSubmitBtn");
    const l = await page.evaluate(() => window.__genesisTeste.lancamentos());
    const t = l.find((x) => x.descricao === "COMPRA FICTICIA");
    assert.equal(t.cartao, "banco do brasil|2222");
    assert.equal(t.dataEfet, "2026-04-10");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("crédito: com um só cartão do banco ele já vem escolhido; data digitada à mão é respeitada", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((c) => { const t = window.__genesisTeste; t.definirLancamentos([]); t.definirCartoes(c); }, CARTOES);
    await page.click("#v5New");
    await valor(page, "txModalidade", "Crédito");
    await valor(page, "txDataEfet", "2026-05-02");
    await valor(page, "txBanco", "Nubank");
    assert.equal(await page.inputValue("#txCartao"), "nubank|3333");
    assert.equal(await page.inputValue("#txDataEfet"), "2026-05-02");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
