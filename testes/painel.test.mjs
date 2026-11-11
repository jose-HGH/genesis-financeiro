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

test("versão nova no servidor: ao abrir, o painel recarrega sozinho uma vez", async () => {
  const ctx = await browser.newContext();
  try {
    await ctx.route("**/versao.txt*", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "29991231-235959\n" }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort("blockedbyclient"));
    const page = await ctx.newPage();
    await page.goto(`${servidor.base}/index.html`);
    await page.waitForURL(/\?v=29991231-235959/, { timeout: 10000 });
    await page.waitForTimeout(1500);
    assert.match(page.url(), /\?v=29991231-235959/); // não entra em laço de recarregar
  } finally { await ctx.close(); }
});

test("mesma versão no servidor: não recarrega; versão nova com a aba aberta mostra 'Atualizar'", async () => {
  const ctx = await browser.newContext();
  try {
    let versao = null;
    await ctx.route("**/versao.txt*", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: versao || "x" }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort("blockedbyclient"));
    const page = await ctx.newPage();
    await page.goto(`${servidor.base}/index.html`);
    versao = await page.evaluate(() => document.querySelector('meta[name="app-version"]').content);
    await page.waitForTimeout(1000);
    assert.doesNotMatch(page.url(), /\?v=/);
    versao = "29991231-235959";
    await page.evaluate(() => { Date.now = ((n) => () => n() + 120000)(Date.now.bind(Date)); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForSelector("#genesisNovaVersao", { timeout: 5000 });
    assert.doesNotMatch(page.url(), /\?v=/, "com a aba aberta não pode recarregar sozinho");
  } finally { await ctx.close(); }
});
