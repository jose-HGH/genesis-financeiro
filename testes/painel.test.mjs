// O painel abre sem erros e funciona sem internet e sem conta.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

test("o painel abre sem erro de JavaScript", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    assert.equal(await page.title(), "Gênesis Financeiro");
    assert.equal(await page.evaluate(() => typeof pdfjsLib), "object", "leitor de PDF não carregou");
    await page.waitForTimeout(1500); // dá tempo para o que roda depois de abrir
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("a versão no topo do arquivo existe e tem o formato AAAAMMDD-HHMMSS", async () => {
  const { ctx, page } = await abrirPainel(browser, servidor.base);
  try {
    const v = await page.evaluate(() => document.querySelector('meta[name="app-version"]')?.content);
    assert.match(v || "", /^\d{8}-\d{6}$/);
  } finally { await ctx.close(); }
});

test("sem dados salvos, o painel começa sem lançamentos importados", async () => {
  const { ctx, page } = await abrirPainel(browser, servidor.base);
  try {
    const previa = await page.evaluate(() => window.__genesisTeste.previa());
    assert.equal(previa.linhas.length, 0);
  } finally { await ctx.close(); }
});
