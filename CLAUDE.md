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
- Assinatura digital: Autentique API v2 GraphQL (`src/autentique`, `fetch` nativo)
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
- Autentique: `AUTENTIQUE_TOKEN`, `AUTENTIQUE_SANDBOX=true` (documentos de teste, sem créditos, somem em alguns dias; `false` em produção) `AUTENTIQUE_FOLDER_ID` (id da pasta do painel onde os termos ficam salvos — "Termos de adoção" = `7769248f814defa83476a26255cedb252219bfdf`; vazio = raiz; ids das pastas via query `folders`) e `AUTENTIQUE_WEBHOOK_SECRET` (secret do webhook cadastrado no painel; sem ele o webhook responde 401). Sem URL pública em dev, use o botão "Atualizar status" (`POST :id/contract/signature/sync`).
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
- `src/autentique/` — `AutentiqueService` (`createDocument`, `getDocument`, `deleteDocument`, `downloadFile`). Módulo `@Global`; token lido sob demanda (sem `AUTENTIQUE_TOKEN` → 503).
- `src/webhooks/` — rotas públicas chamadas por serviços externos (`POST /webhooks/autentique`), sem JWT, validadas por HMAC.

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
- E2E de fluxo completo por feature em `test/<feature>-lifecycle.e2e-spec.ts`, usando `TestAppModule` (mock de `MailService`, `StorageService` e `AutentiqueService` — `MockAutentiqueService.signDocument/rejectDocument` simulam o adotante).
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
organization, organization-address, profile, user, auth, pet (+fotos), medical-record, team, volunteer, campaign, financial (entries/expenses/balance), partner, bank-account, adoption-form (+fotos), adoption-history, adoption-contract, autentique, webhooks, mail, storage.

### adoption-form
Ficha do formulário público `/adocao` do front (`src/pages/Adoption/AdoptionFormPage.tsx`, payload em `src/mappers/adoptionForm.ts`) e gestão em `/adotantes`.
- `POST /adoption-forms` público, multipart, 1–6 fotos em `photos`; retorna só `{ id, status, createdAt, message }`.
- `GET` (paginado, `status`, `search`), `GET :id`, `PUT :id`, `PATCH :id/status`, `POST/DELETE :id/photos` — ADMIN, VOLUNTEER; `DELETE :id` — ADMIN. Sempre escopo da organização do usuário.
- Valores das múltiplas escolhas espelham `src/constants/adoptionFormOptions.ts` do front — mudou lá, mudar em `dto/create-adoption-form.dto.ts`.
- Respostas condicionais: validadas e limpas em `AdoptionFormService.normalizeAnswers` (tabela `CONDITIONAL_ANSWERS`).
- Status (ordem do kanban): `PENDENTE`, `APROVADO`, `CONTRATO_GERADO` (rótulo "Termo gerado"), `AGUARDANDO_ASSINATURA`, `CONCLUIDA`, `REPROVADO` (`ADOPTION_FORM_STATUS_ORDER`/`_LABELS` em `adoption-form.entity.ts`). `EM_ANALISE` é legado: fica no enum só por causa do histórico; `AdoptionFormService.onModuleInit` move fichas que ainda estejam nele para `PENDENTE`.
- Nomenclatura na interface e nas mensagens: "Termo de adoção" (o código continua `contract`/`CONTRATO_*`).
- Regras do `PATCH :id/status` (`AdoptionFormService.validateTransition`, em transação com o histórico):
  - mesmo status → só atualiza `reviewNotes` (evento `FICHA_EDITADA` se mudou);
  - `PENDENTE/APROVADO/REPROVADO` livres entre si; saindo de `APROVADO` para `PENDENTE/REPROVADO` o pet vinculado volta a `DISPONIVEL`;
  - `CONTRATO_GERADO` nunca manual (só via `POST :id/contract/generate`);
  - `AGUARDANDO_ASSINATURA` e `CONCLUIDA` nunca manuais: envio ao Autentique e assinatura do adotante (que conclui a adoção);
  - de `CONTRATO_GERADO/AGUARDANDO_ASSINATURA/CONCLUIDA` só volta para `APROVADO` e só ADMIN (403) → pet `EM_PROCESSO`, `adoptionDate` null; saindo de `AGUARDANDO_ASSINATURA` o documento é excluído no Autentique (best effort) e a assinatura fica `CANCELADO`.
- `pet`/`petId` (nullable, `SET NULL`): pet escolhido no contrato. `GET :id` devolve `pet: { id, name, species, fotos[{url}] } | null`.
- `GET /adoption-forms/board?search=` → `{ columns: [{ status, total, items }] }` (6 colunas, até 50 itens resumidos, `updatedAt DESC`). Declarada antes de `:id`.
- `GET /adoption-forms/:id/history` → eventos da ficha (`createdAt DESC`).
- Toda ação da ficha grava histórico: criar (`FICHA_CRIADA`, usuário "Formulário público"), editar (`FICHA_EDITADA` com `metadata.fields` [{field,label,before,after}] — rótulos em `adoption-form-labels.ts`), fotos, remover.
- `birthDate` é gravado com `localDate()` (meia-noite local): o TypeORM grava coluna `date` pelo dia local; `new Date('YYYY-MM-DD')` voltaria um dia em UTC-3. O driver pg devolve `date` como Date à meia-noite local — use `dateOnly()` de `adoption-contract/contract-data.ts`.

