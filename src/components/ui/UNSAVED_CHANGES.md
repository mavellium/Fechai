# Alterações não salvas

`PanelShell` monta `UnsavedChangesProvider`. Formulários com salvamento explícito
usam `UnsavedForm` com `label`, `action` e o `result` retornado por `useActionState`.
O formulário só atualiza a referência salva quando `result.ok` confirma sucesso;
falhas preservam o conteúdo. Edições feitas durante o envio continuam pendentes.
`resetOnSuccess` serve aos cadastros que devem ficar vazios depois de criar.

Para um envio automático fora do submit, chame `trackFormSubmission(form)`
imediatamente antes da action, com os controles refletindo os valores enviados.
Não marque como salvo ao iniciar a requisição.

Editores controlados sem formulário usam `useUnsavedChanges(dirty, label, ref)`.
Abas, botões que desmontam editores e fechamento de diálogos usam
`useUnsavedNavigation()(proceed, scope?)`. O escopo limita a consulta aos editores
daquele diálogo. No Esc, impeça o fechamento nativo antes de consultar o guard;
o componente `Modal` já delega essa decisão ao seu `onClose`.

Links comuns, sair da conta (`data-leave-page`), recarregar e Voltar/Avançar do
navegador são tratados pelo provider. Navegação programática nova precisa passar
pelo guard. Não use o guard no fechamento após confirmação de salvamento.

Os rascunhos ficam somente na memória da tela. O aviso não é armazenamento
automático nem recuperação após o usuário confirmar sair sem salvar.
