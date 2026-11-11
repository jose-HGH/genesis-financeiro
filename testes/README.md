# Testes do Gênesis

Rodam sozinhos no GitHub (Actions → **Testes**) a cada push e a cada pull request.
Um X vermelho no PR quer dizer que algo quebrou: não faça merge até ficar verde.

## O que é testado

| Arquivo | O que confere |
|---|---|
| `painel.test.mjs` | O painel abre sem erro de JavaScript, o leitor de PDF carrega e a versão (`app-version`) existe. |
| `arquivos.test.mjs` | Cada arquivo da biblioteca `arquivos/` é lido como o `.esperado.json` diz. Com `"reimportar": true`, importa e manda o mesmo arquivo de novo: nenhuma linha pode entrar duas vezes. |
| Workflow, passo "Versão do site subiu?" | Se o `index.html` mudou no PR, a meta `app-version` tem de mudar também (senão o navegador continua com o código velho). |
| Job "Regras do copiloto e banco" | `regras.test.ts` do copiloto e os testes SQL num Postgres descartável. |

## Cópia isolada do painel

Os testes abrem uma cópia do painel num Chromium controlado por robô, servida em `127.0.0.1`.
As bibliotecas do CDN vêm de `node_modules` (mesmas versões) e todo endereço externo,
inclusive o Supabase, é bloqueado. Os testes **nunca** tocam nos dados reais nem na nuvem.

O `index.html` só expõe `window.__genesisTeste` quando o navegador é controlado por robô
(`navigator.webdriver`); quem usa o painel normalmente não vê nada disso.

## Biblioteca de arquivos

`arquivos/<banco>/<nome>.<ofx|csv|pdf|xlsx>` ou `<nome>.linhas.json` (texto já extraído do PDF), com
`<nome>.esperado.json` ao lado. O repositório é **público**: só entram arquivos fictícios ou com
todos os dados pessoais trocados (nome, CPF, conta, agência, favorecidos).

Para criar ou atualizar o esperado:

```bash
cd testes && npm ci --omit=optional && npx playwright install chromium
node gravar-esperado.mjs arquivos/<banco>/<arquivo> --descricao "o que este arquivo testa" [--reimportar]
```

Confira o `.esperado.json` contra o extrato original antes de commitar: o teste só protege o que estiver certo ali.

## Rodar no seu computador

```bash
cd testes
npm ci --omit=optional
npx playwright install chromium
npm test
```
