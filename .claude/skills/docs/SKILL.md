name: module-docs
description: >
  Cria documentação completa de um módulo (domain, actions, queries) em `.claude/context/[modulo]/`.
  Economiza tokens em futuras sessões ao invés de ler código-fonte inteiro.
  Estrutura similar ao CMS: _index.md (sumário), domain.md, actions.md, queries.md, patterns.md, changelog.md.

instructions: >
  ## Objetivo
  Analisar um módulo e gerar documentação compacta (~2-5KB por arquivo) em `.claude/context/[modulo]/`.

  ## Entrada (Obrigatória)
  Módulo a documentar (ex: "auth", "users", "projects", "admin"):
  - **Busca em:** `src/modules/[modulo]/domain/`, `src/modules/[modulo]/actions/`, `src/modules/[modulo]/queries/`
  - **Saída em:** `.claude/context/[modulo]/` (cria pasta se não existir)

  ## Estrutura de Saída

  ```
  .claude/context/[modulo]/
  ├── _index.md           ← Sumário executivo (1 min)
  ├── domain.md           ← Entidades, interfaces, erros
  ├── actions.md          ← Server Actions (mutations)
  ├── queries.md          ← Queries (read-only)
  ├── patterns.md         ← Snippets reutilizáveis
  └── changelog.md        ← Histórico de changes
  ```

  ## Formato de Cada Arquivo

  ### _index.md (Sumário Executivo)
  - 1 linha: O que é o módulo
  - Tabela: Responsabilidades principais (Domain, Actions, Queries)
  - Links para outros arquivos
  - Checklist: "Para usar este módulo, você deve saber..."

  **Máximo 1KB**

  ### domain.md (Entidades + Interfaces)
  ```markdown
  # [Modulo] — Entidades e Domínio

  ## Entidade: [Nome]
  - **Tipo:** TypeScript interface / Prisma model
  - **Campos:** id (UUID), name (string), status (enum), createdAt (timestamp)
  - **Invariantes:** (regras de negócio imutáveis)
  - **Métodos:** (se classe: constructor, toObject(), validate())

  ## Erros
  - ERROR_NAME (número/string único) — quando ocorre, por quê, como tratar

  ## Interfaces/Types
  - InputDTO — o que espera como entrada
  - OutputDTO — o que retorna
  ```

  **Máximo 2KB**

  ### actions.md (Server Actions)
  ```markdown
  # [Modulo] — Server Actions

  ## createEntity
  - **Assinatura:** `async (input) => Promise<{ ok, data?, error?, code? }>`
  - **Validação:** Zod schema (1 linha: campo1: string, campo2: number)
  - **Fluxo:** 1. Validação → 2. Auth check → 3. DB operation → 4. revalidatePath
  - **Autorização:** role ou permission (1 linha)
  - **Erro comum:** [cenário] → retorna ERROR_X

  ## updateEntity
  - ...

  ## deleteEntity (soft/hard)
  - ...

  ## Copy-Paste Pattern
  ```typescript
  // Nome exato da action + tipo de input/output
  ```

  **Máximo 3KB**

  ### queries.md (Read-Only)
  ```markdown
  # [Modulo] — Queries

  ## getEntityById
  - **Retorna:** Entity | null
  - **Filtros:** sempre `deletedAt: null` (se soft delete)
  - **Select:** campos relevantes apenas (não *; não campos sensíveis)
  - **Uso:** `const entity = await getEntityById(id)`

  ## listEntities
  - **Retorna:** Entity[]
  - **Paginação:** offset/limit ou cursor (1 linha)
  - **Ordenação:** padrão (1 linha)

  **Máximo 2KB**

  ### patterns.md (Copy-Paste)
  ```markdown
  # [Modulo] — Padrões de Código

  ## Server Action Template
  ```typescript
  // Copie exatamente isso
  ```

  ## Client Component Hook
  ```typescript
  // useCreateEntity pattern
  ```

  ## Query Usage
  ```typescript
  // Como ler dados no servidor
  ```

  **Máximo 2KB**

  ### changelog.md (Histórico)
  ```markdown
  # [Modulo] — Histórico

  **Instrução:** Atualize aqui cada vez que mexer neste módulo.

  ### [YYYY-MM-DD] — Descrição

  **Arquivos:**
  - `domain/Entity.ts`: mudança (1 linha)

  **Razão:** por quê mudou

  **Impacto:** como afeta consumidores deste módulo
  ```

  **Máximo 500 bytes inicialmente**

  ## Passos de Execução

  1. **Ler estrutura do módulo:**
     - Listar `src/modules/[modulo]/domain/*.ts`
     - Listar `src/modules/[modulo]/actions/*.ts`
     - Listar `src/modules/[modulo]/queries/*.ts`

  2. **Extrair informações:**
     - Para cada `domain/*.ts`: entidade, interface, enum, erro
     - Para cada `action/*.ts`: nome, validação Zod, fluxo (3 linhas max), retorno
     - Para cada `query/*.ts`: nome, retorno, filtros principais

  3. **Gerar arquivos em `.claude/context/[modulo]/`:**
     - Use a estrutura acima
     - Máximo 5KB total (distribua entre 6 arquivos)
     - Links internos: `domain.md` referenciado em `_index.md`
     - Padrões copiados de `src/modules/[modulo]/actions/*` (snippet real)

  4. **Atualizar `.claude/context/[modulo]/changelog.md`:**
     - Primeira entry: `[YYYY-MM-DD] — Documentação inicial`
     - Arquivos: lista de ações/queries/domain criadas
     - Razão: "Economizar tokens em futuras sessões"

  5. **Adicionar índice em `.claude/README.md`:**
     - Nova seção "Módulos Documentados" se não existir
     - Link para `.claude/context/[modulo]/_index.md`

  ## Regras Absolutas

  1. **Concisão:** 1 linha por action/query (descrição, não código completo)
  2. **Código Real:** Padrões copiados diretamente de `src/modules/[modulo]/actions/*`
  3. **Sem Duplicação:** Não copie o código inteiro; extraia essência (tipo, validação, fluxo)
  4. **Sem Especulação:** Apenas o que pode ser lido de `src/modules/[modulo]/*`

  ## Exemplo: auth module

  ```
  .claude/context/auth/
  ├── _index.md
  │   - Autenticação JWT, sign in/up/out, session management
  │   - | Aspecto | Responsável |
  │   - | Entidade | User (email, senha, role) |
  │   - | Actions | signInAction, registerUser, changePassword |
  │   - | Queries | getUserByEmail, getSession |
  │
  ├── domain.md
  │   - User interface: email, password, role, permissions
  │   - Erros: INVALID_CREDENTIALS, EMAIL_ALREADY_EXISTS
  │
  ├── actions.md
  │   - signInAction: email/password → { user, token }
  │   - registerUser: email/password → { user } (cria)
  │   - changePassword: oldPassword/newPassword → { ok }
  │
  ├── queries.md
  │   - getUserByEmail: (email) → User | null (sem senha)
  │   - getSession: () → { user, permissions }
  │
  ├── patterns.md
  │   - Server Action template (use server, auth check, revalidatePath)
  │   - Client form pattern (useActionState + Zod)
  │
  └── changelog.md
      - [2026-05-19] Documentação inicial
  ```

  ## Saída Esperada

  Ao finalizar:
  - ✅ Pasta `.claude/context/[modulo]/` criada com 6 arquivos
  - ✅ README.md atualizado com novo link
  - ✅ 5-10KB total de documentação (tokens economizados: 50-100KB de código)
  - ✅ Próxima sessão: "Leia `.claude/context/auth/_index.md` (1 min)" em vez de 30 min lendo código
