# Scheduling — histórico

Atualize este arquivo ao alterar o módulo.

### 2026-09-29 — Público dinâmico e categorias automáticas

Arquivos: config, clinicorp, tools, actions, UI, workers, testes, README.

Razão: envio externo incluía outros tipos; lista inicial omitia Avaliação.

Impacto: categorias automáticas e ordenadas; atualização manual; tipo desconhecido excluído; overrides respeitam público. Sem schema novo.

### 2026-10-09 — Confirmações QR autorizadas

Config/categorias, claim SQL, recibos, agenda manual/status e teste sandbox.
Motivo: avaliações externas sem histórico e confirmação duplicada.
Schema aditivo exige db push/client web+worker. PostgreSQL isolado validado.

Publicação d71d73c e teste posterior aprovados: 1.619 testes, SQL real, leitura
Clinicorp e resposta salva no sandbox. Entrega real não testada; opt-in QR desligado.
