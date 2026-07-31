# Custo e escalabilidade de LLM — para quando o free tier do Gemini acabar

**Data:** 24/07/2026 · **Contexto:** agente de WhatsApp multi-tenant (chat + function calling + embeddings RAG).

> **Aviso sobre as fontes.** Preços de LLM mudam mês a mês e boa parte dos números abaixo vem de agregadores, não das páginas oficiais. Trate como ordem de grandeza para decidir direção — confirme na fonte oficial antes de fechar contrato ou anunciar preço ao cliente: [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing), [platform.claude.com/docs/en/pricing](https://platform.claude.com/docs/en/pricing), [openai.com/api/pricing](https://openai.com/api/pricing).

---

## 1. O que você usa hoje (free tier do Gemini)

| Modelo | RPM | Req/dia | TPM |
|---|---|---|---|
| `gemini-2.5-flash` ← **ativo** | 10 | **250** | 250k |
| `gemini-2.5-flash-lite` | 15 | **1.000** | 250k |
| `gemini-2.5-pro` | 5 | 100 | 250k |

**Três armadilhas que valem mais que o preço:**

1. **A cota é da CHAVE, não do tenant.** Sua arquitetura é multi-tenant com uma `GEMINI_API_KEY` só. Os 250 req/dia são o teto da **plataforma inteira** — 10 clientes ativos dividem os mesmos 250. Não é "250 por cliente".
2. **Embeddings consomem a mesma cota.** Cada documento indexado e cada pergunta com RAG gasta requisição.
3. **O Google corta o free tier sem aviso** (cortou 50–80% em dez/2025). Não dá para prometer volume a cliente pagante em cima disso.

**Teto prático:** ~250 req/dia ÷ ~8 turnos por conversa ≈ **30 conversas/dia na plataforma toda**. Trocar para Flash-Lite sobe para ~125 conversas/dia — a troca já está pronta em `/admin/ia`, sem deploy.

---

## 2. Quanto custa de verdade no seu caso

**Consumo medido por turno** (persona + 4 chunks de RAG + 10 msgs de histórico + schemas das tools + mensagem): **~2.000 tokens de entrada, ~120 de saída**. Uma conversa de 8 turnos ≈ 16k entrada / 1k saída.

| Cenário | Conversas/dia | Turnos/mês | Entrada/mês | Saída/mês |
|---|---|---|---|---|
| **A** — validando | 20 | 4.800 | 9,6M | 0,6M |
| **B** — tração | 100 | 24.000 | 48M | 2,9M |
| **C** — escala | 1.000 | 240.000 | 480M | 29M |

### Custo mensal por provedor

| Modelo | US$/1M in | US$/1M out | **A** | **B** | **C** |
|---|---:|---:|---:|---:|---:|
| Gemini 2.5 Flash-Lite (free) | 0 | 0 | **$0** | ✖ estoura | ✖ |
| Gemini 2.5 Flash (free) | 0 | 0 | ✖ estoura | ✖ | ✖ |
| **Gemini 2.5 Flash (pago)** | 0,30 | 2,50 | **$4** | **$22** | **$217** |
| GPT-5.4 Nano | 0,20 | 1,25 | $3 | $13 | $132 |
| GPT-5.4 Mini | 0,75 | 4,50 | $10 | $49 | $491 |
| Claude Haiku 4.5 | 1,00 | 5,00 | $13 | $62 | $625 |
| GPT-5.6 Luna | 1,00 | 6,00 | $13 | $65 | $654 |
| Gemini 3.6 Flash | 1,50 | 7,50 | $19 | $94 | $938 |
| Gemini 3.1 Pro | 2,00 | 12,00 | $26 | $131 | $1.308 |
| Claude Sonnet 5 | 3,00 | 15,00 | $38 | $187 | $1.875 |
| GPT-5.6 Terra | 2,50 | 15,00 | $33 | $163 | $1.635 |
| Claude Opus 5 | 5,00 | 25,00 | $63 | $312 | $3.125 |

**O número que importa:** no cenário B, o Gemini 2.5 Flash pago custa **~R$ 120/mês** para atender 3.000 conversas. Se isso são 20 clientes pagando R$ 97, é **~2% da receita**. Custo de LLM não é o seu gargalo — Evolution API, suporte e churn são.

---

## 3. Comparativo estratégico

| Critério | Gemini | OpenAI | Anthropic | Self-hosted |
|---|---|---|---|---|
| **Preço no seu perfil** | 🥇 melhor (Flash) | 🥈 Nano é o mais barato | 🥉 caro na base | Só compensa em volume alto |
| **Free tier real** | ✅ único com free tier usável | ❌ | ❌ | n/a |
| **Function calling** | ✅ bom (schema OpenAPI restrito) | ✅ o mais maduro | ✅ excelente | ⚠️ irregular |
| **Português BR** | ✅ forte | ✅ forte | ✅ forte | ⚠️ cai muito |
| **Embeddings 1536d** | ✅ `outputDimensionality` | ✅ nativo | ❌ não oferece | ✅ |
| **Integração com seu stack** | ✅ já feita (REST, sem SDK) | ✅ já feita (SDK) | 🔧 adapter novo (~1h) | 🔧 adapter + infra |
| **Estabilidade da cota** | ⚠️ Google corta sem aviso | ✅ previsível | ✅ previsível | ✅ você controla |
| **Custo fixo** | $0 | $0 | $0 | ~$300–900/mês de GPU |

**Self-hosted (Llama/Mistral em GPU):** só faz sentido acima de ~1M turnos/mês. Abaixo disso, uma A10G/L4 24h custa mais que a API inteira — e você paga com engenharia (fila, retry, cold start, atualização de modelo) que hoje é problema do provedor. **Descarte por enquanto.**

---

## 4. Recomendação

### Agora → fique no Gemini free, mas com os olhos abertos

Continue no `gemini-2.5-flash` gratuito **enquanto valida o produto**. Assuma que o teto é ~30 conversas/dia na plataforma toda. Quando a primeira conta séria chegar, troque para **`gemini-2.5-flash-lite`** em `/admin/ia` (4x mais cota diária, zero deploy) antes de gastar dinheiro.

### Gatilho de saída → ative billing no mesmo modelo

**Migre para Gemini 2.5 Flash pago quando qualquer um acontecer:**
- 2+ clientes pagantes, ou
- erros `quota_exceeded` aparecendo nos logs (o `AiError` já marca a conversa como "precisa humano"), ou
- você prometer SLA de resposta a alguém.

**Por que esse e não outro:** é o **mesmo modelo, mesmo adapter, mesmo prompt** — ativar billing no Google AI Studio remove as cotas e você não muda uma linha de código nem re-testa qualidade. A US$ 22/mês para 3.000 conversas, o custo é ruído. Qualquer outra migração custa dias de trabalho para economizar dezenas de reais.

### Depois → diferencie por plano, não por economia

Quando tiver escala e clientes exigentes:
- **Plano FREE/STARTER** → Gemini 2.5 Flash (o mais barato que atende).
- **Plano PRO/BUSINESS** → **Claude Sonnet 5** ou Gemini 3.1 Pro como diferencial vendável ("IA premium"). Sonnet 5 está com preço promocional de **$2/$10 até 31/08/2026** (vs. $3/$15) — vale testar agora enquanto está barato. A abstração já suporta: basta um adapter novo em `src/modules/ai/providers/` e uma entrada no catálogo.
- **Não pague por inteligência que o caso de uso não usa.** Atender lead, qualificar e agendar horário é tarefa de modelo pequeno. Opus 5 (US$ 3.125/mês no cenário C) resolveria o mesmo problema que o Flash resolve por US$ 217.

### Duas alavancas que valem mais que trocar de modelo

1. **Cache de prompt.** Persona + schemas das tools são idênticos em toda mensagem de um tenant (~700 dos ~2.000 tokens de entrada). Cache reduz isso a ~10% do preço → **corta ~30% da conta** sem trocar nada. Gemini e Anthropic suportam; vale implementar antes de qualquer migração.
2. **Cortar o RAG quando não ajuda.** Hoje sempre buscamos 4 chunks (~800 tokens). Pular a busca quando o score de similaridade é baixo economiza mais que a diferença entre dois provedores baratos.

---

## 5. Resumo em uma linha

**Fique no Gemini** — o free tier segura a validação, o Flash pago segura a escala a custo irrelevante, e a camada de abstração já construída garante que trocar de provedor no futuro seja uma tarde de trabalho, não uma migração. A decisão só muda se qualidade em português virar reclamação de cliente; aí o teste é Claude Sonnet 5 no plano premium, não uma troca geral.

---

### Fontes

- [Gemini API Free Tier 2026: Limits, Quotas](https://pecollective.com/tools/gemini-free-tier-guide/) · [TokenMix — free tier limits](https://tokenmix.ai/blog/gemini-api-free-tier-limits) · [YingTu — quotas e paid tiers](https://yingtu.ai/en/blog/gemini-api-free-tier)
- [Gemini API Pricing (Jul 2026) — BenchLM](https://benchlm.ai/google/api-pricing) · [CloudZero — Gemini pricing](https://www.cloudzero.com/blog/gemini-pricing/) · [Morph — Flash/Pro/Lite](https://www.morphllm.com/gemini-api-pricing)
- [OpenAI API Pricing (Jul 2026) — BenchLM](https://benchlm.ai/openai/api-pricing) · [aipricing.guru — GPT-5.6](https://www.aipricing.guru/openai-pricing/) · [pricepertoken — GPT-5.4 Mini](https://pricepertoken.com/pricing-page/model/openai-gpt-5.4-mini)
- Anthropic: tabela de modelos e preços da skill `claude-api` (cache de 24/06/2026) — confirmar em [platform.claude.com/docs/en/pricing](https://platform.claude.com/docs/en/pricing)
