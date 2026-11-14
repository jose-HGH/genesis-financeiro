// Celular: o painel usa a largura da tela (sem a linha "viewport", o iPhone mostra a versão de
// computador em miniatura) e nenhuma área passa da largura de um iPhone. Dados inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { iniciarServidor, abrirNavegador, abrirPainel, RAIZ } from "./ambiente.mjs";
import pw from "playwright";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

test("celular: index.html tem doctype e a linha viewport", () => {
  const html = fs.readFileSync(`${RAIZ}/index.html`, "utf8");
  assert.match(html.slice(0, 200), /^<!doctype html>/i);
  assert.match(html.slice(0, 600), /<meta name="viewport" content="width=device-width, initial-scale=1/);
});

test("celular: nenhuma área passa da largura do iPhone", async () => {
  const nc = browser.newContext.bind(browser);
  const fake = { newContext: (o) => nc({ ...o, ...pw.devices["iPhone 13"], deviceScaleFactor: 1 }) };
  const { ctx, page, erros } = await abrirPainel(fake, servidor.base);
  try {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boa_Vista" }).format(new Date()), m = hoje.slice(0, 7);
    const B = { banco: "Banco Ficticio", modalidade: "Crédito", classificacao: "Variável", escopo: "meu", recorrencia: "Única", tipo: "despesa" };
    const L = Array.from({ length: 15 }, (_, i) => ({ ...B, valor: 10 + i * 13.7, dataLanc: `${m}-${String(i + 1).padStart(2, "0")}`, dataEfet: `${m}-${String(i + 1).padStart(2, "0")}`,
      descricao: "LOJA FICTICIA COM NOME BEM COMPRIDO NUMERO " + i, categoria: ["Mercado", "Transporte", "Lazer"][i % 3] }));
    await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), L);
    assert.equal(await page.evaluate(() => innerWidth), 390);
    for (const a of ["inicio", "lancamentos", "importar", "analises", "planejamento", "familia"]) {
      await page.evaluate((a) => { location.hash = "#" + a; }, a);
      await page.waitForTimeout(300);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 390, `${a}: a página rola para o lado (${sw}px)`);
    }
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
