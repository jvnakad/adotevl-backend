# AdoteVL — Backend

API REST do sistema de gestão de adoção de pets da AdoteVL, desenvolvida com NestJS e TypeScript.

## Requisitos

- Node.js 18+
- npm

## Configuração

1. Clone o repositório e instale as dependências:

```bash
npm install
```

2. Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
DATABASE_URL=postgresql://usuario:senha@host:porta/banco
JWT_SECRET=gere_um_segredo_aleatorio_de_15_ou_mais_caracteres
RESEND_API_KEY=sua_chave_resend
MAIL_FROM=AdoteVL <noreply@seudominio.com>
APP_URL=http://localhost:5173
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
SUPABASE_STORAGE_BUCKET=pet-photos
SUPABASE_ADOPTION_BUCKET=adoption-forms
```

> Para obter a `DATABASE_URL`, acesse o projeto no [Supabase](https://supabase.com) → Connect → ORM → TypeORM.
> Atenção: caracteres especiais na senha devem ser URL-encoded (`@` → `%40`, `#` → `%23`).
>
> As fotos dos pets são armazenadas no Supabase Storage. Crie um bucket **público** com o nome definido em `SUPABASE_STORAGE_BUCKET` (padrão `pet-photos`) e use a `service_role` key em Project Settings → API.
>
> As fotos das fichas de adoção (residência dos adotantes) ficam num bucket **privado**, definido em `SUPABASE_ADOPTION_BUCKET` (padrão `adoption-forms`). A API devolve URLs assinadas válidas por 1 hora a cada leitura da ficha.
>
> Para obter a `RESEND_API_KEY`, acesse [resend.com](https://resend.com) e crie uma API key. O domínio remetente deve estar verificado no Resend.

## Rodando o projeto

```bash
npm run start:dev
```

A API estará disponível em `http://localhost:3000`.

## Ambiente local (sem Supabase)

Para desenvolver sem acesso ao Supabase, use um Postgres local (15+) e o storage em disco. Ajuste a `DATABASE_URL` do `.env.local` para o seu banco:

```bash
cp .env.local.example .env.local      # .env.local tem precedência sobre o .env
npm run start:dev                     # cria as tabelas (synchronize) e os perfis padrão
npm run seed:dev                      # organização "AdoteVL Dev" + admin@adotevl.local / admin123
```

O `seed:dev` imprime as variáveis para o `.env` do front (`VITE_API_URL`, `VITE_ORGANIZATION_ID`, `VITE_PROFILE_*`).

### Dados de exemplo do Estoque

Para testar o módulo Estoque com bastante dado (tipos, produtos, histórico e paginação):

```bash
npm run seed:stock                             # na primeira organização existente (rode seed:dev antes, se o banco estiver vazio)
npm run seed:stock -- --org=<id ou CNPJ>       # organização específica
npm run seed:stock -- --reset                  # apaga SÓ o estoque da organização alvo (eventos, produtos e tipos) e recria
```

Cria 8 tipos ativos e 1 excluído (com um produto vinculado) e 45 produtos (42 ativos e 3 excluídos) nas unidades `UNIT`, `KG` e `LITER`, com quantidades 0, 2,500 kg e 1250,500 kg, vencidos, sem vencimento, nomes com acento e "Shampoo Pet®", um nome longo e uma observação longa. Os cadastros ficam espalhados nos últimos 90 dias (filtro de período e paginação de 10/20/50/100) e o histórico (74 eventos) é coerente: criação, edição com de/para (quantidade, unidade, tipo, nome), remoção e renomeação de produtos e tipos (ex.: buscar "Golden Special" ou "higiênica" traz também os eventos com o nome antigo). Os autores são os dois primeiros usuários ativos da organização (com um só usuário, ele assina tudo).

Segurança: só roda com a `DATABASE_URL` em `localhost`/`127.0.0.1` e fora de `NODE_ENV=production`. É idempotente: se a organização já tem dados de estoque, não faz nada (use `--reset` para recriar).

`JWT_SECRET` é obrigatório e precisa ter 15 caracteres ou mais: sem ele (ou com `changeme`/`sua_chave_secreta`) a API não sobe. Gere um com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Trocar o valor derruba todas as sessões e os links de acesso já enviados.

Com `STORAGE_DRIVER=local` as fotos são gravadas em `./uploads` e servidas em `http://localhost:3000/uploads/...`.

Testes e2e (só contra Postgres local): o e2e **não lê o `.env`**, que pode apontar para produção. Defina `DATABASE_URL` no processo, com host `localhost` ou `127.0.0.1`; sem isso, ou com outro host, a suíte falha logo no início. Exemplo:

```bash
DATABASE_URL="postgresql://adotevl:adotevl@localhost:5432/adotevl?sslmode=disable" JWT_SECRET=test-secret RESEND_API_KEY=re_fake npm run test:e2e
```

## Documentação das rotas

Com o servidor rodando, acesse a documentação interativa completa em:

```
http://localhost:3000/docs
```

O Swagger lista todas as rotas disponíveis, parâmetros esperados e permite testar os endpoints diretamente pelo navegador.

## Observações

- O banco é criado automaticamente ao subir o servidor (TypeORM `synchronize: true`).
- Os perfis padrão (ADMIN, FINANCIAL, VOLUNTEER) são seedados automaticamente na primeira execução.
- O primeiro usuário criado em uma organização recebe automaticamente o perfil ADMIN.
- Usuários só conseguem fazer login após confirmar a conta.
