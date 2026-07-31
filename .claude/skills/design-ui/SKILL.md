---
name: fechai-design-system
description: "Regras de design limpo, UX/UI e padroes visuais para qualquer tela, componente ou pagina do SaaS 'fechai' (ou de qualquer projeto de front-end do usuario). Use esta skill sempre que for criar, revisar ou refatorar QUALQUER interface — landing pages, dashboards, formularios, componentes React, telas de admin — mesmo que o usuario nao peca explicitamente 'seguindo o design system'. Se a tarefa envolve HTML, CSS, Tailwind, React/Next.js, ou qualquer coisa visual, consulte esta skill antes de escrever codigo. Cobre paleta de cores e tokens, tipografia, espacamento, padroes de componentes (botoes, formularios, cards, estados vazio/erro/carregando), hierarquia visual, acessibilidade, motion/animacao e uma lista de anti-padroes genericos de IA a evitar."
---

# Design System — fechaí

Este é o conjunto único de regras que qualquer tela do produto deve seguir. Objetivo: interface limpa, confiante e rápida de usar — nunca "bonita por bonita", sempre a serviço de clareza e conversão. Consulte esta skill inteira antes de gerar qualquer componente visual; não pule direto para o código.

## 0. Princípio geral

Antes de desenhar qualquer tela, responda: **qual é a única coisa que o usuário precisa entender ou fazer aqui?** Tudo na tela existe para apoiar essa resposta. Se um elemento não apoia isso, ele é ruído — corte, não decore em cima.

Hierarquia de prioridade ao tomar qualquer decisão de UI, nesta ordem: (1) clareza, (2) confiança/consistência, (3) velocidade de uso, (4) estética. Nunca inverta essa ordem — um botão bonito que confunde perde pra um botão feio que funciona, mas o objetivo aqui é nunca precisar escolher.

## 1. Tokens de marca (fonte única — não inventar cores/fontes fora daqui)

```ts
colors: {
  ink:     '#14171F', // texto principal
  paper:   '#F7F8FB', // fundo padrão
  iris:    '#4B3CF0', // cor de marca — links, ícones ativos, header
  signal:  '#FF6B4A', // reservada para CTA/conversão — não decorativo
  success: '#1FC8A3', // só para estados de sucesso/confirmação
  neutral: '#6B7280', // texto secundário, bordas, ícones inativos
}
```

Fontes: **Clash Display** (títulos/headlines), **Satoshi** (corpo/UI), **JetBrains Mono** (dados, IDs, snippets). Nunca usar Inter, Roboto ou fontes default do sistema como fonte principal — essas três é que definem a marca.

Regra 60/30/10 de aplicação: `paper`/`ink` (fundo e texto) domina ~90% de qualquer tela. `iris` aparece com moderação (links, ícones, elementos de identidade). `signal` é exclusiva de call-to-action — se dois elementos da mesma tela competem por `signal`, um deles está errado.

## 2. Tipografia

- Escala de tamanho (usar só estes passos, não valores soltos): `12 / 14 / 16 / 20 / 24 / 32 / 48 / 64px`.
- Corpo de texto: 16px, `line-height` 1.5–1.6. Títulos: `line-height` 1.1–1.2.
- Largura máxima de linha de texto corrido: ~65–75 caracteres (`max-w-prose` no Tailwind).
- Peso: Clash Display só em Semibold/Bold — nunca Regular (perde a personalidade da fonte). Satoshi em Regular/Medium para corpo, Medium/Bold para labels de botão.
- Hierarquia por tamanho E peso, nunca só por cor. Cor sozinha não deve ser o único jeito de indicar importância (acessibilidade).

## 3. Espaçamento e grid

- Sistema de 8pt: todo espaçamento (padding, margin, gap) é múltiplo de 4 ou 8 (`4, 8, 12, 16, 24, 32, 48, 64px`). Nunca valores arbitrários como `13px` ou `22px`.
- Padding interno de cards/containers: mínimo `16px` em mobile, `24–32px` em desktop.
- Respiro entre seções da landing: mínimo `64px` (`py-16`+) — nunca seções coladas.
- Alinhamento consistente: escolha uma grade (ex: 12 colunas, `max-w-6xl mx-auto px-4`) e todo conteúdo respeita ela — nada "solto" fora do container.

## 4. Cor e contraste

