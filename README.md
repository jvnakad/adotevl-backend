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
JWT_SECRET=sua_chave_secreta
RESEND_API_KEY=sua_chave_resend
MAIL_FROM=AdoteVL <noreply@seudominio.com>
APP_URL=http://localhost:5173
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
SUPABASE_STORAGE_BUCKET=pet-photos
```

> Para obter a `DATABASE_URL`, acesse o projeto no [Supabase](https://supabase.com) → Connect → ORM → TypeORM.
> Atenção: caracteres especiais na senha devem ser URL-encoded (`@` → `%40`, `#` → `%23`).
>
> As fotos dos pets são armazenadas no Supabase Storage. Crie um bucket **público** com o nome definido em `SUPABASE_STORAGE_BUCKET` (padrão `pet-photos`) e use a `service_role` key em Project Settings → API.
>
> Para obter a `RESEND_API_KEY`, acesse [resend.com](https://resend.com) e crie uma API key. O domínio remetente deve estar verificado no Resend.

## Rodando o projeto

```bash
npm run start:dev
```

A API estará disponível em `http://localhost:3000`.

## Ambiente local (sem Supabase)

Para desenvolver sem acesso ao Supabase, suba um Postgres em Docker e use o storage em disco:

```bash
npm run db:up                         # Postgres 15 em localhost:5433 (docker-compose.yml)
cp .env.local.example .env.local      # .env.local tem precedência sobre o .env
npm run start:dev                     # cria as tabelas (synchronize) e os perfis padrão
npm run seed:dev                      # organização "AdoteVL Dev" + admin@adotevl.local / admin123
```

O `seed:dev` imprime as variáveis para o `.env` do front (`VITE_API_URL`, `VITE_ORGANIZATION_ID`, `VITE_PROFILE_*`).

Com `STORAGE_DRIVER=local` as fotos são gravadas em `./uploads` e servidas em `http://localhost:3000/uploads/...`.

Testes e2e contra o banco local:

```bash
DATABASE_URL="postgresql://adotevl:adotevl@localhost:5433/adotevl?sslmode=disable" JWT_SECRET=test-secret RESEND_API_KEY=re_fake npm run test:e2e
```

Para parar o banco: `npm run db:down` (os dados ficam no volume `adotevl-pgdata`).

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
