import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTenantWithOwner } from "@/modules/tenants/provision";
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

  const { email, password, name, document, phone, phoneSecondary, birthDate, gender, city, state, businessSegment, referralSource } =
    parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await createTenantWithOwner({
    tenantName: name?.trim() || email.split("@")[0],
    email,
    passwordHash,
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

  return NextResponse.json({ ok: true }, { status: 201 });
}
