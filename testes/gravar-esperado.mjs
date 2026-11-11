// Lê um arquivo da biblioteca no painel e grava <nome>.esperado.json com o resultado de hoje.
// Uso: node testes/gravar-esperado.mjs testes/arquivos/<banco>/<arquivo> [--reimportar] [--descricao "texto"]
// Depois de gravar, CONFIRA o .esperado.json contra o PDF/extrato original antes de commitar:
// o teste só protege o que estiver certo aqui.
import fs from "node:fs";
import path from "node:path";
import { iniciarServidor, abrirNavegador, abrirPainel, importarArquivo } from "./ambiente.mjs";
import { resumir } from "./biblioteca.mjs";

const args = process.argv.slice(2);
const arquivo = path.resolve(args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--descricao") || "");
if (!fs.existsSync(arquivo)) { console.error("Arquivo não encontrado. Uso: node testes/gravar-esperado.mjs testes/arquivos/<banco>/<arquivo>"); process.exit(1); }
const di = args.indexOf("--descricao");

const servidor = await iniciarServidor();
const browser = await abrirNavegador();
try {
  const { page, erros } = await abrirPainel(browser, servidor.base);
  const saida0 = arquivo.replace(/(\.linhas\.json|\.[a-z]+)$/i, ".esperado.json");
  const opcoes = fs.existsSync(saida0) ? (JSON.parse(fs.readFileSync(saida0, "utf8")).opcoes || {}) : {};
  const leitura = resumir(await importarArquivo(page, arquivo, opcoes));
  if (erros.length) console.warn("Atenção, erros na página:\n" + erros.join("\n"));
  const saida = arquivo.replace(/(\.linhas\.json|\.[a-z]+)$/i, ".esperado.json");
  const anterior = fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, "utf8")) : {};
  const doc = {
    ...anterior, // mantém importar_antes, novas_depois e o que mais já estiver escrito à mão
    descricao: di >= 0 ? args[di + 1] : (anterior.descricao || ""),
    reimportar: args.includes("--reimportar") || !!anterior.reimportar,
    ...(Object.keys(opcoes).length ? { opcoes } : {}),
    leitura,
  };
  fs.writeFileSync(saida, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Gravado ${path.relative(process.cwd(), saida)}: ${leitura.erro ? "erro: " + leitura.erro : `${leitura.total_linhas} linha(s), soma ${leitura.soma}`}`);
} finally {
  await browser.close();
  servidor.srv.close();
}
