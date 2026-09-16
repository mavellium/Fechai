/**
 * Como a voz se comporta ao falar — escolha do dono da conta, não nossa.
 *
 * A Fish Audio expõe isso como dois números (`temperature` e `top_p`, ambos
 * 0.7 por padrão) que controlam o quanto o modelo pode "interpretar" o texto.
 * Número solto numa tela não quer dizer nada para quem atende clínica, e o
 * efeito de subi-lo não é óbvio: acima de ~0.7 a família s2 improvisa
 * paralinguagem — risadinha, suspiro, mudança de ânimo — mesmo quando o texto
 * não pede nada disso. Foi assim que o agente apareceu rindo na cara de um
 * cliente que só perguntou o preço.
 *
 * Então a escolha é por COMPORTAMENTO, em português, e cada opção carrega os
 * números. Três opções, não um controle deslizante: entre 0.42 e 0.47 ninguém
 * ouve diferença, e um slider pediria que a pessoa descobrisse sozinha onde a
 * voz começa a rir.
 *
 * O padrão é `neutra` — e é o padrão de propósito. Uma voz que improvisa é uma
 * surpresa no meio de um atendimento comercial: quem quiser isso escolhe, mas
 * ninguém deve receber sem ter pedido.
 */

export type VoiceStyleKey = "neutra" | "calorosa" | "animada";

export type VoiceStyle = {
  key: VoiceStyleKey;
  label: string;
  /** Uma linha no menu — o que muda no som, não o que muda no JSON. */
  description: string;
  /**
   * Aviso quando a opção tem efeito colateral conhecido. Só a mais expressiva
   * tem: ela é justamente a faixa em que a risada sem motivo aparece, e
   * oferecer isso sem dizer seria repetir o defeito de origem.
   */
  warning?: string;
  /** O que vai no corpo do POST /v1/tts. */
  params: { temperature: number; top_p: number };
};

/**
 * Lista curada, na ordem em que aparece no menu: do mais contido ao mais solto.
 *
 * Fixa no código pelo mesmo motivo do catálogo de vozes — é decisão de produto,
 * não de instalação. Trocar um número aqui muda como TODAS as contas naquele
 * estilo soam, então a mudança passa por deploy e fica no diff.
 */
export const VOICE_STYLES: VoiceStyle[] = [
  {
    key: "neutra",
    label: "Neutra (padrão)",
    description: "Lê a resposta como um atendente profissional. Sem risada, sem improviso.",
    params: { temperature: 0.3, top_p: 0.6 },
  },
  {
    key: "calorosa",
    label: "Calorosa",
    description: "Mais simpatia e variação na entonação, ainda sem inventar som nenhum.",
    params: { temperature: 0.55, top_p: 0.75 },
  },
  {
    key: "animada",
    label: "Animada",
    description: "Bem expressiva, com altos e baixos — combina com um negócio informal.",
    warning:
      "Nesta faixa o modelo improvisa: pode rir ou suspirar sem o texto pedir. Use com quem gosta de um atendimento solto.",
    params: { temperature: 0.8, top_p: 0.9 },
  },
];

export const DEFAULT_VOICE_STYLE: VoiceStyleKey = "neutra";

const BY_KEY = new Map(VOICE_STYLES.map((s) => [s.key, s]));

/**
 * Lê `Agent.voiceStyle` sem nunca lançar.
 *
 * A coluna pode estar null (conta anterior a este campo), com uma chave antiga
 * ou editada à mão no banco. Em qualquer um desses casos a resposta certa é a
 * voz neutra — a mesma que a conta teria se nunca tivesse mexido nisso —, não
 * um erro no caminho da conversa.
 */
export function parseVoiceStyle(raw: string | null | undefined): VoiceStyle {
  return (raw && BY_KEY.get(raw as VoiceStyleKey)) || BY_KEY.get(DEFAULT_VOICE_STYLE)!;
}

/** Os números para a chamada da Fish. */
export function voiceStyleParams(raw: string | null | undefined): VoiceStyle["params"] {
  return parseVoiceStyle(raw).params;
}
