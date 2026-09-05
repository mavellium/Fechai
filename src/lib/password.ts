/**
 * Política de senha forte do produto — uma fonte só, porque os formulários
 * (client) e as rotas/actions (server) precisam concordar: duas cópias
 * deixariam passar no cliente o que o servidor rejeita, ou pior, o contrário.
 *
 * Onde vale: criação de conta (`/cadastro`, `/api/register`), troca de senha
 * (`/configuracoes`) e criação de conta pelo admin. **Não** vale no login
 * (`src/auth.ts`): endurecer a regra lá trancaria para fora todo mundo que já
 * tem senha antiga — política nova se aplica a senha nova, não a sessão.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** Corridas de 3+ em teclado — "qwe", "asd", "789" não são aleatórias. */
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

/** As que aparecem em qualquer lista de vazamento; barradas mesmo com maiúscula. */
const COMMON = [
  "senha", "password", "123456", "12345678", "qwerty", "abc123", "admin",
  "brasil", "mudar123", "iloveyou", "welcome", "master", "letmein", "monkey",
  "flamengo", "corinthians", "saopaulo", "palmeiras", "gremio",
];

/** 3+ caracteres iguais seguidos: "aaa", "111". */
function hasRepeat(value: string) {
  return /(.)\1{2,}/.test(value);
}

/**
 * 3+ caracteres em sequência crescente ou decrescente dentro da mesma classe
 * ("abc", "321", "cba"). Comparar classes diferentes daria falso positivo em
 * pares como "9:" ou "az", que só são vizinhos na tabela ASCII.
 */
function hasSequence(value: string, minRun = 3) {
  const s = value.toLowerCase();
  let asc = 1;
  let desc = 1;
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1];
    const cur = s[i];
    const sameClass =
      (/[0-9]/.test(prev) && /[0-9]/.test(cur)) || (/[a-z]/.test(prev) && /[a-z]/.test(cur));
    const delta = cur.charCodeAt(0) - prev.charCodeAt(0);
    asc = sameClass && delta === 1 ? asc + 1 : 1;
    desc = sameClass && delta === -1 ? desc + 1 : 1;
    if (asc >= minRun || desc >= minRun) return true;
  }
  return false;
}

/** Trechos de uma linha do teclado, em qualquer direção. */
function hasKeyboardRun(value: string, minRun = 3) {
  const s = value.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i + minRun <= row.length; i++) {
      const chunk = row.slice(i, i + minRun);
      if (s.includes(chunk)) return true;
      if (s.includes([...chunk].reverse().join(""))) return true;
    }
  }
  return false;
}

function hasCommonWord(value: string) {
  const s = value.toLowerCase();
  return COMMON.some((w) => s.includes(w));
}

export type PasswordRule = {
  id: string;
  /** Texto mostrado na checklist ao lado do campo. */
  label: string;
  test: (password: string) => boolean;
};

/**
 * As regras, na ordem em que aparecem na interface. A checklist ao vivo é
 * proposital: dizer "senha fraca" sem dizer o que falta obriga a pessoa a
 * adivinhar.
 */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `Pelo menos ${MIN_PASSWORD_LENGTH} caracteres`,
    test: (p) => p.length >= MIN_PASSWORD_LENGTH,
  },
  { id: "upper", label: "Uma letra maiúscula", test: (p) => /[A-ZÀ-Þ]/.test(p) },
  { id: "lower", label: "Uma letra minúscula", test: (p) => /[a-zà-þ]/.test(p) },
  { id: "digit", label: "Um número", test: (p) => /[0-9]/.test(p) },
  {
    id: "special",
    label: "Um caractere especial (!@#$…)",
    test: (p) => /[^A-Za-zÀ-ÿ0-9]/.test(p),
  },
  {
    id: "predictable",
    label: "Sem sequências (123, abc), repetições ou palavras óbvias",
    test: (p) =>
      p.length > 0 && !hasSequence(p) && !hasRepeat(p) && !hasKeyboardRun(p) && !hasCommonWord(p),
  },
];

/** Estado de cada regra para a senha dada — alimenta a checklist da interface. */
export function checkPassword(password: string) {
  return PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(password) }));
}

