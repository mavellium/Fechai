import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "@/lib/password";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, formatWait } from "@/lib/rate-limit";
import { createTenantWithOwner } from "@/modules/tenants/provision";
import { REFERRAL_COOKIE } from "@/modules/affiliates/config";
import { attachReferralToTenant, ensureAffiliate } from "@/modules/affiliates/service";
import { isValidPlan } from "@/modules/billing/service";
import {
  onlyDigits,
  isValidCnpj,
  isValidPhone,
  isValidCep,
  BRAZILIAN_STATES,
  BUSINESS_SEGMENTS,
  REFERRAL_SOURCES,
  OTHER_VALUE,
  OTHER_DETAIL_MAX,
} from "@/lib/br-lead";
import { strongPassword } from "@/lib/password-schema";

/**
 * Texto livre que acompanha a opção "Outro" de segmento e de origem. Opcional
 * no schema e exigido pelo `superRefine` abaixo só quando a escolha foi
 * "outro" — a obrigatoriedade depende de outro campo, coisa que `z.string()`
 * sozinho não sabe expressar.
 */
const otherDetail = z.string().trim().max(OTHER_DETAIL_MAX).optional();

const schema = z
  .object({
    email: z.string().email(),
    // A política inteira (tamanho, classes de caractere, sequências) mora em
    // lib/password — o formulário usa exatamente a mesma função.
    password: strongPassword(),
    name: z.string().trim().optional(),
    // Só empresas se cadastram no fechai: o documento é CNPJ, e CPF é
    // recusado aqui do mesmo jeito que o formulário nem oferece o caminho.
    document: z.string().refine(isValidCnpj, "CNPJ inválido — confira os números."),
    phone: z.string().refine(isValidPhone, "Telefone inválido — inclua o DDD."),
    phoneSecondary: z
      .string()
      .optional()
      .refine((v) => !v || isValidPhone(v), "Telefone secundário inválido — inclua o DDD."),
    // Endereço do negócio. O CEP chega validado só no formato: quem diz se ele
    // existe é o ViaCEP, no cliente, e um cadastro não é recusado aqui porque
    // um serviço de terceiro não conhece um CEP novo.
    zipCode: z.string().refine(isValidCep, "CEP inválido — são 8 dígitos."),
    street: z.string().trim().min(1, "Informe o logradouro."),
    addressNumber: z.string().trim().min(1, "Informe o número."),
    complement: z.string().trim().max(120).optional(),
    neighborhood: z.string().trim().min(1, "Informe o bairro."),
    city: z.string().trim().min(1, "Informe a cidade"),
    state: z.enum(BRAZILIAN_STATES, { message: "Selecione um estado." }),
    businessSegment: z.enum(BUSINESS_SEGMENTS.map((s) => s.value) as [string, ...string[]], {
      message: "Selecione o segmento do seu negócio.",
    }),
    businessSegmentOther: otherDetail,
    referralSource: z.enum(REFERRAL_SOURCES.map((r) => r.value) as [string, ...string[]], {
      message: "Selecione como conheceu o fechai.",
    }),
    referralSourceOther: otherDetail,
    /**
     * Papéis escolhidos no cadastro. "cliente" = usa o agente; "afiliado" = ganha
     * comissão indicando. Não são exclusivos: a mesma pessoa pode ser os dois, e
     * é justamente o caso mais comum (quem usa e gosta é quem melhor indica).
     *
     * A conta (tenant) nasce sempre — o painel, os planos e o próprio login
     * dependem dela. Marcar "afiliado" apenas ACRESCENTA o cadastro no programa.
     */
    roles: z
      .array(z.enum(["cliente", "afiliado"]))
      .min(1, "Escolha como você vai usar o fechai.")
      .default(["cliente"]),
  })
  .superRefine((data, ctx) => {
    // "Outro" sem o detalhe é um dado que não qualifica ninguém — a mesma
    // regra que o formulário aplica, repetida aqui porque o cliente não é
    // quem decide o que entra no banco.
    if (data.businessSegment === OTHER_VALUE && !data.businessSegmentOther) {
      ctx.addIssue({
        code: "custom",
        path: ["businessSegmentOther"],
        message: "Conte qual é o segmento.",
      });
    }
    if (data.referralSource === OTHER_VALUE && !data.referralSourceOther) {
      ctx.addIssue({
        code: "custom",
        path: ["referralSourceOther"],
        message: "Conte como você conheceu o fechai.",
      });
    }
  });

