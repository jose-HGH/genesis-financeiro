// Importar extrato com um lançamento manual igual (ex.: aluguel lançado à mão como receita de todo mês):
// a linha do extrato já vem vinculada a ele e não cria outro. Números inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iniciarServidor, abrirNavegador, abrirPainel, importarArquivo } from "./ambiente.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const OFX = path.join(aqui, "arquivos", "banco-do-brasil", "extrato-ficticio.ofx"); // 05/10: Pix recebido de 3.500,00

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const base = { banco: "Banco do Brasil", modalidade: "Pix", classificacao: "Fixa", escopo: "meu" };

test("extrato: receita lançada à mão com o mesmo valor e até 5 dias é vinculada sozinha", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), [
      { ...base, id: "alug10", tipo: "receita", valor: 3500, dataLanc: "2026-10-08", dataEfet: "2026-10-08", descricao: "ALUGUEL FICTICIO", categoria: "Aluguel", recorrencia: "Mensal" },
      { ...base, id: "alug11", tipo: "receita", valor: 3500, dataLanc: "2026-11-08", dataEfet: "2026-11-08", descricao: "ALUGUEL FICTICIO", categoria: "Aluguel", recorrencia: "Mensal" },
      { ...base, id: "luz", tipo: "despesa", valor: 89.9, dataLanc: "2026-10-25", dataEfet: "2026-10-25", descricao: "LUZ FICTICIA", categoria: "Contas", recorrencia: "Única" },
    ]);
    const r = await importarArquivo(page, OFX);
    const linhas = r.previa.linhas;
    const vinc = await page.evaluate(() => window.__genesisTeste.vinculosPrevia());
    const i = linhas.findIndex((l) => l.valor === 3500);
    assert.equal(vinc[i], "alug10", "o Pix de 05/10 deveria vir ligado ao aluguel de 08/10");
    assert.equal(linhas[i].selecionada, true);
    const j = linhas.findIndex((l) => l.valor === 89.9);
    assert.equal(vinc[j], null, "15 dias de diferença: não liga sozinho");
    assert.equal(vinc.filter(Boolean).length, 1);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
