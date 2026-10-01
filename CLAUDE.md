# CLAUDE.md — adotevl-backend

API REST do sistema de gestão de adoção de pets da AdoteVL. Front-end em `../react-tailwind-adotevl` (React + Vite).

## Stack
- NestJS 11 + TypeScript (config não estrita: `strict: false`, `strictNullChecks: false`)
- TypeORM 0.3 + Postgres (produção no Supabase; `synchronize: true`, **sem migrations** — entidade nova cria/altera tabela ao subir)
- Auth: JWT (`passport-jwt`) + bcryptjs
- Validação: `class-validator` / `class-transformer` (`ValidationPipe` global com `whitelist: true`, **sem** `transform`)
- Swagger em `/docs` (`@nestjs/swagger`)
- Storage de arquivos: Supabase Storage (`src/storage`), ou disco local com `STORAGE_DRIVER=local`
- E-mail: Resend (`src/mail`)
- Deploy: Railway (`npm run build` → `node dist/main`)

## Scripts
| Comando | O que faz |
|---|---|
| `npm run start:dev` | nodemon + ts-node em `src/main.ts` |
| `npm run build` | `tsc -p tsconfig.json` (exclui `test/` e `scripts/`) |
| `npm test` | Testes unitários (Jest + ts-jest em `src/**/*.spec.ts`, sem banco) |
| `npm run test:cov` | Unitários com cobertura (services, guards, helpers, DTO de fichas) |
| `npm run test:e2e` | Jest + ts-jest em `test/*.e2e-spec.ts` (precisa de Postgres; CI usa `postgres:15`) |
| `npm run seed:dev` | Organização + admin de dev (só roda com `DATABASE_URL` em localhost) |


## Ambiente local
- `.env.local` (copiado de `.env.local.example`) tem precedência sobre `.env` (`ConfigModule.forRoot({ envFilePath: ['.env.local', '.env'] })`).
- `DATABASE_URL` com `?sslmode=disable` desliga SSL (Supabase exige SSL; Postgres local não).
- Login de dev: `admin@adotevl.local` / `admin123`. O seed imprime os IDs para o `.env` do front.

## Estrutura
Um diretório por feature em `src/`, nomes em inglês kebab-case:
```
src/<feature>/
  <feature>.entity.ts
  <feature>.service.ts
  <feature>.controller.ts
  <feature>.module.ts
  dto/create-<feature>.dto.ts
  dto/update-<feature>.dto.ts
```
- `src/common/` — `PaginationDto` e `paginate(repo, pagination, where?, relations?, order?)` → `{ data, total, page, limit, totalPages }`.
- `src/auth/` — `JwtAuthGuard`, `RolesGuard`, `@Roles(...)`, `OptionalJwtAuthGuard` (rota pública que aceita token opcional).
- `src/storage/` — `StorageService.upload(path, buffer, mimetype)` → URL pública; `remove(paths)`. Módulo `@Global`.
- `src/mail/` — `MailService` (Resend).

**Toda entidade nova precisa ser registrada em `src/app.module.ts` (array `entities` + módulo em `imports`) e em `test/test-app.module.ts`.**

## Convenções
### Entidades
- PK `@PrimaryGeneratedColumn('uuid')`.
- Tabela no plural snake_case (`@Entity('pet_photos')`); propriedades camelCase com coluna snake_case via `name:` (`@Column({ name: 'zip_code' })`).
- Campos de auditoria em todas: `isActive` (soft delete), `createdBy`, `updatedBy` (id do usuário), `createdAt`/`updatedAt` (`CreateDateColumn`/`UpdateDateColumn`).
- Multi-tenant por organização: `@ManyToOne(() => Organization)` + coluna `organizationId`.
- Enums TS com valores em português maiúsculo (`DISPONIVEL`, `EM_PROCESSO`...), coluna `type: 'enum'`.
- Datas com hora: preferir `timestamptz` (coluna `timestamp` sem fuso desloca o horário).
- Relação de fotos: entidade `<feature>-photo.entity.ts` com `url`, `storagePath`, `onDelete: 'CASCADE'`, relação chamada `fotos`.

### DTOs
- `class-validator` com mensagens em **PT-BR** (`{ message: 'CPF deve conter 11 dígitos numéricos.' }`).
- `@ApiProperty`/`@ApiPropertyOptional` com `description` em PT-BR.
- Update DTO: classe com tudo `@IsOptional()` ou `PartialType(...)` de `@nestjs/swagger`.
- Multipart (tudo string): usar `@Transform` e `@Body(new ValidationPipe({ whitelist: true, transform: true }))` na rota.

