# Bitrix24 — escrita

Server Actions em `src/app/(dashboard)/integracoes/bitrix-actions.ts`:

- `saveBitrixAction(previous, FormData): Promise<ActionResult>`: produto/sessão/tenant ativo → webhook até 512 caracteres, opções checkbox, responsável numérico → saveBitrix → revalidate `/integracoes`; webhook vazio mantém atual.
- `manageBitrixAction(previous, FormData): Promise<ActionResult>`: mesmo guard; test/pause/resume/disconnect/retry/resolve; resolve valida jobId/confirmedMissing; revalida. Erros: forbidden/validation/server. Tenant nunca vem do formulário.

integration.ts: saveBitrix verifica/cifra; setBitrixEnabled altera revision; disconnectBitrix apaga webhook; retryBitrix antecipa retries sem limpar uncertain; resolveUncertainBitrix usa claim/busca origem. Só confirmação humana + busca vazia libera nova tentativa após 5 min.

worker.ts: enqueueBitrix preserva IDs; captureBitrix: lotes 100/sobreposição 1 min; processBitrixJob: claim 5 min renovado/fingerprint; scanBitrixSync: 30s, 3 leads/2 consultas por conta na fila bitrix-crm-sync. 
