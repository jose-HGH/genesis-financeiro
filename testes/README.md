# Testes do Gênesis

Rodam sozinhos no GitHub (Actions → **Testes**) a cada pull request e, na main, dentro do
workflow **Publicar**: o site só é publicado se todos passarem.
Um X vermelho no PR quer dizer que algo quebrou: não faça merge até ficar verde.

## O que é testado

| Arquivo | O que confere |
|---|---|
| `painel.test.mjs` | O painel abre sem erro de JavaScript, o leitor de PDF carrega e a versão (`app-version`) existe. |
| `arquivos.test.mjs` | Cada arquivo da biblioteca `arquivos/` é lido como o `.esperado.json` diz. Com `"reimportar": true`, importa e manda o mesmo arquivo de novo: nenhuma linha pode entrar duas vezes. |
| `painel.test.mjs` (versão) | Versão nova no servidor: ao abrir, recarrega uma vez; com a aba aberta, mostra "Atualizar" sem recarregar sozinho. |
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

## Publicação e versão

O workflow `Publicar` (a cada push na main) roda os testes, monta o site só com `index.html`,
`privacidade.html`, `termos.html` e `CNAME`, carimba a `app-version` com a hora da publicação
(UTC) e grava `versao.txt`. Ninguém precisa subir a versão à mão. O painel confere `versao.txt`
ao abrir, ao voltar para a aba e a cada 10 minutos.

Requisito (uma vez): GitHub → Settings → Pages → Source: **GitHub Actions**.

## Modo teste (testar à mão)

Abra `https://xn--finanashgh-s6a.com/?teste=1`. Aparece uma faixa roxa "Modo teste": os dados
ficam guardados à parte no navegador (prefixo `genesis-teste:`) e o painel não usa a nuvem
(sem login, não lê nem grava na conta). "Apagar dados de teste" recomeça do zero e
"Sair do modo teste" volta ao painel normal com os dados de sempre.
