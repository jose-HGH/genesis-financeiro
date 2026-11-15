// Conferência da fatura na tela de importação: "depois de importar, a fatura no app soma o mesmo que o PDF?"
// Mostra o que está sobrando (lançado à mão antes) e o que ficou desmarcado, com botão para corrigir.
// Banco, cartão, nomes e valores inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const cc = { banco: "Banco do Brasil", modalidade: "Crédito", classificacao: "Variável", recorrencia: "Única", escopo: "meu", categoria: "Outros" };
const CARTAO = { "banco do brasil|1234": { key: "banco do brasil|1234", nome: "BB final 1234", banco: "Banco do Brasil", final: "1234", finais: ["1234"], fechamento: 4, vencimento: 16, saved: true } };
const FATURA = [
  "BANCO DO BRASIL", "OUROCARD MASTERCARD Final 1234", "Vencimento", "16/04/2027",
  "Resumo da fatura", "Saldo fatura anterior R$ 500,00", "Pagamentos/Créditos R$ -500,00", "Compras nacionais R$ 400,00",
  "Tarifas, encargos e multas R$ 0,00", "Total R$ 400,00",
  "Lançamentos nesta fatura", "SALDO FATURA ANTERIOR BR R$ 500,00", "16/03 PGTO. CASH AG. 9999 BR R$ -500,00",
  "20/03 SEGURADORA EXEMPLO*AUTO09D12 SAO PAULO BR R$ 300,00", "22/03 MERCADO EXEMPLO BOA VISTA BR R$ 100,00",
  "Total da Fatura R$ 400,00",
];
const caixa = (page) => page.evaluate(() => document.getElementById("confFaturaApp")?.innerText || "");

async function abrirFatura(page, lancamentos) {
  await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), lancamentos);
  await page.evaluate((c) => window.__genesisTeste.definirCartoes(c), CARTAO);
  await page.evaluate(() => { location.hash = "#importar"; });
  await page.waitForSelector("#pdfDropzone", { state: "visible" });
  await page.evaluate((l) => window.__genesisTeste.importarLinhas(l), FATURA);
  await page.waitForSelector("#confFaturaApp");
  await page.click('#importStaging .attn-item [data-act="pag-ok"]'); // "PGTO. CASH" é o pagamento da fatura anterior
}

test("conferência: parcela lançada à mão que já está na fatura aparece, e 'Apagar ao importar' faz bater com o PDF", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await abrirFatura(page, [
      { ...cc, tipo: "despesa", valor: 300, dataLanc: "2027-03-20", dataEfet: "2027-04-16", descricao: "seguro do carro", parcelaAtual: 9, totalParcelas: 12, statusParcela: "prevista", idCompra: "c-seg" },
      { ...cc, tipo: "despesa", valor: 300, dataLanc: "2027-03-20", dataEfet: "2027-05-16", descricao: "seguro do carro", parcelaAtual: 10, totalParcelas: 12, statusParcela: "prevista", idCompra: "c-seg" },
    ]);
    let t = await caixa(page);
    assert.match(t, /vai somar R\$\s?700,00, mas o PDF diz R\$\s?400,00/);
    assert.match(t, /seguro do carro[\s\S]*Parece a mesma que ‘SEGURADORA EXEMPLO/);
    await page.click('#confFaturaApp [data-act="conf-apagar"]');
    await page.waitForFunction(() => /igual ao PDF/.test(document.getElementById("confFaturaApp").innerText));
    assert.match(await caixa(page), /fica em R\$\s?400,00, igual ao PDF/);
    await page.click("#btnConfirmStaging");
    await page.waitForFunction(() => !window.__genesisTeste.lancamentos().some((t) => t.descricao === "seguro do carro" && t.parcelaAtual === 9));
    const resto = await page.evaluate(() => window.__genesisTeste.lancamentos().filter((t) => t.descricao === "seguro do carro").map((t) => t.parcelaAtual));
    assert.deepEqual(resto, [10], "só a parcela desta fatura sai; a do mês seguinte fica");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("conferência: compra desmarcada aparece com 'Incluir'", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await abrirFatura(page, []);
    assert.match(await caixa(page), /igual ao PDF/);
    const idx = await page.evaluate(() => window.__genesisTeste.previa().linhas.findIndex((l) => l.descricao.startsWith("MERCADO EXEMPLO")));
    await page.click(`#importStaging input[data-f="selected"][data-idx="${idx}"]`);
    await page.waitForFunction(() => /vai somar R\$\s?300,00/.test(document.getElementById("confFaturaApp")?.innerText || ""));
    assert.match(await caixa(page), /MERCADO EXEMPLO[\s\S]*está desmarcada/);
    await page.click('#confFaturaApp [data-act="conf-incluir"]');
    await page.waitForFunction(() => /igual ao PDF/.test(document.getElementById("confFaturaApp")?.innerText || ""));
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
