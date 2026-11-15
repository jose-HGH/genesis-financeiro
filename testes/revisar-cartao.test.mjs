// "Para revisar": compras no cartão da mesma fatura têm o mesmo vencimento, então o vencimento não pode
// ser o que as faz parecer repetidas. Parcelas de números diferentes também não são repetidas. Dados inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const cc = { banco: "Banco do Brasil", modalidade: "Crédito", classificacao: "Variável", recorrencia: "Única", escopo: "meu", categoria: "Outros", tipo: "despesa" };

test("para revisar: mesma fatura e mesmo valor, compras em dias diferentes, não é repetido; parcela 2/10 e 3/10 também não", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), [
      { ...cc, valor: 35, dataLanc: "2027-03-07", dataEfet: "2027-04-16", descricao: "DROGARIA EXEMPLO BOA VISTA BR" },
      { ...cc, valor: 35, dataLanc: "2027-03-24", dataEfet: "2027-04-16", descricao: "MERCADO EXEMPLO BOA VISTA BR" },
      { ...cc, valor: 826.9, dataLanc: "2026-09-15", dataEfet: "2027-04-16", descricao: "LOJA AR EXEMPLO BOA VISTA BR", parcela: "2/10", parcelaAtual: 2, totalParcelas: 10, statusParcela: "confirmada", idCompra: "c-nova" },
      { ...cc, valor: 826.9, dataLanc: "2026-09-15", dataEfet: "2027-05-16", descricao: "LOJA AR EXEMPLO BOA VISTA BR", parcela: "3/10", parcelaAtual: 3, totalParcelas: 10, statusParcela: "prevista", idCompra: "c-antiga" },
      // repetido de verdade continua aparecendo: mesma compra, mesmo dia, duas vezes
      { ...cc, valor: 50, dataLanc: "2027-03-10", dataEfet: "2027-04-16", descricao: "PADARIA EXEMPLO" },
      { ...cc, valor: 50, dataLanc: "2027-03-10", dataEfet: "2027-04-16", descricao: "PADARIA EXEMPLO" },
    ]);
    await page.waitForFunction(() => /Para revisar/.test(document.getElementById("dupBanner").innerText));
    const t = await page.evaluate(() => document.getElementById("dupBanner").innerText);
    assert.match(t, /1 lançamento\b/);
    assert.match(t, /PADARIA EXEMPLO/);
    assert.doesNotMatch(t, /DROGARIA|MERCADO|LOJA AR/);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