### Controllers
- `@ApiTags('<Nome em PT>')`, `@Controller('<rota-kebab-plural>')`.
- Rota protegida: `@ApiBearerAuth()` + `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN', ...)`.
- `@ApiOperation({ summary: '...', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })` — sempre listar os perfis; rotas públicas dizem "Rota pública".
- Usuário logado: `req.user` = `{ id, email, profileId, profileName, organizationId }`. Passar `req.user.id` para `createdBy/updatedBy` e filtrar por `req.user.organizationId`.
- Perfis: `ADMIN`, `FINANCIAL`, `VOLUNTEER` (seed automático em `ProfileService.onModuleInit`).
- Ids de rota: `ParseUUIDPipe`.

### Services
- Erros com exceptions do Nest e mensagem PT-BR (`NotFoundException('Pet não encontrado.')`).
- Remoção = soft delete (`isActive: false`) retornando `{ message: '... com sucesso.' }`.
- Upload: validar mimetype (`image/jpeg|png|webp`), limite de quantidade/tamanho via `FilesInterceptor`, path `<pasta>/<id>/<uuid><ext>`, e no `catch` remover arquivos já enviados para não deixar órfãos (ver `PetService.addPhotos`).
- Rota pública não expõe dados internos (ver `PetService.findAllPublic`).

### Testes
- Unitários ao lado do arquivo testado (`<arquivo>.spec.ts`), um por service/guard/helper. Instanciar a classe direto com dependências falsas — sem `Test.createTestingModule` e sem banco.
- Repositório falso: `createMockRepository()` de `src/testing/mock-repository.ts` (`create` devolve o próprio objeto, `save` resolve o objeto, `findAndCount` resolve `[[], 0]`). `src/testing` e `*.spec.ts` ficam fora do build.
- Libs externas com `jest.mock` (`bcryptjs`, `resend`, `@supabase/supabase-js`, `fs/promises`); variáveis usadas na factory com prefixo `mock`.
- DTOs com regra relevante: `plainToInstance` + `validate` (ver `adoption-form/dto/create-adoption-form.dto.spec.ts`).
- E2E de fluxo completo por feature em `test/<feature>-lifecycle.e2e-spec.ts`, usando `TestAppModule` (mock de `MailService` e `StorageService`).
- Cada suite cria/limpa a própria organização (CNPJ fixo único por suite) e um admin, e faz login via `/auth/login`.
- Textos de teste (`describe`/`it`/comentários) em PT-BR.

### Estilo
- Prettier: `singleQuote`, `trailingComma: all`. Linhas longas são aceitas.
- Comentários curtos em PT-BR explicando o *porquê*.

## Git
- Branches: `feat/<kebab-en>`, `fix/<kebab-en>`, a partir de `develop`. PR para `develop`; `develop` → `main` (merge em `main` sincroniza `develop` via Action).
- Commits Conventional Commits em inglês (`feat: add pet photos upload...`, `fix: ...`, `refactor: ...`).
- CI (`.github/workflows/test.yml`): `npm ci` + `npm test` + `npm run test:e2e` com Postgres 15.

## Módulos
organization, organization-address, profile, user, auth, pet (+fotos), medical-record, team, volunteer, campaign, financial (entries/expenses/balance), partner, bank-account, adoption-form (+fotos), mail, storage.

### adoption-form
Ficha do formulário público `/adocao` do front (`src/pages/Adoption/AdoptionFormPage.tsx`, payload em `src/mappers/adoptionForm.ts`) e gestão em `/adotantes`.
- `POST /adoption-forms` público, multipart, 1–6 fotos em `photos`; retorna só `{ id, status, createdAt, message }`.
- `GET` (paginado, `status`, `search`), `GET :id`, `PUT :id`, `PATCH :id/status`, `POST/DELETE :id/photos` — ADMIN, VOLUNTEER; `DELETE :id` — ADMIN. Sempre escopo da organização do usuário.
- Valores das múltiplas escolhas espelham `src/constants/adoptionFormOptions.ts` do front — mudou lá, mudar em `dto/create-adoption-form.dto.ts`.
- Respostas condicionais: validadas e limpas em `AdoptionFormService.normalizeAnswers` (tabela `CONDITIONAL_ANSWERS`).
- Status: `PENDENTE`, `EM_ANALISE`, `APROVADO`, `REPROVADO`.
