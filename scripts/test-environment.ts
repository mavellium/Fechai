import "dotenv/config";

import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const mode = process.argv[2] ?? "dev";
const productionUrl = process.env.DATABASE_URL?.trim();
const configuredTestUrl = process.env.TEST_DATABASE_URL?.trim();
const testUrl = configuredTestUrl || deriveTestUrl(productionUrl);

if (!testUrl) {
  fail("Defina DATABASE_URL ou TEST_DATABASE_URL antes de iniciar o ambiente de testes.");
}
if (productionUrl && normalize(productionUrl) === normalize(testUrl)) {
  fail("TEST_DATABASE_URL não pode apontar para o mesmo banco de DATABASE_URL.");
}

const parsed = new URL(testUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!/(test|teste|sandbox|lab)/i.test(databaseName)) {
  fail('Por segurança, o nome do banco de testes precisa conter "test", "teste", "sandbox" ou "lab".');
}

const childEnv = {
  ...process.env,
  DATABASE_URL: testUrl,
  DATABASE_ENVIRONMENT: "test",
  NEXTAUTH_URL: mode === "dev" ? "http://localhost:3002" : process.env.NEXTAUTH_URL,
};

async function main() {
  await ensureDatabase(parsed, databaseName);

  if (mode === "prepare") {
    run("prisma", ["db", "push", "--skip-generate"]);
    run("prisma", ["db", "seed"]);
  } else if (mode === "push") {
    run("prisma", ["db", "push", "--skip-generate"]);
  } else if (mode === "seed") {
    run("prisma", ["db", "seed"]);
  } else if (mode === "studio") {
    run("prisma", ["studio"]);
  } else if (mode === "dev") {
    run("next", ["dev", "-p", "3002"]);
  } else {
    fail(`Modo desconhecido: ${mode}`);
  }
}

function normalize(value: string): string {
  const url = new URL(value);
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}

function deriveTestUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  const current = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!current) return undefined;
  url.pathname = `/${current}_test`;
  return url.toString();
}

async function ensureDatabase(url: URL, name: string) {
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
      name,
    );
    if (!rows[0]?.exists) {
      // O identificador não aceita interpolação SQL. A whitelist impede que o
      // nome vindo da URL vire comando; hífen e underscore são suficientes.
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        fail("O nome do banco de testes contém caracteres não permitidos.");
      }
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      process.stdout.write(`Banco de testes criado: ${name}\n`);
    }
  } finally {
    await admin.$disconnect();
  }
}

function run(command: string, args: string[]) {
  const entrypoints = {
    next: path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"),
    prisma: path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
  } as const;
  const entrypoint = entrypoints[command as keyof typeof entrypoints];
  if (!entrypoint) throw new Error(`Ferramenta local desconhecida: ${command}.`);

  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    env: childEnv,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} terminou com código ${result.status ?? 1}.`);
  }
}

function fail(message: string): never {
  process.stderr.write(`Ambiente de testes recusado: ${message}\n`);
  process.exit(1);
}

void main().catch((error) => {
  process.stderr.write(
    `Não foi possível preparar o ambiente de testes: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
