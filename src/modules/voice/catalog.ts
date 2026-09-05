/**
 * Vozes prontas — a alternativa a gravar a própria voz.
 *
 * Nem todo cliente quer (ou pode) usar a própria voz: uma clínica com várias
 * recepcionistas, um dono que não quer se expor, alguém que só quer testar
 * áudio antes de decidir. Sem uma voz pronta, "responder com áudio" ficava
 * atrás de uma gravação — e quem não gravava simplesmente não tinha o recurso.
 *
 * ## Por que uma lista fixa, e não o catálogo da Fish em tempo real
 *
 * O catálogo público da Fish (`GET /model?language=pt`) é conteúdo enviado por
 * usuários: nas primeiras páginas convivem clones de políticos e celebridades
 * (Lula, Bolsonaro, Cristiano Ronaldo), personagens de anime e memes. Colocar
 * essa lista na frente do cliente seria oferecer a voz de uma pessoa real para
 * atendimento comercial — problema jurídico e de marca, não de gosto.
 *
 * Então a curadoria é nossa e vive aqui: ids escolhidos à mão, ouvidos um a um,
 * com nome e descrição em português. A lista muda por deploy, de propósito.
 *
 * ## O que estes ids são
 *
 * `referenceId` é o mesmo campo que uma voz clonada preenche em
 * `Agent.voiceId` — para `synthesize()` os dois são idênticos. É isso que faz a
 * escolha "minha voz OU voz pronta" não precisar de nenhum caminho novo no
 * envio: muda a origem do id, não o que acontece depois.
 */

export type CatalogVoice = {
  /** Chave estável nossa — é o que a UI manda, nunca o id da Fish direto. */
  key: string;
  /** `reference_id` na Fish Audio. */
  referenceId: string;
  name: string;
  /** Como soa, em uma linha — a pessoa escolhe por isto antes de dar play. */
  description: string;
  gender: "f" | "m";
};

/**
 * As vozes oferecidas hoje. Trocar/remover uma aqui NÃO quebra quem já usa: o
 * `Agent.voiceId` guarda o `referenceId`, então a voz continua funcionando
 * mesmo que saia desta lista — só deixa de ser oferecida a novos.
 */
export const CATALOG_VOICES: CatalogVoice[] = [
  {
    key: "isabela",
    referenceId: "5661bf8cb97740fcb10d2f756abf7779",
    name: "Isabela",
    description: "Feminina, jovem e acolhedora — boa para atendimento do dia a dia.",
    gender: "f",
  },
  {
    key: "ana",
    referenceId: "2f41253e0f234410ab6d00a6f3617a21",
    name: "Ana",
    description: "Feminina, calma e suave — passa tranquilidade.",
    gender: "f",
  },
  {
    key: "katlen",
    referenceId: "4718f3205cea430a8b5af57deaa1ea2b",
    name: "Katlen",
    description: "Feminina, vibrante e simpática — tom mais animado.",
    gender: "f",
  },
  {
    key: "julia",
    referenceId: "eb81775a43bc469dafda02de59d13cb7",
    name: "Júlia",
    description: "Feminina, serena e madura — ritmo mais pausado.",
    gender: "f",
  },
  {
    key: "adam",
    referenceId: "1a61293f8fa8441f804deb10d0b2bc95",
    name: "Adam",
    description: "Masculina, clara e objetiva — neutra para negócios.",
    gender: "m",
  },
  {
    key: "alex",
    referenceId: "4b02d057165c4798b0ceba194b765e90",
    name: "Alex",
    description: "Masculina, jovem e enérgica — tom mais informal.",
    gender: "m",
  },
  {
    key: "locutor",
    referenceId: "572760b7d9ec4a369ca387dad720a828",
    name: "Bruno",
    description: "Masculina, firme e profissional — tom de locutor.",
    gender: "m",
  },
];

export function findCatalogVoice(key: string): CatalogVoice | undefined {
  return CATALOG_VOICES.find((v) => v.key === key);
}

/** A voz atual do agente é uma do catálogo? Usado para marcar a escolhida na tela. */
export function catalogVoiceByReferenceId(referenceId: string | null): CatalogVoice | undefined {
  if (!referenceId) return undefined;
  return CATALOG_VOICES.find((v) => v.referenceId === referenceId);
}

/** Frase das amostras: a mesma para todas, senão comparar timbre vira comparar texto. */
export const SAMPLE_TEXT =
  "Oi! Recebi sua mensagem e já vou te ajudar com isso. Consigo te encaixar amanhã às dez da manhã, pode ser?";
