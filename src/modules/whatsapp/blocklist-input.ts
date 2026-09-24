import { maskPhone } from "@/lib/br-lead";

/** Máscara do campo de bloqueio, que também aceita código do país e números estrangeiros. */
export function formatBlockedPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");

  // O sinal + precisa sobreviver a cada tecla: sem ele a máscara local
  // cortaria o número antes de a pessoa terminar de digitar +55.
  if (value.trimStart().startsWith("+")) {
    if (!digits.startsWith("55")) return value;
    const local = digits.slice(2);
    return local.length <= 11 ? `+55${local ? ` ${maskPhone(local)}` : ""}` : value;
  }

  // Um 55 sem + pode ser o DDD de um número local. Só é código do país quando
  // há mais de 11 dígitos; os demais números longos ficam intactos.
  if (digits.length > 11) {
    return digits.startsWith("55") && digits.length <= 13
      ? `+55 ${maskPhone(digits.slice(2))}`
      : value;
  }

  return maskPhone(value);
}
