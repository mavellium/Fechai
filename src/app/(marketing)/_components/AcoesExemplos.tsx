import { CalendarClock, Flame, UserCheck, BellRing, UserCog } from "lucide-react";

const ACOES = [
  { icon: UserCheck, title: "Registrar lead", desc: "Nome, telefone e interesse salvos no painel, sem planilha." },
  { icon: CalendarClock, title: "Agendar horário", desc: "O agente combina o horário direto na conversa." },
  { icon: Flame, title: "Marcar lead quente", desc: "Interesse alto? Você é avisado na hora pra fechar." },
  { icon: BellRing, title: "Follow-up automático", desc: "Lead sumiu? Ele retoma a conversa depois de X horas." },
  { icon: UserCog, title: "Transferir pra você", desc: "Assunto delicado vira \"precisa atenção\" e para na sua mão." },
];

export function AcoesExemplos() {
  return (
    <section id="acoes" className="relative overflow-hidden bg-ink px-4 py-20 md:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-1/3 h-[380px] w-[380px] rounded-full bg-iris/20 blur-[130px]"
      />
      <div className="relative mx-auto max-w-6xl">
        <div className="reveal max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal">ações</p>
          <h2 className="font-display mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ele só faz o que você permitir.
          </h2>
          <p className="mt-3 text-white/55">
            Cada ação é um interruptor no seu painel. Ligue as que fazem sentido pro seu negócio —
            e desligue quando quiser.
          </p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACOES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="reveal group rounded-xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-iris/60 hover:bg-iris/10"
            >
              <Icon size={20} className="text-signal transition-transform group-hover:-translate-y-0.5" aria-hidden />
              <h3 className="mt-4 font-medium text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/50">{desc}</p>
            </div>
          ))}
          <div className="reveal flex items-center justify-center rounded-xl border border-dashed border-white/15 p-6">
            <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-white/35">
              novas ações
              <br />a caminho
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
