// Chat do copiloto (passo 7), sem nuvem: a Edge Function é trocada por uma função falsa.
// Confere que o app calcula as consultas, mostra os números e as descrições só na tela,
// e que nenhuma descrição de lançamento vai no pedido para a IA.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

// Mês de hoje e o anterior, no fuso do painel nos testes (Boa Vista).
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boa_Vista" }).format(new Date());
const mes = hoje.slice(0, 7);
const ant = (() => { const [y, m] = mes.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
const prox = (() => { const [y, m] = mes.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; })();
const dia = (ym, d) => `${ym}-${String(d).padStart(2, "0")}`;
const base = { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu" };
const LANCAMENTOS = [
  { ...base, tipo: "despesa", valor: 45.9, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "IFD*RESTAURANTE BOM", categoria: "Alimentação" },
  { ...base, tipo: "despesa", valor: 30, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "IFOOD PEDIDO", categoria: "Alimentação" },
  { ...base, tipo: "despesa", valor: 320.4, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "SUPERMERCADO CENTRAL", categoria: "Mercado" },
  { ...base, tipo: "despesa", valor: 80, dataLanc: dia(ant, 10), dataEfet: dia(ant, 10), descricao: "IFOOD PEDIDO", categoria: "Alimentação" },
  { ...base, tipo: "estorno", valor: 10, dataLanc: dia(ant, 11), dataEfet: dia(ant, 11), descricao: "ESTORNO IFOOD", categoria: "Alimentação" },
  { ...base, tipo: "receita", valor: 3000, dataLanc: dia(mes, 1), dataEfet: dia(mes, 1), descricao: "PIX RECEBIDO MARIA SOUZA", categoria: "Salário" },
  { ...base, tipo: "despesa", modalidade: "Crédito", valor: 100, dataLanc: dia(prox, 15), dataEfet: dia(prox, 15), descricao: "LOJA TENIS 2/3", categoria: "Vestuário",
    parcela: "2/3", parcelaAtual: 2, totalParcelas: 3, idCompra: "c1", seriesId: "c1", statusParcela: "prevista" },
];

async function painelComDados() {
  const p = await abrirPainel(browser, servidor.base);
  await p.page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), LANCAMENTOS);
  return p;
}

test("chat: consultas calculadas pelo app (gastos com termos, estorno descontado, parcelas a vencer)", async () => {
  const { ctx, page, erros } = await painelComDados();
  try {
    const r = await page.evaluate(([mes, ant]) => {
      const t = window.__genesisTeste;
      return {
        ifood: t.chatCalcular({ ferramenta: "gastos", de: ant, ate: mes, categoria: null, termos: ["ifood", "ifd"], agrupar: "mes" }).dados,
        mercado: t.chatCalcular({ ferramenta: "gastos", de: mes, ate: mes, categoria: "Mercado", termos: [], agrupar: "nenhum" }).dados,
        receitas: t.chatCalcular({ ferramenta: "receitas", de: mes, ate: mes, categoria: null, termos: [], agrupar: "nenhum" }).dados,
        maiores: t.chatCalcular({ ferramenta: "maiores_gastos", de: mes, ate: mes, categoria: null, termos: [], agrupar: "nenhum" }),
        parcelas: t.chatCalcular({ ferramenta: "parcelas", de: mes, ate: mes, categoria: null, termos: [], agrupar: "nenhum" }),
      };
    }, [mes, ant]);
    assert.equal(r.ifood.total, 145.9); // 45,90 + 30 + 80 − 10 de estorno
    assert.equal(r.ifood.lancamentos, 4);
    assert.equal(r.ifood.media_por_mes, 72.95);
    assert.deepEqual(r.ifood.por_mes, [{ mes: ant, valor: 70 }, { mes, valor: 75.9 }]);
    assert.equal(r.mercado.total, 320.4);
    assert.equal(r.receitas.total, 3000);
    assert.deepEqual(r.maiores.dados.itens.map((x) => x.valor), [320.4, 45.9, 30]);
    assert.equal(r.maiores.local.itens[0].texto, "SUPERMERCADO CENTRAL");
    assert.ok(!JSON.stringify(r.maiores.dados).includes("SUPERMERCADO"), "descrição não pode ir nos dados da IA");
    assert.equal(r.parcelas.dados.compras, 1);
    assert.equal(r.parcelas.dados.total_a_vencer, 100);
    assert.equal(r.parcelas.dados.ultima_parcela, prox);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("chat: pergunta → consulta → app calcula → resposta; nenhuma descrição vai para a IA", async () => {
  const { ctx, page, erros } = await painelComDados();
  try {
    await page.evaluate((mes) => {
      window.__pedidos = [];
      window.__genesisTeste.ligarChat((corpo) => {
        window.__pedidos.push(corpo);
        if (corpo.recurso === "chat") {
          return { ok: true, consulta: { tipo: "consultar", consultas: [{ ferramenta: "maiores_gastos", de: mes, ate: mes, categoria: null, termos: [], agrupar: "nenhum" }] } };
        }
        const it = corpo.resumo.consultas[0].itens[0];
        return { ok: true, texto: "Seu maior gasto foi de R$ " + it.valor.toFixed(2).replace(".", ",") + ", o 1º da lista abaixo." };
      });
    }, mes);
    await page.evaluate(() => { location.hash = "#inicio"; });
    await page.waitForSelector("#chatCard:not([hidden]) #chatPergunta");
    await page.fill("#chatPergunta", "qual foi meu maior gasto este mês?");
    await page.click("#chatEnviar");
    await page.waitForSelector(".chat-turno .ia-caixa:not(:has(.chat-espera))");
    const texto = await page.textContent(".chat-turno .ia-caixa");
    assert.match(texto, /Seu maior gasto foi de R\$ 320,40/);
    await page.click(".chat-numeros > summary");
    assert.match(await page.textContent(".chat-itens"), /SUPERMERCADO CENTRAL/);
    const pedidos = await page.evaluate(() => window.__pedidos);
    assert.deepEqual(pedidos.map((p) => p.recurso), ["chat", "chat_resposta"]);
    const tudo = JSON.stringify(pedidos);
    for (const d of LANCAMENTOS) assert.ok(!tudo.includes(d.descricao), `descrição foi para a IA: ${d.descricao}`);
    assert.equal(pedidos[0].resumo.hoje, hoje);
    assert.ok(pedidos[0].resumo.categorias["Salário"] === 0, "categoria de receita entra com 0 (só o nome)");

    // Pergunta seguinte leva a anterior, para entender "e no mês passado?"
    await page.fill("#chatPergunta", "e no mês passado?");
    await page.click("#chatEnviar");
    await page.waitForFunction(() => window.__pedidos.length === 4);
    const p3 = await page.evaluate(() => window.__pedidos[2]);
    assert.equal(p3.anterior, "qual foi meu maior gasto este mês?");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("chat: fora do assunto e resposta reprovada mostram aviso, e os números do app continuam", async () => {
  const { ctx, page, erros } = await painelComDados();
  try {
    await page.evaluate((mes) => {
      let n = 0;
      window.__genesisTeste.ligarChat((corpo) => {
        if (corpo.recurso === "chat") {
          return n++ === 0 ? { ok: true, consulta: { tipo: "fora_do_assunto", consultas: [] } }
            : { ok: true, consulta: { tipo: "consultar", consultas: [{ ferramenta: "gastos", de: mes, ate: mes, categoria: "Mercado", termos: [], agrupar: "nenhum" }] } };
        }
        return { ok: false, motivo: "numeros_reprovados", mensagem: "x" };
      });
    }, mes);
    await page.evaluate(() => { location.hash = "#inicio"; });
    await page.waitForSelector("#chatCard:not([hidden]) #chatPergunta");
    await page.fill("#chatPergunta", "em que ação devo investir?");
    await page.click("#chatEnviar");
    await page.waitForSelector(".chat-turno .ia-erro");
    assert.match(await page.textContent(".chat-turno .ia-caixa"), /só sobre os seus números/);
    await page.fill("#chatPergunta", "quanto gastei no mercado?");
    await page.click("#chatEnviar");
    await page.waitForFunction(() => document.querySelectorAll(".chat-turno .ia-erro").length === 2 && !document.querySelector(".chat-espera"));
    const ultimo = page.locator(".chat-turno").nth(1);
    assert.match(await ultimo.textContent(), /Não consegui escrever a resposta com segurança/);
    assert.match(await ultimo.locator(".chat-num").textContent(), /320,40/); // aberto quando a IA falha
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("chat: categoria e termos juntos somam os dois jeitos (posto sem a palavra gasolina)", async () => {
  const { ctx, page } = await painelComDados();
  try {
    await page.evaluate(([l, mes]) => window.__genesisTeste.definirLancamentos(l.concat([
      { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu", tipo: "despesa", valor: 200, dataLanc: mes + "-04", dataEfet: mes + "-04", descricao: "AUTO POSTO CENTRAL", categoria: "Transporte" },
      { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu", tipo: "despesa", valor: 50, dataLanc: mes + "-05", dataEfet: mes + "-05", descricao: "GASOLINA GALAO", categoria: "outros" },
    ])), [LANCAMENTOS, mes]);
    const d = await page.evaluate((mes) => window.__genesisTeste.chatCalcular({ ferramenta: "gastos", de: mes, ate: mes, categoria: "Transporte", termos: ["gasolina"], agrupar: "nenhum" }).dados, mes);
    assert.equal(d.total, 250);
    assert.equal(d.lancamentos, 2);
  } finally { await ctx.close(); }
});

test("chat: \"e se\" vai para o simulador, que calcula antes e depois, e o Explicar escreve", async () => {
  const { ctx, page, erros } = await painelComDados();
  try {
    await page.evaluate(() => {
      window.__pedidos = [];
      window.__genesisTeste.ligarChat((corpo) => {
        window.__pedidos.push(corpo);
        if (corpo.recurso === "chat") return { ok: true, consulta: { tipo: "simular", consultas: [] } };
        if (corpo.recurso === "simulador") return { ok: true, cenario: { tipo: "saida", categoria: null, termos: [], percentual: null, valor: 800, valor_parcela: null, parcelas: null, data: null, repetir: "unica" } };
        return { ok: true, texto: "Com mais R$ 800,00 de gasolina, o saldo do fim do mês muda." };
      });
      location.hash = "#inicio";
    });
    await page.waitForSelector("#chatCard:not([hidden]) #chatPergunta");
    await page.fill("#chatPergunta", "quanto vai sobrar se eu gastar mais 800 de gasolina esse mes?");
    await page.click("#chatEnviar");
    await page.waitForSelector(".chat-turno .ia-caixa:not(:has(.chat-espera))");
    const pedidos = await page.evaluate(() => window.__pedidos);
    assert.deepEqual(pedidos.map((p) => p.recurso), ["chat", "simulador", "explicar"]);
    assert.equal(pedidos[2].resumo.card, "simulacao");
    assert.equal(pedidos[2].resumo.simulacao.valor, 800);
    const caixa = await page.textContent(".chat-turno .ia-caixa");
    assert.match(caixa, /Com mais R\$ 800,00/);
    assert.match(caixa, /Saldo no fim do mês/);
    await page.click("[data-chat-abrir-sim]");
    await page.waitForFunction(() => document.getElementById("simValor") && document.getElementById("simValor").value === "800,00");
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("chat: escondido para quem não está no grupo de testes do copiloto", async () => {
  const { ctx, page } = await abrirPainel(browser, servidor.base);
  try {
    assert.equal(await page.evaluate(() => document.getElementById("chatCard").hidden), true);
  } finally { await ctx.close(); }
});
