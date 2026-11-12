// Gera extratos e faturas FICTÍCIOS com a resposta certa conhecida, a partir de uma semente.
// Cada caso: {id, formato, arquivo: {nome, conteudo|linhas}, esperado: {...}, segundo?: {...}}
// Mesma semente = mesmos casos (para reproduzir um problema achado).

export function prng(seed) {
  let a = seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (min, max) => min + Math.floor(r() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const chance = (p) => r() < p;
  return { r, int, pick, chance };
}

const p2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
const addDias = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const cent = (v) => Math.round(v * 100) / 100;
export const moedaBR = (v) => { const [i, d] = Math.abs(v).toFixed(2).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + d; };
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

const LOJAS = ["MERCADO EXEMPLO", "Padaria São João", "FARMÁCIA POPULAR EX", "Posto Ipiranga Ex", "IFOOD *RESTAURANTE", "UBER *TRIP", "Loja & Cia", "Açougue Boi Gordo",
  "AMAZON BR", "Netflix.com", "Café d'Ávila", "LOJAS RENNER", "MP*DOCERIA", "PAG*JoaoSilva", "Drogaria 24h", "Shopping <Centro>", "Ótica Visão", "SUPERMERCADO 100% BOM"];
const PESSOAS = ["FULANO DE TAL", "Maria Exemplo da Silva", "JOSÉ CICRANO", "Beltrana Souza", "ANA PAULA ÇÃO"];

function valor(g) {
  const tipo = g.r();
  if (tipo < 0.05) return 0.01;
  if (tipo < 0.10) return cent(g.int(1000, 50000) + g.int(0, 99) / 100);
  if (tipo < 0.15) return g.int(1, 999); // inteiro
  if (tipo < 0.18) return 999.99;
  if (tipo < 0.20) return 1000;
  return cent(g.int(1, 800) + g.int(0, 99) / 100);
}

// ---------- OFX ----------
function casoOfx(g, id) {
  const ini = `2026-${p2(g.int(1, 12))}-01`;
  const n = g.chance(0.05) ? 0 : g.int(1, 40);
  const xml = g.chance(0.3), crlf = g.chance(0.4), cp1252 = !xml && g.chance(0.3);
  const lanc = [];
  for (let i = 0; i < n; i++) {
    const data = addDias(ini, g.int(0, 27));
    const sai = g.chance(0.7);
    const v = valor(g) * (sai ? -1 : 1);
    const comHora = g.chance(0.4);
    let dt = data.replace(/-/g, ""), dataEsperada = data;
    if (comHora) {
      const tz = g.pick(["[-3:BRT]", "[0:GMT]", "[-4:AMT]", ""]);
      const h = g.int(0, 23), m = g.int(0, 59);
      dt += `${p2(h)}${p2(m)}00${tz}`;
      if ((h || m) && tz) {
        const off = parseFloat(tz.slice(1));
        const utc = Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10), h, m) - off * 3600000;
        dataEsperada = iso(new Date(utc - 3 * 3600000));
      }
    }
    const memo = sai ? `${g.pick(["Compra com Cartao", "Pix - Enviado", "Pagamento"])} ${g.pick(LOJAS)}` : `${g.pick(["Pix - Recebido", "TED Recebida", "Rendimento"])} ${g.pick(PESSOAS)}`;
    const fitid = g.chance(0.03) && lanc.length ? lanc[lanc.length - 1].fitid : `F${id}x${i}`;
    lanc.push({ dt, data: dataEsperada, v, memo, fitid });
  }
  const esc = (s) => xml ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const tr = lanc.map((l) => xml
    ? `<STMTTRN><TRNTYPE>${l.v < 0 ? "DEBIT" : "CREDIT"}</TRNTYPE><DTPOSTED>${l.dt}</DTPOSTED><TRNAMT>${l.v.toFixed(2)}</TRNAMT><FITID>${l.fitid}</FITID><MEMO>${esc(l.memo)}</MEMO></STMTTRN>`
    : `<STMTTRN><TRNTYPE>${l.v < 0 ? "DEBIT" : "CREDIT"}<DTPOSTED>${l.dt}<TRNAMT>${l.v.toFixed(2)}<FITID>${l.fitid}<MEMO>${esc(l.memo)}</STMTTRN>`);
  const saldo = cent(lanc.reduce((s, l) => s + l.v, 0) + 500);
  const fim = addDias(ini, 27).replace(/-/g, "");
  const cab = xml
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n<OFX>`
    : `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:${cp1252 ? "USASCII" : "UTF-8"}\nCHARSET:${cp1252 ? "1252" : "NONE"}\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>`;
  const corpo = `${cab}\n<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>\n<BANKACCTFROM><BANKID>${g.pick(["001", "0260", "104", "341"])}</BANKID><BRANCHID>9999</BRANCHID><ACCTID>12345-${g.int(0, 9)}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>\n<BANKTRANLIST><DTSTART>${ini.replace(/-/g, "")}</DTSTART><DTEND>${fim}</DTEND>\n${tr.join("\n")}\n</BANKTRANLIST>\n<LEDGERBAL><BALAMT>${saldo.toFixed(2)}</BALAMT><DTASOF>${fim}</DTASOF></LEDGERBAL>\n</STMTRS></STMTTRNRS></BANKMSGSRSV1>\n</OFX>\n`;
  const texto = crlf ? corpo.replace(/\n/g, "\r\n") : corpo;
  return {
    id, formato: "ofx", variante: [xml ? "xml" : "sgml", crlf ? "crlf" : "lf", cp1252 ? "cp1252" : "utf8"].join(","),
    arquivo: { nome: `caso-${id}.ofx`, bytes: cp1252 ? Buffer.from(texto, "latin1") : Buffer.from(texto, "utf8") },
    esperado: { soSaldo: n === 0, linhas: lanc.map((l) => ({ data: l.data, valor: l.v, descricao: l.memo })) },
  };
}

// ---------- CSV (conta Nubank e variações) ----------
function casoCsv(g, id) {
  const ini = `2026-${p2(g.int(1, 12))}-01`;
  const n = g.int(1, 30);
  const sep = g.pick([",", ";", "\t"]), virgula = sep !== "," && g.chance(0.7), bom = g.chance(0.3), crlf = g.chance(0.4);
  const lanc = [];
  for (let i = 0; i < n; i++) {
    const v = valor(g) * (g.chance(0.7) ? -1 : 1);
    let desc = g.chance(0.5) ? `Compra no débito - ${g.pick(LOJAS)}` : `Transferência ${v < 0 ? "enviada" : "recebida"} pelo Pix - ${g.pick(PESSOAS)}`;
    if (g.chance(0.1)) desc += `, ${g.pick(["parcela única", "ref. outubro"])}`; // vírgula dentro do texto
    lanc.push({ data: addDias(ini, g.int(0, 27)), v, desc, idx: `id-${id}-${i}` });
  }
  if (g.chance(0.3)) { const x = lanc[g.int(0, lanc.length - 1)]; lanc.push({ ...x, idx: x.idx + "-b" }); }
  const fmtV = (v) => virgula ? v.toFixed(2).replace(".", ",") : v.toFixed(2);
  const q = (s) => (s.includes(sep) || s.includes('"') || s.includes("\n")) ? `"${s.replace(/"/g, '""')}"` : s;
  let linhas = [["Data", "Valor", "Identificador", "Descrição"].join(sep)];
  lanc.forEach((l) => linhas.push([br(l.data), fmtV(l.v), l.idx, q(l.desc)].join(sep)));
  if (g.chance(0.2)) linhas.push("");
  let texto = (bom ? "﻿" : "") + linhas.join(crlf ? "\r\n" : "\n") + "\n";
  return {
    id, formato: "csv", variante: [JSON.stringify(sep), virgula ? "virgula" : "ponto", bom ? "bom" : "", crlf ? "crlf" : "lf"].filter(Boolean).join(","),
    arquivo: { nome: `caso-${id}.csv`, bytes: Buffer.from(texto, "utf8") }, opcoes: { banco: "Banco Exemplo" },
    esperado: { linhas: lanc.map((l) => ({ data: l.data, valor: cent(l.v), descricao: l.desc })) },
  };
}