### adoption-history
- Entidade `adoption_history_events` (só insert): `adoptionFormId` (CASCADE), `organizationId`, `adopterName` (snapshot), `type` (`AdoptionHistoryType`), `fromStatus/toStatus`, `description` PT-BR pronta, `metadata` jsonb, `userId`, `userName` (snapshot). Índices (`organizationId`, `createdAt`) e (`adoptionFormId`).
- `AdoptionHistoryService.record(params, manager?)` / `recordMany` — passe o `EntityManager` para gravar na mesma transação; `userName` é resolvido do `User` (sem usuário = "Formulário público").
- `GET /adoption-history?page&limit&type&adoptionFormId&search&from&to` — ADMIN, VOLUNTEER. `search` = nome do adotante; `from/to` = YYYY-MM-DD inclusivos, dia local (UTC-3).

### adoption-contract
Termo de adoção da ficha (1 por ficha, `adoption_contracts`). Rotas em `AdoptionContractController` (`@Controller('adoption-forms')`), ADMIN e VOLUNTEER; ficha precisa estar `APROVADO`, `CONTRATO_GERADO`, `AGUARDANDO_ASSINATURA` ou `CONCLUIDA` (as duas últimas só leitura).
- `GET :id/contract` cria o rascunho na primeira chamada (dados da ficha + pet vinculado, `contract-data.ts`).
- `PUT :id/contract` `{ petId?, data?, clauses? }`: `data` é sanitizado para as chaves conhecidas (`CONTRACT_DATA_FIELDS`); `clauses` precisa ter todas as chaves, sem remover a travada (`animal`). Um evento por mudança (`PET_VINCULADO`, `CONTRATO_DADOS_ALTERADOS`, `CLAUSULA_EDITADA/REMOVIDA/RESTAURADA`). Vincular pet: pet `EM_PROCESSO`, anterior volta a `DISPONIVEL`.
- `POST :id/contract/clauses/:key/reset`, `POST :id/contract/generate` (exige pet + nome/CPF; PDF em `contracts/<formId>/v<n>.pdf` no bucket **privado**, `version++`, ficha `APROVADO` → `CONTRATO_GERADO`, evento `CONTRATO_GERADO` com `storagePath`). `pdfUrl` e `versions[].url` são URLs assinadas.
- Assinatura digital (Autentique, só o adotante assina, link por e-mail):
  - `POST :id/contract/signature` (ficha `CONTRATO_GERADO`): baixa o PDF da versão atual (`StorageService.downloadPrivate`), `createDocument` (sandbox conforme env), grava `autentiqueDocumentId`, `signatureStatus=PENDENTE`, `signatureEmail/Link/Version/SentAt`; ficha → `AGUARDANDO_ASSINATURA`, evento `CONTRATO_ENVIADO_ASSINATURA`. Falha no banco exclui o documento criado.
  - `POST :id/contract/signature/sync` e `POST /webhooks/autentique` (eventos `signature.accepted`, `signature.rejected`, `document.finished`; header `X-Autentique-Signature` = HMAC-SHA256 hex do corpo cru, `rawBody: true` no `main.ts`) chamam `syncSignature`: consulta `getDocument` (fonte da verdade, nunca o payload), acha a assinatura pelo e-mail (a lista também traz o dono da conta). Assinado → PDF assinado em `contracts/<formId>/assinado-v<n>.pdf`, `ASSINADO`, adoção concluída na mesma transação (ficha → `CONCLUIDA`, pet `ADOTADO` + `adoptionDate`), eventos `CONTRATO_ASSINADO` + `ADOCAO_CONCLUIDA`; recusado → `RECUSADO`, ficha volta `CONTRATO_GERADO`, evento `ASSINATURA_RECUSADA`. Eventos com `userName` "Autentique". Idempotente (só age com `PENDENTE`); se a ficha já saiu de `AGUARDANDO_ASSINATURA`, só o contrato muda.
  - `DELETE :id/contract/signature` (ADMIN, ficha `AGUARDANDO_ASSINATURA`): `deleteDocument`, `CANCELADO`, ficha volta `CONTRATO_GERADO`, evento `ASSINATURA_CANCELADA`.
  - Resposta do contrato: `signature: { status, email, link, version, sentAt, signedAt, signedPdfUrl } | null`.
- `contract-template.ts`: 14 cláusulas do modelo .docx (`content` = texto após "CLÁUSULA X:", linhas com `\n`, blocos com `\n\n`, itens `(a) ...`, "Parágrafo ..."), referências como `{{clausula:<key>}}`, dados fixos da entidade em `CONTRACT_ORGANIZATION`.
- `contract-numbering.ts`: `toOrdinalPt`, `numberClauses` (ignora removidas, numera por `order`, resolve tokens para "Cláusula Terceira"; referência a removida vira "[cláusula removida]" + aviso). O front replica em `src/mappers/adoptionContract.ts`.
- Data do termo: sem `data.signature.date`, `generate` usa a data do dia em Brasília (`todayInBrazil`) só no PDF (não grava no rascunho). O PDF não traz a observação "(local e data da assinatura)".
- Assinatura no campo ADOTANTE: `buildContractPdf` devolve `{ buffer, adopterSignature }`; a linha do adotante tem `id: 'adopter-signature-line'` e o `pageBreakBefore` do pdfmake (que nunca quebra página) lê página/altura dela. `toAutentiquePosition` converte em % do carimbo do Autentique (canto superior esquerdo, ~98 x 28 pt, centralizado na coluna, logo acima da linha). Gravado em `adopterSignaturePosition` na geração e enviado como `positions` (`element: SIGNATURE`) no `createDocument`; termos gerados antes disso vão sem posição.
- `contract-pdf.builder.ts`: pdfmake 0.3 (instância única do `require('pdfmake')`, fontes padrão Helvetica, sem acesso a disco/URL); logo em `assets/logo.base64.ts` (tsc não copia assets); foto do pet baixada com `fetch` (só PNG/JPEG; falha = sem foto).
