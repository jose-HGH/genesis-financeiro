// Fatura: o que NÃO é repetido não pode ficar desmarcado, e a parcela lançada à mão com outro nome
// tem que ser confirmada pela linha da fatura (e não somada de novo). Números e nomes inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const cc = { banco: "Nubank", modalidade: "Crédito", classificacao: "Variável", recorrencia: "Única", escopo: "meu", categoria: "Outros" };
const FATURA = [
  "Nubank", "FATURA 20 ABR 2027", "EMISSÃO E ENVIO 13 ABR 2027", "Data de vencimento: 20 ABR 2027",
  "Limite total do cartão de crédito: R$ 5.000,00", "TRANSAÇÕES DE 14 MAR A 13 ABR",
  "14 MAR •••• 4051 APPLE.COM/BILL R$ 66,90",
  "20 MAR •••• 4051 JOTA BURGUER BOA VISTA R$ 46,00",
  "04 ABR •••• 4051 DROGARIA EXEMPLO R$ 35,00",
  "07 MAR •••• 4051 DigitalPhone - Parcela 8/8 R$ 462,37",
  "15 MAR •••• 4051 Studio Exemplo - Parcela 6/11 R$ 362,30",
];

test("fatura: assinatura do mês passado, Pix do mesmo valor e outra parcela da mesma compra não são repetidos", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), [
      // fatura anterior (vence 20/03): mesma assinatura e mesmo valor no mesmo tipo de lugar
      { ...cc, tipo: "despesa", valor: 66.9, dataLanc: "2027-02-14", dataEfet: "2027-03-20", descricao: "APPLE.COM/BILL" },
      { ...cc, tipo: "despesa", valor: 46, dataLanc: "2027-02-20", dataEfet: "2027-03-20", descricao: "RODS BURGUER BOA VISTA" },
      // Pix no mesmo dia e valor de uma compra no cartão
      { ...cc, modalidade: "Pix", tipo: "despesa", valor: 35, dataLanc: "2027-04-04", dataEfet: "2027-04-04", descricao: "FULANO EXEMPLO · Pix - Enviado" },
      // parcela anterior da mesma compra, lançada à mão com outro nome
      { ...cc, tipo: "despesa", valor: 362.3, dataLanc: "2027-03-15", dataEfet: "2027-03-20", descricao: "reforma", parcelaAtual: 5, totalParcelas: 11, statusParcela: "confirmada", idCompra: "c-ref" },
      // parcelas previstas lançadas à mão com outro nome, no mês desta fatura
      { ...cc, tipo: "despesa", valor: 362.3, dataLanc: "2027-03-15", dataEfet: "2027-04-20", descricao: "reforma", parcelaAtual: 6, totalParcelas: 11, statusParcela: "prevista", idCompra: "c-ref" },
      { ...cc, tipo: "despesa", valor: 462.37, dataLanc: "2027-03-07", dataEfet: "2027-04-20", descricao: "celular", parcelaAtual: 8, totalParcelas: 8, statusParcela: "prevista", idCompra: "c-cel" },
    ]);
    await page.evaluate(() => { location.hash = "#importar"; });
    await page.waitForSelector("#pdfDropzone", { state: "visible" });
    await page.evaluate((l) => window.__genesisTeste.importarLinhas(l), FATURA);
    await page.waitForFunction(() => window.__genesisTeste.previa().linhas.length >= 5);
    const linhas = (await page.evaluate(() => window.__genesisTeste.previa())).linhas;
    const por = (txt) => linhas.find((l) => l.descricao.includes(txt));
    for (const nome of ["APPLE", "JOTA BURGUER", "DROGARIA", "DigitalPhone", "Studio Exemplo"]) {
      assert.equal(por(nome).selecionada, true, `${nome} deveria entrar`);
      assert.equal(por(nome).duplicada, null, `${nome} não é repetido`);
    }
    assert.ok(por("DigitalPhone").confirmaPrevista, "DigitalPhone 8/8 confirma a prevista 'celular' 8/8");
    assert.ok(por("Studio Exemplo").confirmaPrevista, "Studio 6/11 confirma a prevista 'reforma' 6/11");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
