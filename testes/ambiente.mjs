// Ambiente dos testes: serve o painel em http://127.0.0.1 e abre um Chromium controlado por robô.
// Nada sai para a internet: as bibliotecas do CDN vêm de node_modules e qualquer outro endereço
// externo (Supabase, fontes, OCR) é bloqueado. Os testes nunca tocam nos dados reais.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, "..");
const NM = path.join(AQUI, "node_modules");

// Endereços de CDN que o index.html usa → arquivo local equivalente (mesma versão do package.json).
const CDN = {
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js": "pdfjs-dist/build/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js": "@supabase/supabase-js/dist/umd/supabase.js",
};

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

export function iniciarServidor() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const arq = path.join(RAIZ, path.normalize(rel));
    if (!arq.startsWith(RAIZ + path.sep) || arq.includes(`${path.sep}testes${path.sep}`) || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) {
      res.writeHead(404); res.end("não encontrado"); return;
    }
    res.writeHead(200, { "content-type": TIPOS[path.extname(arq)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

export async function abrirNavegador() {
  const opts = {};
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

// Abre o painel numa aba limpa (sem dados salvos) e junta os erros de JavaScript da página.
export async function abrirPainel(browser, base) {
  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Boa_Vista" });
  const erros = [];
  const bloqueados = new Set();
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (CDN[u]) return route.fulfill({ path: path.join(NM, CDN[u]), contentType: "text/javascript" });
    bloqueados.add(new URL(u).host);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erros.push(`erro de JavaScript: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(t)) return; // endereços externos bloqueados de propósito
    erros.push(`console.error: ${t}`);
  });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => !!window.__genesisTeste);
  await page.waitForLoadState("networkidle");
  return { ctx, page, erros, bloqueados };
}

// Manda um arquivo pelo mesmo campo que a pessoa usa ("Importar extrato ou fatura").
const NOMES_BANCO = { "banco-do-brasil": "Banco do Brasil", nubank: "Nubank", caixa: "Caixa" };

export async function importarArquivo(page, arquivo, opcoes = {}) {
  await page.evaluate(() => { if (location.hash !== "#importar") location.hash = "#importar"; });
  await page.waitForSelector("#pdfDropzone", { state: "visible" });
  await page.evaluate(() => window.__genesisTeste.limparPrevia()); // senão a prévia anterior parece a nova
  if (arquivo.endsWith(".linhas.json")) {
    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    await page.evaluate((d) => d.paginas ? window.__genesisTeste.importarPaginas(d.paginas, d.linhas) : window.__genesisTeste.importarLinhas(d.linhas), dados);
  } else {
    await page.setInputFiles("#pdfFileInput", arquivo);
  }
  // espera a prévia, uma mensagem de erro ou a tela "quais colunas são o quê" (CSV/Excel)
  const pronto = () => {
    const e = document.getElementById("importErro");
    return (e && !e.hidden && e.textContent.trim()) || window.__genesisTeste.previa().linhas.length > 0 || !!document.getElementById("mapLer") || !!document.getElementById("ofxSaldoOk");
  };
  await page.waitForFunction(pronto, null, { timeout: 30000 });
  if (await page.$("#ofxSaldoOk")) {
    // OFX sem lançamentos: o painel oferece registrar só o saldo
    const soSaldo = await page.evaluate(() => document.querySelector("#importMapa p")?.textContent.trim() || "");
    return { erroTela: null, soSaldo, previa: await page.evaluate(() => window.__genesisTeste.previa()) };
  }
  if (await page.$("#mapLer")) {
    // CSV/Excel: aceita as colunas que o painel sugeriu, como a pessoa faria; só preenche o banco se vier vazio
    const banco = opcoes.banco || NOMES_BANCO[path.basename(path.dirname(arquivo))] || path.basename(path.dirname(arquivo));
    if (!(await page.inputValue("#mapBanco"))) await page.fill("#mapBanco", banco);
    if (opcoes.tipo) await page.selectOption("#mapTipo", opcoes.tipo);
    await page.click("#mapLer");
    await page.waitForFunction(() => {
      const e = document.getElementById("importErro"), m = document.getElementById("mapErros");
      return (e && !e.hidden && e.textContent.trim()) || (m && !m.hidden) || window.__genesisTeste.previa().linhas.length > 0;
    }, null, { timeout: 30000 });
    const errMapa = await page.evaluate(() => { const m = document.getElementById("mapErros"); return m && !m.hidden ? m.textContent.trim() : null; });
    if (errMapa) return { erroTela: errMapa, previa: await page.evaluate(() => window.__genesisTeste.previa()) };
  }
  const erroTela = await page.evaluate(() => { const e = document.getElementById("importErro"); return e && !e.hidden ? e.textContent.trim() : null; });
  const previa = await page.evaluate(() => window.__genesisTeste.previa());
  return { erroTela, previa };
}

// Responde os avisos da prévia como a pessoa costuma responder: transferência para o próprio nome = sim,
// "é pagamento de fatura?" = não (não há fatura no painel de teste).
export async function responderAvisos(page) {
  for (let i = 0; i < 100; i++) {
    const b = await page.$('[data-act="prop-ok"], [data-act="pag-no"]');
    if (!b) return;
    await b.click();
  }
}
