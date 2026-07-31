"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";

/**
 * Preview em tempo real do passo 2: mostra como a conversa fica com o nome, o
 * tom e o objetivo que o usuário acabou de escolher.
 *
 * É uma simulação local (sem chamar a IA) — o objetivo é dar retorno imediato
 * enquanto ele digita, não gerar resposta real. O sandbox de verdade fica em
 * /conversas, depois que a conta está configurada.
 */

const FALLBACK_NAME = "seu atendente";

/** Abertura do agente por tom de voz. Tom escrito à mão cai no primeiro caso. */
const GREETING_BY_TONE: Record<string, (name: string, business: string) => string> = {
  "Amigável e próximo": (n, b) => `Oi! Aqui é o ${n}, do ${b}. Como posso te ajudar hoje?`,
  "Profissional e direto": (n, b) => `Olá. Sou o ${n}, do ${b}. Em que posso ajudar?`,
  "Acolhedor e paciente": (n, b) =>
    `Oi, tudo bem? Meu nome é ${n} e eu cuido do atendimento do ${b}. Pode me contar com calma o que você precisa.`,
  "Animado e entusiasmado": (n, b) => `Oi!! Aqui é o ${n}, do ${b}. Que bom te ver por aqui! O que você procura?`,
};

/** Como o agente encaminha a conversa, conforme o objetivo escolhido. */
const CLOSING_BY_OBJECTIVE: Record<string, { reply: string; badge: string }> = {
  "Agendar um horário": {
    reply: "Consigo te encaixar amanhã às 9h ou às 10h30. Qual fica melhor pra você?",
    badge: "Horário agendado",
  },
  "Fechar uma venda": {
    reply: "Posso te mandar as opções e já deixar a sua reservada. Prefere qual delas?",
    badge: "Venda encaminhada",
  },
  "Entender o que a pessoa precisa": {
    reply: "Me conta rapidinho o que você procura que eu já te direciono certinho.",
    badge: "Contato registrado",
  },
  "Tirar dúvidas sobre o serviço": {
    reply: "Funciona assim: você escolhe o plano e começa no mesmo dia. Quer que eu detalhe algum?",
    badge: "Dúvida resolvida",
  },
};

const DEFAULT_CLOSING = {
  reply: "Me conta um pouco mais que eu te ajudo a resolver isso agora.",
  badge: "Conversa resolvida",
};

export function ChatPreview({
  agentName,
  businessName,
  tone,
  objective,
}: {
  agentName: string;
  businessName: string;
  tone: string;
  objective: string;
}) {
  const reduced = useReducedMotion();

  const name = agentName.trim() || FALLBACK_NAME;
  const business = businessName.trim() || "seu negócio";
  const greet = GREETING_BY_TONE[tone] ?? GREETING_BY_TONE["Amigável e próximo"];
  const closing = CLOSING_BY_OBJECTIVE[objective] ?? DEFAULT_CLOSING;

  const initial = agentName.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="rounded-xl border border-white/10 bg-ink p-4 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
        prévia · atualiza enquanto você escolhe
      </p>

      <div className="mt-4 overflow-hidden rounded-xl bg-paper">
        {/* topo do chat */}
        <div className="flex items-center gap-3 border-b border-ink/10 bg-white px-4 py-3">
          <span className="font-display flex h-8 w-8 items-center justify-center rounded-full bg-iris text-sm font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-success">online agora</p>
          </div>
        </div>

        {/* conversa simulada */}
        <div className="flex flex-col gap-2 px-3 py-4">
          <motion.div
            // reanima só quando o tom muda — não a cada tecla digitada no nome
            key={`greet-${tone}`}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex justify-start"
          >
            <span className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13.5px] leading-snug text-ink shadow-sm">
              {greet(name, business)}
            </span>
          </motion.div>

          <div className="flex justify-end">
            <span className="max-w-[85%] rounded-2xl rounded-br-md bg-iris px-3.5 py-2.5 text-[13.5px] leading-snug text-white">
              Oi! Queria saber mais, pode me explicar?
            </span>
          </div>

          <motion.div
            key={`reply-${objective}`}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex justify-start"
          >
            <span className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13.5px] leading-snug text-ink shadow-sm">
              {closing.reply}
            </span>
          </motion.div>

          <motion.div
            key={`badge-${objective}`}
            initial={reduced ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="mt-1 flex justify-center"
          >
            <span className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-white px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral shadow-sm">
              {closing.badge}
              <Check size={12} strokeWidth={3} className="text-success" aria-hidden />
            </span>
          </motion.div>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-white/50">
        É um exemplo. Depois de terminar, você pode conversar de verdade com ele antes de colocar no ar.
      </p>
    </div>
  );
}
