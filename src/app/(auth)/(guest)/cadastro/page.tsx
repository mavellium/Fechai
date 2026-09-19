"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import posthog from "posthog-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  KeyRound,
  MapPin,
  Megaphone,
  Store,
  Handshake,
  Search,
  Camera,
  ThumbsUp,
  Ellipsis,
  HandCoins,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioCards } from "@/components/ui/radio-cards";
import { PasswordStrength } from "@/components/ui/password-strength";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { cn } from "@/lib/utils";
import { MIN_PASSWORD_LENGTH, isStrongPassword, firstPasswordIssue } from "@/lib/password";
import {
  EmailField,
  PasswordField,
  LabeledField,
  DocumentField,
  CepField,
  PhoneField,
  SelectField,
} from "../../_components/fields";
import {
  isValidCnpj,
  isValidPhone,
  isValidCep,
  BRAZILIAN_STATES,
  BUSINESS_SEGMENTS,
  OTHER_VALUE,
  OTHER_DETAIL_MAX,
} from "@/lib/br-lead";
import { lookupCep, listMunicipalities, type Municipality } from "@/lib/br-address";

type Phase = "idle" | "loading" | "done";
type Role = "cliente" | "afiliado";
type StepNumber = 1 | 2 | 3;

const STEPS = [
  { n: 1, label: "Acesso", icon: KeyRound, title: "Comece pelo acesso", subtitle: "É com esses dados que você entra no painel." },
  { n: 2, label: "Empresa", icon: Building2, title: "Dados da empresa", subtitle: "O fechai é para empresas — precisamos do CNPJ." },
  { n: 3, label: "Negócio", icon: Store, title: "Sobre o seu negócio", subtitle: "Ajuda a gente a preparar o agente pro seu contexto." },
] as const;

const STATE_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

// Esta versão do lucide não traz mais ícones de marca (Instagram/Facebook), e
// o nome no rótulo já identifica o canal — os ícones aqui são só apoio visual.
const REFERRAL_CARDS = [
  { value: "indicacao", label: "Indicação", icon: Handshake },
  { value: "google", label: "Google", icon: Search },
  { value: "instagram", label: "Instagram", icon: Camera },
  { value: "facebook", label: "Facebook", icon: ThumbsUp },
  { value: OTHER_VALUE, label: "Outro", icon: Ellipsis },
] as const;

type FormState = {
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
  document: string;
  phone: string;
  phoneSecondary: string;
  zipCode: string;
  street: string;
  addressNumber: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  businessSegment: string;
  /** Preenchido só quando `businessSegment` é "outro" — ver OTHER_VALUE. */
  businessSegmentOther: string;
  referralSource: string;
  /** Mesma regra do segmento: só existe quando a escolha foi "Outro". */
  referralSourceOther: string;
  /**
   * Como a pessoa vai usar o fechai. Não é exclusivo: dá para ser cliente,
   * afiliado, ou os dois — e "os dois" é o caso que mais interessa ao produto.
   */
  roles: Role[];
};

const EMPTY: FormState = {
  name: "",
  email: "",
  password: "",
  passwordConfirm: "",
  document: "",
  phone: "",
  phoneSecondary: "",
  zipCode: "",
  street: "",
  addressNumber: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  businessSegment: "",
  businessSegmentOther: "",
  referralSource: "",
  referralSourceOther: "",
  roles: ["cliente"],
};

/** Situação da busca por CEP — o que a tela mostra abaixo do campo. */
type CepStatus = "idle" | "loading" | "found" | "notfound" | "failed";

const CEP_HINT: Record<CepStatus, string | undefined> = {
  idle: "Preenchemos o endereço pra você.",
  loading: "Buscando endereço…",
  found: undefined, // o endereço preenchido na tela já é o retorno visível
  notfound: "Não achamos esse CEP. Pode preencher o endereço à mão.",
  failed: "Busca indisponível agora. Pode preencher o endereço à mão.",
};

