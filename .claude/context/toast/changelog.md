# toast — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-09-29] — Documentação inicial + sistema de toast

**Arquivos:**
- `ui/toast/*`: Provider, viewport (popover), hooks, serviço, mensagens, testes
- `shell/PanelShell.tsx`: monta `ToastProvider`; 23 formulários usam `useActionToast`

**Razão:** feedback consistente de salvamento; economizar tokens em futuras sessões.

**Impacto:** telas novas de salvar usam `useActionToast`/`useSaveFeedback`.