// ---------- Extrato BB em texto (formato real do PDF, com dados inventados) ----------
function lancamentosBB(g, ini, dias, n, prefixoDoc) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const dataLanc = addDias(ini, g.int(0, dias));
    const tipo = g.pick(["compra", "pix-env", "pix-rec", "transf", "boleto", "tarifa"]);
    const v = valor(g) * (tipo === "pix-rec" || tipo === "transf" ? 1 : -1);
    const hist = { compra: "Compra com Cartão", "pix-env": "Pix - Enviado", "pix-rec": "Pix - Recebido", transf: "Transferido da poupança", boleto: "Pagamento de Boleto", tarifa: "Tarifa Pacote de Serviços" }[tipo];
    const nome = tipo === "compra" ? g.pick(LOJAS).toUpperCase() : tipo === "boleto" ? "EMPRESA EXEMPLO LTDA" : tipo === "tarifa" ? null : g.pick(PESSOAS);
    const atraso = tipo === "compra" ? g.int(0, 3) : 0; // compra feita antes do lançamento
    const dataReal = addDias(dataLanc, -atraso);
    const hora = `${p2(g.int(0, 23))}:${p2(g.int(0, 59))}`;
    out.push({ dataLanc, dataReal, v, hist, nome, hora: nome ? hora : null, doc: `${prefixoDoc}${String(i).padStart(4, "0")}`, lote: g.pick(["2093", "99008", "13105", "14397"]) });
  }
  if (out.length && g.chance(0.3)) { const x = out[g.int(0, out.length - 1)]; out.push({ ...x, doc: x.doc + "9", hora: x.hora ? x.hora.slice(0, 3) + "59" : null }); }
  return out.sort((a, b) => a.dataLanc < b.dataLanc ? -1 : a.dataLanc > b.dataLanc ? 1 : 0);
}
function textoBB(g, l, lotes, ini, fim, saldoAnt, opts = {}) {
  const L = ["Extrato de Conta Corrente", "Cliente: FULANO DE TAL EXEMPLO", `Período: ${ini.slice(8, 10)} a ${br(fim)} Agência: 9999-9 Conta: 7777-1`, "Lançamentos", "Dia Lote Documento Histórico Valor"];
  L.push(`${br(addDias(ini, -1))} Saldo Anterior ${moedaBR(saldoAnt)} (${saldoAnt < 0 ? "-" : "+"})`);
  let saldo = saldoAnt, dia = null;
  const fechaDia = () => { if (dia) L.push(`${br(dia)} ${g.pick(["99020", "13105"])} Saldo do dia ${moedaBR(saldo)} (${saldo < 0 ? "-" : "+"})`); };
  for (const x of l) {
    if (dia && x.dataLanc !== dia) fechaDia();
    dia = x.dataLanc; saldo = cent(saldo + x.v);
    const lote = lotes ? lotes(x) : x.lote, sinal = x.v < 0 ? "-" : "+";
    const detalhe = x.nome ? `${br(x.dataReal).slice(0, 5)} ${x.hora} ${x.nome}` : null;
    if (detalhe && opts.inline && g.chance(0.3)) {
      L.push(x.hist); L.push(`${br(x.dataLanc)} ${lote} ${x.doc} ${detalhe} ${moedaBR(x.v)} (${sinal})`);
    } else {
      L.push(x.hist); L.push(`${br(x.dataLanc)} ${lote} ${x.doc} ${moedaBR(x.v)} (${sinal})`);
      if (detalhe) L.push(detalhe);
    }
  }
  fechaDia();
  L.push(`${br(fim)} S A L D O ${moedaBR(saldo)} (${saldo < 0 ? "-" : "+"})`);
  L.push("Informações Adicionais", `Saldo ${moedaBR(saldo)} (${saldo < 0 ? "-" : "+"})`, "Limite Especial da Conta 0,00 (+)", "- Limite Contratado 5.000,00 (+)", "Lançamentos Futuros", "Dia Histórico Valor", "00/00/0000 0,00 (+)");
  return L;
}
function casoBB(g, id) {
  // virada de ano às vezes: dezembro → janeiro
  const ini = g.chance(0.25) ? "2026-12-20" : `2026-${p2(g.int(1, 11))}-01`;
  const dias = 20, fim1 = addDias(ini, 10), fim2 = addDias(ini, dias);
  const todos = lancamentosBB(g, ini, dias, g.int(2, 25), `${g.int(10, 99)}`);
  const parte1 = todos.filter((x) => x.dataLanc <= fim1);
  const saldoAnt = cent(g.int(-800, 3000) + g.int(0, 99) / 100);
  const trocaLote = g.chance(0.6);
  const linhas1 = textoBB(g, parte1, null, ini, fim1, saldoAnt, { inline: g.chance(0.5) });
  const linhas2 = textoBB(g, todos, trocaLote ? (x) => (x.lote === "2093" ? "99008" : x.lote === "99008" ? "2093" : x.lote) : null, ini, fim2, saldoAnt, { inline: g.chance(0.5) });
  const esp = (l) => l.map((x) => ({ data: x.dataReal, dataEfet: x.dataLanc, valor: x.v }));
  return {
    id, formato: "bb-texto", variante: [ini.slice(5) === "12-20" ? "virada-de-ano" : "mes", trocaLote ? "lote-trocado" : "mesmo-lote"].join(","),
    arquivo: { nome: `caso-${id}-parte1.linhas.json`, linhas: linhas1 },
    esperado: { linhas: esp(parte1), saldoFinal: cent(saldoAnt + parte1.reduce((s, x) => s + x.v, 0)) },
    segundo: { arquivo: { nome: `caso-${id}-parte2.linhas.json`, linhas: linhas2 }, novas: esp(todos.filter((x) => x.dataLanc > fim1)) },
  };
}

