import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Health check para deploy/monitoramento. Verifica o banco.
export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  const body = {
    ok: db,
    db,
    redis: Boolean(process.env.REDIS_URL),
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: db ? 200 : 503 });
}
