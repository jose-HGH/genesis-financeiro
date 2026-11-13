// Aviso "contas de hoje e amanhã" no topo do app. Números inventados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, abrirNavegador, abrirPainel } from "./ambiente.mjs";

let servidor, browser;
before(async () => { servidor = await iniciarServidor(); browser = await abrirNavegador(); });
after(async () => { await browser?.close(); servidor?.srv.close(); });

const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boa_Vista" }).format(new Date());
const somar = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const amanha = somar(hoje, 1), ontem = somar(hoje, -1), depois = somar(hoje, 2);
const base = { banco: "Nubank", modalidade: "Débito", classificacao: "Variável", recorrencia: "Única", escopo: "meu" };
const L = (tipo, valor, d, desc, x = {}) => ({ ...base, tipo, valor, dataLanc: d, dataEfet: d, descricao: desc, categoria: "Contas", ...x });

test("contas de hoje e amanhã: lista, total, pago, fatura, extrato e fechar por hoje", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), [
      L("despesa", 120.5, hoje, "BOLETO LUZ FICTICIO"),
      L("despesa", 80, hoje, "INTERNET FICTICIA"),
      L("despesa", 1500, amanha, "ALUGUEL FICTICIO"),
      L("despesa", 60, hoje, "JA PAGO FICTICIO", { pagoManual: true }),
      L("despesa", 33, hoje, "DO EXTRATO FICTICIO", { fonte: "extrato", conta: "c1" }),
      L("receita", 900, hoje, "SALARIO FICTICIO", { categoria: "Salário" }),
      L("despesa", 70, ontem, "ONTEM FICTICIO"),
      L("despesa", 70, depois, "DEPOIS FICTICIO"),
      L("despesa", 300, hoje, "COMPRA CARTAO A", { modalidade: "Crédito", banco: "Banco do Brasil" }),
      L("estorno", 20, hoje, "ESTORNO CARTAO", { modalidade: "Crédito", banco: "Banco do Brasil" }),
      L("despesa", 400, hoje, "COMPRA NUBANK", { modalidade: "Crédito" }),
      L("pagamento_fatura", 400, somar(hoje, -3), "PAGAMENTO FATURA NUBANK", { categoria: "Pagamento de fatura" }),
    ]);
    const box = page.locator("#contasDia");
    await box.waitFor();
    const txt = await box.innerText();
    // hoje: luz 120,50 + internet 80 + fatura BB 280 = 480,50 (fatura Nubank já paga; pago, extrato e receita fora)
    assert.match(txt, /Hoje vencem 3 contas: R\$\s?480,50/);
    assert.match(txt, /Amanhã vence 1 conta: R\$\s?1\.500,00/);
    await box.locator('[data-cd="ver"]').click();
    const itens = await box.locator(".cd-item").allInnerTexts();
    assert.equal(itens.length, 4);
    assert.match(itens.join("\n"), /Fatura[\s\S]*280,00/);
    assert.doesNotMatch(itens.join("\n"), /JA PAGO|DO EXTRATO|SALARIO|ONTEM|DEPOIS|NUBANK/);
    // Marcar a luz como paga tira ela do aviso.
    await box.locator(".cd-item", { hasText: "BOLETO LUZ" }).locator('[data-cd="pago"]').click();
    await page.waitForFunction(() => /vencem 2 contas/.test(document.getElementById("contasDia").innerText));
    // "Já paguei" na fatura também.
    await box.locator(".cd-item", { hasText: "Fatura" }).locator('[data-cd="pago"]').click();
    await page.waitForFunction(() => /Hoje vence 1 conta: R\$\s?80,00/.test(document.getElementById("contasDia").innerText));
    // Fechar por hoje esconde o aviso, e ele continua fechado depois de recarregar.
    await box.locator('[data-cd="fechar"]').click();
    assert.equal(await box.isHidden(), true);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});

test("sem contas para hoje nem amanhã, nada aparece", async () => {
  const { ctx, page, erros } = await abrirPainel(browser, servidor.base);
  try {
    await page.evaluate((l) => window.__genesisTeste.definirLancamentos(l), [L("despesa", 70, depois, "DEPOIS FICTICIO")]);
    assert.equal(await page.locator("#contasDia").isHidden(), true);
    assert.deepEqual(erros, []);
  } finally { await ctx.close(); }
});
