# Schema do banco

`atual.sql` é a fotografia da estrutura do banco (tabelas, RLS, funções),
sem nenhum dado. Ele é gerado pela ação **Supabase** do GitHub
(opção `salvar-schema`) e serve para auditar e recriar o banco.

Não edite à mão. Mudanças no banco entram como arquivo novo em
`supabase/migrations/`.