export default function CadastroPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Quem chega pela landing de afiliados (/cadastro?tipo=afiliado) já encontra
  // as duas opções marcadas: veio pelo programa, mas a conta de cliente nasce
  // junto de qualquer jeito — é ela que dá acesso ao painel.
  const preferAffiliate = searchParams.get("tipo") === "afiliado";
  const reduced = useReducedMotion();
  const nameId = useId();

  const [step, setStep] = useState<StepNumber>(1);
  const [form, setForm] = useState<FormState>(() =>
    preferAffiliate ? { ...EMPTY, roles: ["cliente", "afiliado"] } : EMPTY,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  // Direção da transição: avançar entra pela direita, voltar pela esquerda.
  const [direction, setDirection] = useState<1 | -1>(1);

  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");
  const [cities, setCities] = useState<Municipality[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  /**
   * Toda busca por CEP e por municípios recebe um número. Só a resposta do
   * número mais recente é aplicada: digitar dois CEPs em sequência dispara duas
   * requisições, e sem isso a mais lenta (a antiga) sobrescreveria a mais nova.
   */
  const cepRun = useRef(0);
  const cityRun = useRef(0);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    // O aviso some assim que a pessoa mexe no campo — não fica preso na tela.
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  }

  /**
   * Carrega os municípios de uma UF. Vazio (falha ou UF em branco) deixa a
   * cidade como campo de texto — o cadastro não trava porque o IBGE caiu.
   */
  const loadCities = useCallback(async (uf: string) => {
    const run = ++cityRun.current;
    if (!uf) {
      setCities([]);
      setCitiesLoading(false);
      return;
    }
    setCitiesLoading(true);
    const list = await listMunicipalities(uf);
    if (cityRun.current !== run) return; // outra UF foi escolhida no meio
    setCities(list);
    setCitiesLoading(false);
  }, []);

  /** UF escolhida à mão: troca a lista e limpa a cidade da UF anterior. */
  function selectState(uf: string) {
    setForm((f) => ({ ...f, state: uf, city: "" }));
    setErrors((e) => ({ ...e, state: undefined, city: undefined }));
    void loadCities(uf);
  }

  /**
   * Busca o endereço do CEP e preenche o resto. O retorno **não** é imposto:
   * todo campo continua editável, porque CEP de cidade inteira não traz
   * logradouro e endereço de verdade tem exceção que a base não conhece.
   */
  const fetchAddress = useCallback(
    async (cep: string) => {
      const run = ++cepRun.current;
      setCepStatus("loading");
      const found = await lookupCep(cep);
      if (cepRun.current !== run) return; // outro CEP foi digitado no meio

      if (!found) {
        // `lookupCep` devolve null tanto para CEP inexistente quanto para
        // serviço fora do ar; o texto muda, o caminho (digitar à mão) não.
        setCepStatus("notfound");
        return;
      }

      setForm((f) => ({
        ...f,
        street: found.street || f.street,
        neighborhood: found.neighborhood || f.neighborhood,
        city: found.city,
        state: found.state,
      }));
      setErrors((e) => ({ ...e, zipCode: undefined, city: undefined, state: undefined }));
      setCepStatus("found");
      // A lista de municípios da UF vem junto: se a pessoa corrigir a cidade
      // depois, o select já está pronto com as opções certas.
      void loadCities(found.state);
    },
    [loadCities],
  );

  /** Regras de cada passo. Devolve {} quando pode avançar. */
  function validate(target: StepNumber): Partial<Record<keyof FormState, string>> {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (target === 1) {
      if (!/.+@.+\..+/.test(form.email.trim())) e.email = "Informe um e-mail válido.";
      if (!isStrongPassword(form.password)) {
        // A checklist abaixo do campo já mostra tudo o que falta; aqui vai só
        // a primeira pendência, para o erro não repetir a lista inteira.
        e.password = form.password
          ? `Falta: ${firstPasswordIssue(form.password)?.toLowerCase()}.`
          : "Crie uma senha.";
      }
      if (form.passwordConfirm !== form.password)
        e.passwordConfirm = "As senhas não são iguais.";
    }
    if (target === 2) {
      if (!isValidCnpj(form.document)) e.document = "CNPJ inválido — confira os números.";
      if (!isValidPhone(form.phone)) e.phone = "Telefone inválido — inclua o DDD.";
      if (form.phoneSecondary && !isValidPhone(form.phoneSecondary))
        e.phoneSecondary = "Telefone secundário inválido — inclua o DDD.";
    }
    if (target === 3) {
      if (!isValidCep(form.zipCode)) e.zipCode = "Informe um CEP válido (8 dígitos).";
      if (!form.street.trim()) e.street = "Informe o logradouro.";
      if (!form.addressNumber.trim()) e.addressNumber = "Informe o número.";
      if (!form.neighborhood.trim()) e.neighborhood = "Informe o bairro.";
      if (!form.state) e.state = "Selecione o estado.";
      if (!form.city.trim()) e.city = "Selecione a cidade.";
      if (!form.businessSegment) e.businessSegment = "Selecione o segmento.";
      else if (form.businessSegment === OTHER_VALUE && !form.businessSegmentOther.trim())
        e.businessSegmentOther = "Conte qual é o segmento.";
      if (!form.referralSource) e.referralSource = "Selecione uma opção.";
      else if (form.referralSource === OTHER_VALUE && !form.referralSourceOther.trim())
        e.referralSourceOther = "Conte como você conheceu o fechai.";
      if (form.roles.length === 0) e.roles = "Escolha pelo menos uma opção.";
    }
    return e;
  }

  /** Marca/desmarca um papel. Lista, não radio: os dois podem coexistir. */
  function toggleRole(role: Role) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
    setErrors((e) => ("roles" in e ? { ...e, roles: undefined } : e));
  }

  function goNext() {
    const found = validate(step);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setDirection(1);
    setStep((s) => Math.min(s + 1, 3) as StepNumber);
  }

  function goBack() {
    setErrors({});
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 1) as StepNumber);
  }

  async function submit() {
    // Revalida os três passos: o botão final não pode confiar só na navegação.
    for (const s of [1, 2, 3] as StepNumber[]) {
      const found = validate(s);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        setDirection(-1);
        setStep(s);
        return;
      }
    }

    setFormError(null);
    setPhase("loading");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Não conseguimos criar sua conta. Tente de novo.");
      }
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.error)
        throw new Error("Conta criada, mas o login falhou — entre pela tela de login.");
      const session = await fetch("/api/auth/session").then((r) => r.json()).catch(() => null);
      if (session?.user?.id) {
        posthog.identify(session.user.id, {
          ...(session.user.email ? { email: session.user.email } : {}),
          role: session.user.role,
        });
        posthog.capture("account_registered", { role: session.user.role });
      }
      setPhase("done"); // digitando → check antes de navegar
      // Quem entrou só pelo programa de afiliados vai direto ao painel de
      // afiliado: mandar essa pessoa escolher plano seria pedir uma decisão
      // que ela não veio tomar.
      const destino = form.roles.includes("cliente") ? "/planos" : "/afiliado";
      setTimeout(() => {
        router.push(destino);
        router.refresh();
      }, 450);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro inesperado. Tente de novo.");
      setPhase("idle");
    }
  }

  const current = STEPS[step - 1];
  const busy = phase !== "idle";

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Crie sua conta</h1>
      <p className="mt-1 text-sm text-neutral">
        Três passos rápidos. Sem cartão de crédito.
      </p>

      <Stepper step={step} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 3) goNext();
          else void submit();
        }}
        noValidate
        className="mt-6"
      >
        {/* `mode="popLayout"` evita os dois passos ocuparem altura ao mesmo
            tempo durante a troca — sem isso o formulário "pula". */}
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            initial={reduced ? false : { opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-iris/10 text-iris">
                <current.icon size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-ink">{current.title}</h2>
                <p className="text-sm text-neutral">{current.subtitle}</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {step === 1 && (
                <>
                  <LabeledField
                    label="Nome do negócio"
                    htmlFor={nameId}
                    hint="Dá nome ao seu painel."
                    optional
                  >
                    <div className="relative">
                      <Store
                        size={16}
                        className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
                        aria-hidden
                      />
                      <Input
                        id={nameId}
                        name="name"
                        value={form.name}
                        onChange={(e) => set("name", e.currentTarget.value)}
                        placeholder="Ex: Estúdio Aurora"
                        autoComplete="organization"
                        className="pl-10"
                        autoFocus
                      />
                    </div>
                  </LabeledField>

                  <EmailField
                    value={form.email}
                    onValueChange={(v) => set("email", v)}
                    error={errors.email}
                    onValidate={(err) => setErrors((e) => ({ ...e, email: err ?? undefined }))}
                  />

                  <div>
                    <PasswordField
                      minLength={MIN_PASSWORD_LENGTH}
                      hint="Use algo que só você saiba."
                      autoComplete="new-password"
                      value={form.password}
                      onValueChange={(v) => set("password", v)}
                      error={errors.password}
                    />
                    <PasswordStrength password={form.password} />
                  </div>

                  <PasswordField
                    label="Confirmar senha"
                    name="passwordConfirm"
                    autoComplete="new-password"
                    hint="Digite de novo para conferir."
                    value={form.passwordConfirm}
                    onValueChange={(v) => set("passwordConfirm", v)}
                    error={errors.passwordConfirm}
                  />

                  <PasswordMatch password={form.password} confirm={form.passwordConfirm} />
                </>
              )}

              {step === 2 && (
                <>
                  <DocumentField
                    value={form.document}
                    onChange={(v) => set("document", v)}
                    error={errors.document}
                    onValidate={(err) => setErrors((e) => ({ ...e, document: err ?? undefined }))}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <PhoneField
                      name="phone"
                      label="Telefone"
                      value={form.phone}
                      onChange={(v) => set("phone", v)}
                      error={errors.phone}
                      onValidate={(err) => setErrors((e) => ({ ...e, phone: err ?? undefined }))}
                    />
                    <PhoneField
                      name="phoneSecondary"
                      label="Telefone 2"
                      value={form.phoneSecondary}
                      onChange={(v) => set("phoneSecondary", v)}
                      error={errors.phoneSecondary}
                      onValidate={(err) =>
                        setErrors((e) => ({ ...e, phoneSecondary: err ?? undefined }))
                      }
                      optional
                    />
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <CepField
                    value={form.zipCode}
                    onChange={(v) => {
                      set("zipCode", v);
                      // Mexeu no CEP: o resultado anterior não vale mais.
                      if (cepStatus !== "idle") setCepStatus("idle");
                    }}
                    onComplete={(cep) => void fetchAddress(cep)}
                    loading={cepStatus === "loading"}
                    hint={CEP_HINT[cepStatus]}
                    error={errors.zipCode}
                    onValidate={(err) => setErrors((e) => ({ ...e, zipCode: err ?? undefined }))}
                  />

                  {/*
                    O endereço fica visível e editável sempre — não escondido
                    atrás do sucesso da busca. Quem digitou um CEP que o ViaCEP
                    não conhece precisa do mesmo formulário que todo mundo, e
                    número e complemento nunca vêm da busca de qualquer jeito.
                  */}
                  <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                    <TextField
                      label="Logradouro"
                      name="street"
                      value={form.street}
                      onChange={(v) => set("street", v)}
                      placeholder="Ex: Avenida Paulista"
                      autoComplete="address-line1"
                      error={errors.street}
                    />
                    <TextField
                      label="Número"
                      name="addressNumber"
                      value={form.addressNumber}
                      onChange={(v) => set("addressNumber", v)}
                      placeholder="900"
                      autoComplete="address-line2"
                      error={errors.addressNumber}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Bairro"
                      name="neighborhood"
                      value={form.neighborhood}
                      onChange={(v) => set("neighborhood", v)}
                      placeholder="Ex: Bela Vista"
                      autoComplete="address-level3"
                      error={errors.neighborhood}
                    />
                    <TextField
                      label="Complemento"
                      name="complement"
                      value={form.complement}
                      onChange={(v) => set("complement", v)}
                      placeholder="Sala, andar…"
                      optional
                    />
                  </div>

                  {/*
                    UF antes de cidade, e não o contrário: a lista de municípios
                    só existe depois que o estado é conhecido.
                  */}
                  <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
                    <SelectField
                      label="UF"
                      name="state"
                      options={STATE_OPTIONS}
                      value={form.state}
                      onChange={selectState}
                      placeholder="UF"
                      error={errors.state}
                    />

                    <CityField
                      value={form.city}
                      onChange={(v) => set("city", v)}
                      state={form.state}
                      cities={cities}
                      loading={citiesLoading}
                      error={errors.city}
                    />
                  </div>

                  <SelectField
                    label="Segmento do negócio"
                    name="businessSegment"
                    icon={Store}
                    options={BUSINESS_SEGMENTS}
                    value={form.businessSegment}
                    onChange={(v) => set("businessSegment", v)}
                    placeholder="Selecione o segmento"
                    error={errors.businessSegment}
                  />

                  {/*
                    "Outro" sem o campo de texto é um dado que não qualifica
                    ninguém — o detalhe é obrigatório quando a opção é essa.
                  */}
                  {form.businessSegment === OTHER_VALUE && (
                    <OtherDetail
                      label="Qual é o segmento?"
                      name="businessSegmentOther"
                      value={form.businessSegmentOther}
                      onChange={(v) => set("businessSegmentOther", v)}
                      placeholder="Ex: Pet shop"
                      error={errors.businessSegmentOther}
                      reduced={reduced}
                    />
                  )}

                  <fieldset>
                    <legend className="flex items-center gap-2 text-sm font-medium text-ink">
                      <Megaphone size={15} className="text-neutral" aria-hidden />
                      Como conheceu o fechai
                    </legend>
                    <div className="mt-2">
                      <RadioCards
                        name="referralSource"
                        options={REFERRAL_CARDS}
                        value={form.referralSource}
                        onChange={(v) => set("referralSource", v)}
                      />
                    </div>
                    {errors.referralSource && (
                      <p role="alert" className="mt-2 text-sm text-danger">
                        {errors.referralSource}
                      </p>
                    )}
                  </fieldset>

                  {form.referralSource === OTHER_VALUE && (
                    <OtherDetail
                      label="Como você chegou até aqui?"
                      name="referralSourceOther"
                      value={form.referralSourceOther}
                      onChange={(v) => set("referralSourceOther", v)}
                      placeholder="Ex: podcast, evento, YouTube"
                      error={errors.referralSourceOther}
                      reduced={reduced}
                    />
                  )}

                  <fieldset>
                    <legend className="flex items-center gap-2 text-sm font-medium text-ink">
                      <HandCoins size={15} className="text-neutral" aria-hidden />
                      Como você vai usar o fechai
                    </legend>
                    <p className="mt-1 text-sm text-neutral">
                      Pode marcar as duas — dá para usar o agente e ganhar indicando.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <RoleCard
                        icon={Briefcase}
                        titulo="Usar no meu negócio"
                        desc="Ter um agente atendendo meu WhatsApp."
                        checked={form.roles.includes("cliente")}
                        onToggle={() => toggleRole("cliente")}
                      />
                      <RoleCard
                        icon={HandCoins}
                        titulo="Ser afiliado"
                        desc="Indicar o fechai e ganhar comissão todo mês."
                        checked={form.roles.includes("afiliado")}
                        onToggle={() => toggleRole("afiliado")}
                      />
                    </div>
                    {errors.roles && (
                      <p role="alert" className="mt-2 text-sm text-danger">
                        {errors.roles}
                      </p>
                    )}
                  </fieldset>
                </>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {formError && (
          <p className="mt-4 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}

        <div className="mt-6 flex items-center gap-2">
          {step > 1 && (
            <Button type="button" variant="ghost" onClick={goBack} disabled={busy}>
              <ArrowLeft size={16} aria-hidden />
              Voltar
            </Button>
          )}

          <Button type="submit" variant="cta" className="flex-1" disabled={busy}>
            {step < 3 ? (
              <>
                Continuar
                <ArrowRight size={16} aria-hidden />
              </>
            ) : phase === "idle" ? (
              <>
                Criar minha conta
                <Check size={16} strokeWidth={3} aria-hidden />
              </>
            ) : (
              <TypingToCheck state={phase === "done" ? "done" : "typing"} size={18} doneColor="white" />
            )}
          </Button>
        </div>

        {/*
          O teste grátis é de MENSAGENS DA IA: só faz sentido para quem vai usar
          o agente. Prometê-lo a quem entrou só para indicar seria oferecer algo
          que essa conta nem consegue gastar — e ainda daria a impressão de que
          o programa de afiliados tem prazo de validade.
        */}
        {step === 3 && (
          <p className="mt-3 text-center text-sm text-neutral">
            {form.roles.includes("cliente")
              ? "7 dias grátis para testar mensagens por I.A. Sem cartão de crédito."
              : "Entrar no programa de afiliados é grátis, sem meta mínima."}
          </p>
        )}
      </form>

      <p className="mt-6 text-center text-sm text-neutral">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-iris hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

/* ========================================================== sub-componentes */

function Stepper({ step }: { step: StepNumber }) {
  const progress = (step / STEPS.length) * 100;

  return (
    <nav aria-label="Progresso do cadastro" className="mt-6">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral">
          passo {step} de {STEPS.length}
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral">
          {Math.round(progress)}%
        </p>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral/15">
        <motion.div
          className="h-full rounded-full bg-signal"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />
      </div>

      <ol className="mt-3 flex items-center gap-4">
        {STEPS.map((s) => {
          const done = s.n < step;
          const active = s.n === step;
          return (
            <li
              key={s.n}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-sm transition-colors",
                active ? "font-medium text-ink" : done ? "text-neutral" : "text-neutral/60",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] transition-colors",
                  done && "bg-success text-white",
                  active && "bg-signal text-white",
                  !done && !active && "border border-neutral/30",
                )}
              >
                {done ? <Check size={11} strokeWidth={3} aria-hidden /> : s.n}
              </span>
              {s.label}
              {done && <span className="sr-only"> — concluído</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Campo de texto simples do formulário — a casca repetida do passo 3. */
function TextField({
  label,
  name,
  value,
  onChange,
  placeholder,
  autoComplete,
  optional,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  optional?: boolean;
  error?: string;
}) {
  const id = useId();
  return (
    <LabeledField label={label} htmlFor={id} error={error} optional={optional}>
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={!optional}
        aria-invalid={Boolean(error)}
        className={cn(error && "border-danger focus-visible:ring-danger")}
      />
    </LabeledField>
  );
}

/** Explicação do estado do campo de cidade — vai na bolinha ao lado do rótulo. */
const CITY_ABOUT = "A lista de municípios vem do estado: escolha a UF e as cidades aparecem aqui.";

/**
 * Cidade: um `<select>` com os municípios da UF escolhida.
 *
 * Sem UF o campo fica **desabilitado**, não escondido nem com um aviso fixo
 * embaixo: desabilitado já diz "ainda não é a sua vez" sem ocupar uma linha de
 * texto que some depois de ser lida uma vez. O porquê vai para a bolinha ao
 * lado do rótulo (`about`), que abre no hover, no clique e pelo teclado — quem
 * usa toque também alcança.
 *
 * Cai para campo de texto quando há UF mas não há lista (IBGE fora do ar). Um
 * select vazio seria um beco sem saída; digitar é pior que escolher, mas é
 * melhor que não conseguir terminar o cadastro.
 */
function CityField({
  value,
  onChange,
  state,
  cities,
  loading,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  state: string;
  cities: Municipality[];
  loading: boolean;
  error?: string;
}) {
  const id = useId();

  // Sem UF ou carregando: o mesmo select, desabilitado. Manter o controle (em
  // vez de trocar por outro) evita o campo saltar de tipo no meio do caminho.
  if (!state || loading) {
    return (
      <SelectField
        label="Cidade"
        name="city"
        icon={MapPin}
        options={[]}
        value=""
        onChange={onChange}
        placeholder={loading ? "Carregando municípios…" : "Selecione a UF primeiro"}
        disabled
        about={CITY_ABOUT}
      />
    );
  }

  if (cities.length === 0) {
    return (
      <LabeledField label="Cidade" htmlFor={id} error={error}>
        <div className="relative">
          <MapPin
            size={16}
            className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
            aria-hidden
          />
          <Input
            id={id}
            name="city"
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            placeholder="Ex: São Paulo"
            autoComplete="address-level2"
            required
            aria-invalid={Boolean(error)}
            className={cn("pl-10", error && "border-danger focus-visible:ring-danger")}
          />
        </div>
      </LabeledField>
    );
  }

  return (
    <SelectField
      label="Cidade"
      name="city"
      icon={MapPin}
      options={cities}
      value={value}
      onChange={onChange}
      placeholder="Selecione a cidade"
      about={CITY_ABOUT}
      error={error}
    />
  );
}

/**
 * Campo de texto que aparece depois de escolher "Outro".
 *
 * Entra com animação de altura para a lista abaixo não saltar — e sem ela
 * quando `prefers-reduced-motion` está ligado.
 */
function OtherDetail({
  label,
  name,
  value,
  onChange,
  placeholder,
  error,
  reduced,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  reduced: boolean | null;
}) {
  const id = useId();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      // `overflow-hidden` é o que faz a altura animar sem a lista de baixo
      // saltar — mas ele também corta o anel de foco, que é desenhado PARA
      // FORA da borda. O padding devolve o espaço do anel e a margem negativa
      // tira esse espaço do fluxo, então o campo continua alinhado com os
      // outros. Sem o par, ou o foco aparece cortado ou o campo entra torto.
      //
      // O `pb-1` existe porque o input é o último filho: sem ele, a borda de
      // baixo do anel encosta no corte do `overflow`. Ele NÃO é compensado por
      // `-mb`, ao contrário do eixo horizontal — a margem negativa comia 4px
      // do `space-y-4` do passo e colava este campo no bloco seguinte, que é o
      // que se via na tela. 4px a mais de altura aqui não desalinham nada.
      className="-mx-1 overflow-hidden px-1 pb-1"
    >
      <LabeledField label={label} htmlFor={id} error={error}>
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder={placeholder}
          maxLength={OTHER_DETAIL_MAX}
          required
          autoFocus
          aria-invalid={Boolean(error)}
          className={cn(error && "border-danger focus-visible:ring-danger")}
        />
      </LabeledField>
    </motion.div>
  );
}

/** Confirmação visual de que as duas senhas batem — some enquanto está vazio. */
function PasswordMatch({ password, confirm }: { password: string; confirm: string }) {
  if (!password || !confirm) return null;
  const ok = password === confirm;
  return (
    <p
      aria-live="polite"
      className={cn("flex items-center gap-1.5 text-sm", ok ? "text-success" : "text-neutral")}
    >
      {ok ? (
        <>
          <Check size={14} strokeWidth={3} aria-hidden />
          As senhas conferem.
        </>
      ) : (
        "As senhas ainda não são iguais."
      )}
    </p>
  );
}

/**
 * Cartão de seleção múltipla dos papéis.
 *
 * É um `<input type="checkbox">` de verdade sob o `<label>` — teclado e
 * leitor de tela funcionam sem código extra. Não usa `RadioCards` porque lá as
 * opções são mutuamente exclusivas, e aqui marcar as duas é justamente o
 * caminho que o produto quer.
 */
function RoleCard({
  icon: Icon,
  titulo,
  desc,
  checked,
  onToggle,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  titulo: string;
  desc: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "group relative flex cursor-pointer gap-3 rounded-control border p-3 text-sm transition-all",
        "focus-within:ring-2 focus-within:ring-iris focus-within:ring-offset-2",
        checked ? "border-iris bg-iris/5" : "border-ink/15 hover:border-ink/30",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
          checked ? "border-iris bg-iris text-white" : "border-ink/25",
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Icon size={14} className={checked ? "text-iris" : "text-neutral"} />
          {titulo}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-neutral">{desc}</span>
      </span>
    </label>
  );
}