- Texto sobre `iris` ou `signal`: sempre `paper` (branco), nunca `ink`.
- Texto sobre `paper`: sempre `ink` para texto principal, `neutral` para secundário.
- Contraste mínimo WCAG AA (4.5:1 para texto normal, 3:1 para texto grande/ícones) — verificar sempre que uma cor de marca for usada como fundo de texto.
- Nunca usar cor pura como único indicador de estado (erro, sucesso, aviso) — sempre acompanhar de ícone e/ou texto.

## 5. Componentes — padrões obrigatórios

**Botões**
- Primário: fundo `signal`, texto `paper`, usado 1x por tela no máximo para a ação principal.
- Secundário: borda `neutral`/`iris`, fundo transparente, texto `ink`/`iris`.
- Todo botão tem estado de `hover`, `focus-visible` (contorno visível, nunca `outline: none` sem substituto), `disabled` (opacidade reduzida + `cursor-not-allowed`) e `loading` (spinner ou o componente de assinatura "3 pontos → check", nunca o botão trava sem feedback).

**Formulários**
- Label sempre visível acima do campo (nunca só placeholder como label — some quando o usuário digita e quebra acessibilidade).
- Erro de validação aparece perto do campo, em texto, não só borda vermelha.
- Campos com estado de foco claramente visível (`ring-2 ring-iris`).

**Cards**
- Borda sutil (`border-neutral/20`) OU sombra leve — nunca as duas empilhadas com força total (evita o "card de IA genérico" com sombra pesada + borda + gradiente).
- Cantos consistentes em todo o produto: escolher um raio (ex: `rounded-xl`) e usar em tudo — nunca misturar `rounded-md` e `rounded-2xl` na mesma tela.

**Estados que TODA tela com dados precisa ter (não pular nenhum):**
1. **Carregando** — skeleton ou o indicador de marca, nunca tela branca em branco.
2. **Vazio** — mensagem explicando o que fazer para popular aquilo (nunca só "nenhum item encontrado" sem próximo passo).
3. **Erro** — o que aconteceu + o que fazer agora (retry, contato, etc).
4. **Sucesso/preenchido** — o estado normal.

## 6. Motion / animação

- Biblioteca de UI (dashboard, componentes): **Motion** (`motion/react`, antigo Framer Motion). Transições de entrada/saída sutis, 150–300ms, `ease-out`.
- Scroll storytelling: reservado só para a landing pública (GSAP/Lenis) — nunca no dashboard logado.
- Toda animação deve respeitar `prefers-reduced-motion` — sem exceção.
- O elemento de assinatura da marca (3 pontos que viram check, ver `docs/brand-guide.md`) é o padrão de "carregando"/"sucesso" em todo o produto — não inventar spinners genéricos em paralelo a ele.
- Animação nunca atrasa a ação do usuário: nada de esperar uma animação de 1s terminar antes do próximo passo ficar disponível.

## 7. Acessibilidade (não negociável)

- HTML semântico (`<button>` para ações, `<a>` para navegação, headings em ordem hierárquica `h1→h2→h3`).
- Todo elemento interativo é alcançável por teclado e tem `focus-visible` claro.
- Imagens/ícones informativos têm `alt`/`aria-label`; ícones puramente decorativos são `aria-hidden`.
- Não depender só de cor para transmitir informação (ver seção 4).

## 8. Anti-padrões de "IA genérica" — evitar sempre

- Gradiente roxo/azul genérico de fundo de hero sem motivo — se usar gradiente, deve nascer da paleta da marca e ter propósito.
- Cards com sombra pesada + borda + cantos muito arredondados ao mesmo tempo (visual "SaaS de template").
- Ícones de emoji ou ícones genéricos (💡✨🚀) como decoração de título — usar iconografia consistente (ex: Lucide) só quando funcional.
- Textos vagos tipo "Leve sua empresa ao próximo nível" sem dizer o que o produto faz de fato.
- Empilhar 3+ fontes diferentes ou tamanhos de texto fora da escala definida na seção 2.
- Copiar um layout de landing genérica de SaaS (hero centralizado + 3 ícones + depoimentos genéricos) sem adaptar ao conceito de marca já definido (o "digitando → check").

## 9. Checklist antes de considerar uma tela pronta

- [ ] Só uma ação primária visível por tela/seção.
- [ ] Cores e fontes vêm só dos tokens da seção 1.
- [ ] Espaçamento em múltiplos de 4/8.
- [ ] Estados de carregando/vazio/erro implementados (se a tela tem dados).
- [ ] Contraste de texto testado.
- [ ] Navegável por teclado, com foco visível.
- [ ] Responsivo em mobile (testar em ~375px de largura).
- [ ] Nenhum anti-padrão da seção 8 presente.