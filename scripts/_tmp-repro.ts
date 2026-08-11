import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

async function main() {
  const email = "temp.smoke@teste.local";
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({
    data: {
      email,
      name: "Temp Smoke",
      passwordHash: await bcrypt.hash("teste123", 10),
      role: "OWNER",
      tenantId: "cms4zzs19000cvmzws09hbuwc",
    },
  });
  console.log("created", user.id);
}
main().finally(() => prisma.$disconnect());
