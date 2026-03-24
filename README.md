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
```

> Para obter a `DATABASE_URL`, acesse o projeto no [Supabase](https://supabase.com) → Connect → ORM → TypeORM.
> Atenção: caracteres especiais na senha devem ser URL-encoded (`@` → `%40`, `#` → `%23`).

## Rodando o projeto

```bash
npm run start:dev
```

A API estará disponível em `http://localhost:3000`.

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