// ---------- Fatura Nubank em texto ----------
function casoFatura(g, id) {
  const mesV = g.int(1, 12), anoV = 2027, diaV = g.pick([5, 10, 15, 20, 25]);
  const venc = `${anoV}-${p2(mesV)}-${p2(diaV)}`, fech = addDias(venc, -7), iniPer = addDias(fech, -30);
  const n = g.int(1, 25), compras = [];
  for (let i = 0; i < n; i++) {
    const data = addDias(iniPer, g.int(0, 29));
    const parcela = g.chance(0.2) ? (() => { const t = g.int(2, 12); return `${g.int(1, t)}/${t}`; })() : null;
    compras.push({ data, v: valor(g), loja: g.pick(LOJAS), parcela });
  }
  const extras = [];
  if (g.chance(0.3)) { const c = compras[0]; extras.push({ data: addDias(c.data, 1), v: c.v, loja: `Estorno de compra ${c.loja}`, estorno: true }); }
  if (g.chance(0.2)) extras.push({ data: addDias(iniPer, g.int(0, 29)), v: valor(g), loja: "IOF de compra internacional" });
  const mm = (s) => `${s.slice(8, 10)} ${MESES[+s.slice(5, 7) - 1]}`;
  const L = ["Nubank", `FATURA ${mm(venc)} ${anoV}`, `EMISSÃO E ENVIO ${mm(fech)} ${fech.slice(0, 4)}`, `Data de vencimento: ${mm(venc)} ${anoV}`];
  const variante = g.pick(["vigente", "sem-vigente", "proxima-em-dias"]);
  if (variante === "vigente") L.push(`Período vigente: ${mm(iniPer)} a ${mm(fech)}`);
  L.push("Limite total do cartão de crédito: R$ 5.000,00", `TRANSAÇÕES DE ${mm(iniPer)} A ${mm(fech)}`);
  compras.forEach((c) => L.push(`${mm(c.data)} •••• 4051 ${c.loja}${c.parcela ? ` - Parcela ${c.parcela}` : ""} R$ ${moedaBR(c.v)}`));
  extras.forEach((c) => L.push(`${mm(c.data)} ${c.loja} ${c.estorno ? "-R$" : "R$"} ${moedaBR(c.v)}`));
  if (variante === "proxima-em-dias") L.push(`Próxima fatura: fechamento em ${g.int(2, 29)} dias`);
  return {
    id, formato: "fatura-nubank", variante: [variante, mesV <= 2 ? "virada-de-ano" : "mes"].join(","),
    arquivo: { nome: `caso-${id}.linhas.json`, linhas: L },
    esperado: { vencimento: venc, fechamentoDia: variante === "vigente" ? +fech.slice(8, 10) : null, linhas: compras.concat(extras).map((c) => ({ data: c.data, valor: c.v, parcela: c.parcela || null, estorno: !!c.estorno })) },
  };
}

export function gerarCasos(seed, quantos) {
  const g = prng(seed), casos = [];
  const tipos = [casoOfx, casoCsv, casoBB, casoFatura];
  for (let i = 0; i < quantos; i++) casos.push(tipos[i % tipos.length](g, `${seed}-${i}`));
  return casos;
}
