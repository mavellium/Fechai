"use client";
import { useId, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/ui/alert";
import { QR_RISK_TERMS, QR_RISK_TERMS_VERSION, QR_RISK_CHECKBOX_TEXT } from "@/modules/scheduling/qr-risk-terms";
import type { Result } from "./actions";

export function ClinicorpQrTermsDialog({ pending, result, onClose, onAccept }: {
  pending: boolean; result: Result | null; onClose: () => void; onAccept: (data: FormData) => void;
}) {
  const nameId = useId();
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return <Modal open onClose={() => { if (!pending) onClose(); }} size="wide"
    title="Antes de ativar: conheça os riscos" description="Confirmações de consultas pelo WhatsApp conectado à Evolution">
    <form className="space-y-5" onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      setSubmitted(true);
      onAccept(new FormData(event.currentTarget));
    }}>
      <div className="space-y-4 text-sm leading-relaxed text-white/75">
        {QR_RISK_TERMS.map((p) => <section key={p.title}>
          <h3 className="font-semibold text-white/90">{p.title}</h3>
          <p className="mt-1">{p.text}</p>
        </section>)}
      </div>
      <p className="text-xs text-white/55">Termos de aceite · versão {QR_RISK_TERMS_VERSION}</p>
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <label className="flex items-start gap-3 rounded-control border border-white/10 p-3 text-sm text-white/85">
          <input type="checkbox" name="clinicorpQrRiskAccepted" value="true" checked={accepted} required
            onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-iris" />
          <span>{QR_RISK_CHECKBOX_TEXT}</span>
        </label>
        <Field label="Nome completo do responsável" htmlFor={nameId}>
          <Input id={nameId} name="clinicorpQrResponsibleName" value={name} onChange={(event) => setName(event.target.value)}
            required minLength={3} maxLength={120} autoComplete="name" placeholder="Quem está autorizando esta ativação" />
        </Field>
      </fieldset>
      <input type="hidden" name="clinicorpQrRiskVersion" value={QR_RISK_TERMS_VERSION} />
      {/* The modal makes the global toast inaccessible, so validation stays here too. */}
      <FormFeedback error={submitted ? result?.error : undefined} />
      {pending && <p role="status" className="text-sm text-white/65">Registrando o aceite e ativando as confirmações…</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={!accepted || name.trim().length < 3} loading={pending} loadingLabel="Ativando confirmações">
          Aceitar e ativar confirmações
        </Button>
      </div>
    </form>
  </Modal>;
}
