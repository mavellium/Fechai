import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    tenantId?: string;
  }
  interface Session {
    user: {
      id: string;
      role: string;
      tenantId: string;
      /** true quando o superadmin está vendo o painel de outro usuário. */
      impersonating?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    tenantId?: string;
  }
}
