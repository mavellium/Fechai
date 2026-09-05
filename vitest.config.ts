import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Sem setup global de banco: estes testes são de REGRA (autorização,
    // limites, criptografia), não de integração. Rodam em qualquer máquina e no
    // CI sem Postgres nem Redis no ar — que é o que os torna executáveis a cada
    // push, e não só quando alguém lembra.
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
