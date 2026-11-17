// Revisão de segurança: o painel não abre dentro de outro site (clickjacking) e o login
// não diz se um e-mail tem conta. O Supabase é simulado; nada sai para a internet.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

test("dentro de outro site (iframe) o painel não aparece: sai do quadro ou fica escondido", async () => {
  const ctx = await browser.newContext();
  try {
    await ctx.route("**/*", (r) => r.request().url().startsWith(servidor.base) ? r.continue() : r.abort("blockedbyclient"));
    const page = await ctx.newPage();
    const quadro = (extra) => `<iframe id="f" ${extra} src="${servidor.base}/index.html" width="800" height="600"></iframe>`;
    // 1. quadro comum: o painel abre por inteiro, no lugar da página de fora
    await page.route(servidor.base + "/fora.html", (r) => r.fulfill({ contentType: "text/html", body: quadro("") }));
    await page.goto(servidor.base + "/fora.html");
    await page.waitForURL(servidor.base + "/index.html");
    // 2. quadro que proíbe sair (sandbox): o painel fica escondido
    await page.route(servidor.base + "/fora2.html", (r) => r.fulfill({ contentType: "text/html", body: quadro('sandbox="allow-scripts allow-same-origin"') }));
    await page.goto(servidor.base + "/fora2.html");
    const frame = await (await page.waitForSelector("#f")).contentFrame();
    await frame.waitForLoadState("domcontentloaded");
    assert.equal(page.url(), servidor.base + "/fora2.html");
    assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).display), "none");
    // aberto direto, aparece normalmente
    await page.goto(servidor.base + "/index.html");
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).display), "none");
  } finally { await ctx.close(); }
});

async function tentar(page, modo, erroDoServidor, status = 400) {
  await page.route("**/auth/v1/**", (r) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(erroDoServidor) }));
  await page.evaluate((m) => {
    document.querySelector(`.auth-tab[data-mode="${m}"]`).click();
    document.getElementById("authEmail").value = "pessoa@exemplo.com";
    document.getElementById("authPassword").value = "senha-de-teste-123";
    const a = document.getElementById("authAceite"); if (a) a.checked = true;
    document.getElementById("authForm").requestSubmit();
  }, modo);
  await page.waitForFunction(() => /error/.test(document.getElementById("authStatus").className) && document.getElementById("authStatus").textContent.trim());
  const t = await page.locator("#authStatus").textContent();
  await page.unroute("**/auth/v1/**");
  return t;
}

test("login: mesma mensagem para senha errada e e-mail não confirmado", async () => {
  const { ctx, page } = await abrirPainel(browser, servidor.base);
  try {
    const senhaErrada = await tentar(page, "login", { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
    const naoConfirmado = await tentar(page, "login", { error: "invalid_grant", error_description: "Email not confirmed", code: "email_not_confirmed", msg: "Email not confirmed" });
    assert.equal(senhaErrada, naoConfirmado);
    assert.doesNotMatch(senhaErrada, /not confirmed|Invalid|existe|cadastrad/i);
    const jaExiste = await tentar(page, "signup", { code: "user_already_exists", msg: "User already registered" }, 422);
    assert.doesNotMatch(jaExiste, /already|registered|já existe/i);
    const muitos = await tentar(page, "login", { code: "over_request_rate_limit", msg: "Request rate limit reached" }, 429);
    assert.match(muitos, /Muitas tentativas/);
  } finally { await ctx.close(); }
});
