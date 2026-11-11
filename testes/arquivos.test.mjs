// Biblioteca de arquivos de teste: cada arquivo em testes/arquivos/<banco>/ tem ao lado um
// <nome>.esperado.json com o que o painel deve ler. Se a leitura mudar, o teste falha.
// Para criar ou atualizar o esperado: node testes/gravar-esperado.mjs testes/arquivos/<banco>/<arquivo>
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { iniciarServidor, abrirNavegador, abrirPainel, importarArquivo } from "./ambiente.mjs";
import { listarArquivos, resumir } from "./biblioteca.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

for (const arquivo of listarArquivos()) {
  const nome = path.relative(path.join(import.meta.dirname, "arquivos"), arquivo);
  const esperadoArq = arquivo.replace(/(\.linhas\.json|\.[a-z]+)$/i, ".esperado.json");

  test(`lê ${nome} como esperado`, async (t) => {
    if (!fs.existsSync(esperadoArq)) { t.skip("sem .esperado.json ao lado"); return; }
    const esperado = JSON.parse(fs.readFileSync(esperadoArq, "utf8"));
    const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
    try {
      const r = await importarArquivo(page, arquivo, esperado.opcoes);
      assert.deepEqual(resumir(r), esperado.leitura);
      assert.deepEqual(erros, []);

      if (esperado.reimportar) {
        // importa, depois manda o MESMO arquivo de novo: nada pode entrar duas vezes
        const inicio = await page.evaluate(() => window.__genesisTeste.lancamentos().length); // o painel novo traz exemplos
        await page.click("#btnConfirmStaging");
        await page.waitForFunction((n) => window.__genesisTeste.lancamentos().length > n, inicio, { timeout: 10000 });
        const antes = (await page.evaluate(() => window.__genesisTeste.lancamentos().length)) - inicio;
        const r2 = await importarArquivo(page, arquivo, esperado.opcoes);
        const novas = r2.previa.linhas.filter((l) => l.selecionada && !l.duplicada);
        assert.deepEqual(novas, [], "ao reimportar o mesmo arquivo, alguma linha veio marcada como nova");
        assert.equal(antes, esperado.leitura.linhas.filter((l) => l.selecionada).length, "nem todas as linhas selecionadas foram importadas");
      }
    } finally { await ctx.close(); }
  });
}
