// Tela de entrada: sem conta conectada o app não abre; entrar fecha a tela. O Supabase é simulado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const USUARIO = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "pessoa@exemplo.com", email_confirmed_at: "2026-11-01T00:00:00Z", app_metadata: {}, user_metadata: {} };

test("sem login aparece só a tela de entrada; Criar conta troca o formulário; entrar abre o app", async () => {
  // liga a tela de entrada também no navegador de teste (fora dele ela já vale sempre)
  const fake = { newContext: async (o) => { const c = await browser.newContext(o); await c.addInitScript(() => { try { sessionStorage.setItem("genesis-porta-teste", "1"); } catch (e) {} }); return c; } };
  const { ctx, page, erros } = await abrirPainel(fake, servidor.base);
  try {
    assert.ok(await page.locator("#portaEntrada").isVisible());
    assert.equal(await page.locator("#v5Nav, #v5Tab").first().isVisible(), false, "o app fica escondido");
    assert.ok(await page.locator("#portaEntrada #authEmail").isVisible());
    assert.ok(await page.locator("#portaEntrada #btnForgot").isVisible());
    await page.click("#portaTrocar");
    assert.equal(await page.locator("#authSubmitBtn").innerText(), "Criar conta");
    assert.ok(await page.locator("#authAceiteLinha").isVisible(), "cadastro pede o aceite dos termos");
    assert.equal(await page.locator("#portaEntrada #btnForgot").isVisible(), false);
    await page.click("#portaTrocar");
    assert.equal(await page.locator("#authSubmitBtn").innerText(), "Entrar");
    await page.click("#portaAjuda");
    assert.match(await page.locator("#portaAjudaTxt").innerText(), /Ver demonstração/);

    // entrar: o servidor (simulado) devolve uma sessão
    await page.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "a.b.c", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: USUARIO }) }));
    await page.fill("#authEmail", USUARIO.email);
    await page.fill("#authPassword", "senha-de-teste-123");
    await page.click("#authSubmitBtn");
    await page.waitForFunction(() => document.getElementById("portaEntrada").hidden);
    assert.equal(await page.evaluate(() => document.body.classList.contains("porta-on")), false);
    assert.equal(await page.evaluate(() => !!document.getElementById("authLoggedOut").closest("#authCard")), true, "o formulário volta para o cartão da conta");
    assert.deepEqual(erros.filter((e) => !/falha ao buscar|Gênesis:/.test(e)), []);
  } finally { await ctx.close(); }
});

test("modo demonstração (/?teste=1) abre direto, sem tela de entrada", async () => {
  const ctx = await browser.newContext({ locale: "pt-BR" });
  try {
    await ctx.addInitScript(() => { try { sessionStorage.setItem("genesis-porta-teste", "1"); } catch (e) {} });
    await ctx.route("**/*", (r) => r.request().url().startsWith(servidor.base) ? r.continue() : r.abort("blockedbyclient"));
    const page = await ctx.newPage();
    await page.goto(servidor.base + "/index.html?teste=1");
    await page.waitForFunction(() => !!window.__genesisTeste);
    assert.equal(await page.locator("#portaEntrada").count(), 0);
  } finally { await ctx.close(); }
});
