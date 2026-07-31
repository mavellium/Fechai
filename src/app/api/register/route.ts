import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTenantWithOwner } from "@/modules/tenants/provision";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Mínimo de 6 caracteres"),
  name: z.string().trim().optional(),
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

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await createTenantWithOwner({
    tenantName: name?.trim() || email.split("@")[0],
    email,
    passwordHash,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