/** Todas as regras atendidas? É o que o servidor exige antes de gravar. */
export function isStrongPassword(password: string) {
  return PASSWORD_RULES.every((r) => r.test(password));
}

/**
 * Primeira regra não atendida, em texto — a mensagem de erro do formulário
 * quando não há espaço para a checklist inteira (ex.: retorno do servidor).
 */
export function firstPasswordIssue(password: string): string | null {
  const failed = PASSWORD_RULES.find((r) => !r.test(password));
  return failed ? failed.label : null;
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/**
 * Força para a barra visual: quantas regras passaram, com bônus de tamanho.
 * É indicador, não porteiro — quem decide se pode gravar é `isStrongPassword`.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "" };

  const total = PASSWORD_RULES.length;
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;

  let score: number;
  if (passed < total) {
    // Enquanto falta regra a barra para em "Razoável" (2): passar de "Boa"
    // com a senha ainda inválida contradiria a checklist ao lado, que está
    // mostrando um item vermelho.
    score = Math.min(2, Math.max(1, Math.round((passed / total) * 2)));
  } else {
    // Tudo atendido: 12+ caracteres separam "Forte" de "Boa".
    score = password.length >= 12 ? 4 : 3;
  }

  const labels = ["", "Fraca", "Razoável", "Boa", "Forte"] as const;
  return { score: score as PasswordStrength["score"], label: labels[score] };
}

/**
 * Senha provisória que já nasce dentro da política (usada quando o admin cria
 * uma conta sem definir senha). Sem caracteres ambíguos (0/O, 1/l/I): ela vai
 * ser lida em voz alta e digitada por alguém.
 */
export function generateStrongPassword(randomBytes: (n: number) => Uint8Array, length = 16) {
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const LOWER = "abcdefghijkmnpqrstuvwxyz";
  const DIGIT = "23456789";
  const SPECIAL = "!@#$%&*?";
  const ALL = UPPER + LOWER + DIGIT + SPECIAL;

  // Sorteia e testa, em vez de montar posições fixas por classe: fixar
  // "maiúscula, minúscula, dígito, especial" nas 4 primeiras posições daria
  // um formato previsível. Com 16 caracteres num alfabeto de 56, a chance de
  // um sorteio cobrir as quatro classes já é alta, e as regras de sequência
  // e repetição descartam o resto.
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = randomBytes(length);
    const candidate = Array.from(bytes, (b) => ALL[b % ALL.length]).join("");
    if (isStrongPassword(candidate)) return candidate;
  }
  // Improvável: 50 sorteios reprovados. Melhor falhar alto do que devolver
  // uma senha fraca em silêncio.
  throw new Error("Não foi possível gerar uma senha dentro da política.");
}

/**
 * Custo do bcrypt (fator de trabalho), numa constante só.
 *
 * Estava como o literal `10` em seis lugares — e literal repetido é como os
 * valores divergem: basta alguém subir num arquivo e esquecer dos outros.
 *
 * 12 é o padrão recomendado atual (~250ms por hash contra ~60ms do 10), o que
 * multiplica por 4 o custo de quem tenta força bruta contra um banco vazado. O
 * custo para o produto é irrelevante: hash de senha só acontece em login,
 * cadastro e troca — e o login já tem freio (`lib/login-throttle`) e limite por
 * IP no cadastro, que é o que impede alguém de transformar esse custo em ataque
 * de CPU contra o servidor.
 *
 * Senhas antigas continuam funcionando: o custo fica gravado no próprio hash e
 * o `bcrypt.compare` o lê de lá. Elas seguem em 10 até a pessoa trocar a senha
 * — não há como recalcular sem a senha em claro, e isso é o comportamento
 * correto, não uma pendência.
 *
 * Ao mudar este valor, gere um DUMMY_HASH novo no mesmo custo (ver src/auth.ts):
 * um dummy mais barato que os hashes reais devolve o "usuário não existe" mais
 * rápido e reabre a diferença de tempo que ele existe para esconder.
 */
export const BCRYPT_COST = 12;
