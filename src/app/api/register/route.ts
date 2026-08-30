import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTenantWithOwner } from "@/modules/tenants/provision";
import { REFERRAL_COOKIE } from "@/modules/affiliates/config";
import { attachReferralToTenant, ensureAffiliate } from "@/modules/affiliates/service";
import { isValidPlan } from "@/modules/billing/service";
import {
  onlyDigits,
  isValidCpfCnpj,
  isValidPhone,
  GENDER_OPTIONS,
  BRAZILIAN_STATES,
  BUSINESS_SEGMENTS,
  REFERRAL_SOURCES,
} from "@/lib/br-lead";
import { strongPassword } from "@/lib/password-schema";

// Idade mínima exigida no cadastro — alinhado com a maioridade civil, já que
// é quem assina a conta (responsável pelo negócio), não um lead qualquer.
const MIN_AGE_YEARS = 18;

const schema = z.object({
  email: z.string().email(),
  // A política inteira (tamanho, classes de caractere, sequências) mora em
  // lib/password — o formulário usa exatamente a mesma função.
  password: strongPassword(),
  name: z.string().trim().optional(),
  document: z
    .string()
    .refine(isValidCpfCnpj, "CPF ou CNPJ inválido — confira os números."),
  phone: z.string().refine(isValidPhone, "Telefone inválido — inclua o DDD."),
  phoneSecondary: z
    .string()
    .optional()
    .refine((v) => !v || isValidPhone(v), "Telefone secundário inválido — inclua o DDD."),
  birthDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Data de nascimento inválida.")
    .refine((v) => {
      const date = new Date(v);
      const age = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      return age >= MIN_AGE_YEARS && age < 130;
    }, `É preciso ter pelo menos ${MIN_AGE_YEARS} anos para criar uma conta.`),
  gender: z.enum(GENDER_OPTIONS.map((g) => g.value) as [string, ...string[]], {
    message: "Selecione um gênero.",
  }),
  city: z.string().trim().min(1, "Informe a cidade"),
  state: z.enum(BRAZILIAN_STATES, { message: "Selecione um estado." }),
  businessSegment: z.enum(BUSINESS_SEGMENTS.map((s) => s.value) as [string, ...string[]], {
    message: "Selecione o segmento do seu negócio.",
  }),
  referralSource: z.enum(REFERRAL_SOURCES.map((r) => r.value) as [string, ...string[]], {
    message: "Selecione como conheceu o fechai.",
  }),
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
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  const { email, password, name, document, phone, phoneSecondary, birthDate, gender, city, state, businessSegment, referralSource, roles } =
    parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
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
      birthDate: new Date(birthDate),
      gender,
      city: city.trim(),
      state,
      businessSegment,
      referralSource,
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