/**
 * Freio por IP no cadastro.
 *
 * Cada requisição aqui roda um `bcrypt.hash` — caro em CPU de propósito — e
 * cria tenant + usuário. Sem limite, algumas requisições paralelas saturam a
 * VPS que também hospeda Postgres, Redis e o worker, derrubando o atendimento
 * de todos os tenants. O limite é generoso: ninguém cria 5 contas por hora do
 * mesmo IP de boa-fé, mas escritório com IP compartilhado não é bloqueado.
 */
const REGISTER_MAX_PER_IP = 5;
const REGISTER_WINDOW_SECONDS = 60 * 60;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "desconhecido"
  );
}

export async function POST(req: Request) {
  // Antes do parse e, principalmente, antes do bcrypt: quem está no limite não
  // deve custar a CPU que o ataque quer consumir (mesma ordem do login).
  const limit = await rateLimit(
    "register:ip",
    await clientIp(),
    REGISTER_MAX_PER_IP,
    REGISTER_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Muitas contas criadas deste endereço. Tente de novo em ${formatWait(
          limit.retryAfterSeconds,
        )}.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  const {
    email,
    password,
    name,
    document,
    phone,
    phoneSecondary,
    zipCode,
    street,
    addressNumber,
    complement,
    neighborhood,
    city,
    state,
    businessSegment,
    businessSegmentOther,
    referralSource,
    referralSourceOther,
    roles,
  } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const { tenant, user } = await createTenantWithOwner({
    tenantName: name?.trim() || email.split("@")[0],
    email,
    passwordHash,
    // Quem não marcou "usar no meu negócio" entra só como afiliado: o painel
    // esconde as telas do agente e o aviso de teste grátis.
    usesProduct: roles.includes("cliente"),
    lead: {
      document: onlyDigits(document),
      phone: onlyDigits(phone),
      phoneSecondary: phoneSecondary ? onlyDigits(phoneSecondary) : undefined,
      zipCode: onlyDigits(zipCode),
      street: street.trim(),
      addressNumber: addressNumber.trim(),
      complement: complement?.trim() || undefined,
      neighborhood: neighborhood.trim(),
      city: city.trim(),
      state,
      businessSegment,
      // O detalhe só acompanha a opção "Outro": guardá-lo junto de um segmento
      // nomeado deixaria no banco um texto que a tela nunca mostra.
      businessSegmentOther:
        businessSegment === OTHER_VALUE ? businessSegmentOther?.trim() : undefined,
      referralSource,
      referralSourceOther:
        referralSource === OTHER_VALUE ? referralSourceOther?.trim() : undefined,
    },
  });

  // Indicação e programa de afiliados são EFEITOS COLATERAIS do cadastro: a
  // conta já existe e a pessoa já pode entrar. Uma falha aqui não pode
  // devolver erro — isso faria o formulário dizer "não deu certo" para quem
  // acabou de ter a conta criada, e a segunda tentativa bateria em
  // "e-mail já cadastrado".
  const jar = await cookies();
  const refCode = jar.get(REFERRAL_COOKIE)?.value;
  if (refCode) {
    try {
      const planHint = jar.get(`${REFERRAL_COOKIE}_plano`)?.value?.toUpperCase();
      await attachReferralToTenant({
        code: refCode,
        tenantId: tenant.id,
        planKeyHint: planHint && isValidPlan(planHint) ? planHint : null,
      });
      // Crédito atribuído: o cookie cumpriu o papel e sai de cena, para uma
      // segunda conta no mesmo navegador não ser creditada de novo.
      jar.delete(REFERRAL_COOKIE);
      jar.delete(`${REFERRAL_COOKIE}_plano`);
    } catch (err) {
      console.error("[register] falha ao vincular indicação", err);
    }
  }

  if (roles.includes("afiliado")) {
    try {
      await ensureAffiliate(user.id);
    } catch (err) {
      console.error("[register] falha ao criar afiliado", err);
    }
  }

  return NextResponse.json({ ok: true, affiliate: roles.includes("afiliado") }, { status: 201 });
}
