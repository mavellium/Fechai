import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  clearLoginFailures,
  peekLoginBlock,
  registerLoginFailure,
} from "@/lib/login-throttle";
import { recordLoginAttempt, requestContext } from "@/modules/auth/attempts";

/**
 * Sanidade de entrada do login — de propósito NÃO usa a política de senha
 * forte (`lib/password`). Ela vale para senha NOVA (cadastro, troca, criação
 * pelo admin); aplicá-la aqui trancaria para fora todo mundo que criou a conta
 * antes da regra, sem nenhum ganho de segurança: quem sabe a senha certa já
 * sabe a senha certa.
 */
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Hash descartável comparado quando o e-mail não existe. Sem ele, "conta
 * inexistente" responde em ~1ms e "senha errada" em ~235ms (o custo do bcrypt),
 * e essa diferença sozinha já permite descobrir quem é cliente do produto.
 * É um bcrypt válido de uma senha aleatória — nunca vai bater com nada.
 *
 * O CUSTO DELE PRECISA ACOMPANHAR `BCRYPT_COST` (src/lib/password.ts). Um dummy
 * mais barato que os hashes reais responde mais rápido e reabre exatamente a
 * diferença de tempo que ele existe para esconder — medido: dummy custo 10
 * contra hash custo 12 vaza ~176ms, o mesmo custo vaza ~4ms. Para trocar:
 *   node -e "console.log(require('bcryptjs').hashSync(require('crypto').randomBytes(24).toString('hex'), 12))"
 */
const DUMMY_HASH = "$2b$12$9lmSi6lNXwxr03tpI4po4e9H1t5T/30TlyBgik3mGEFP7li9a84T2";

const GOOGLE_PROVIDER = "google";

/**
 * O produto já usava GOOGLE_CLIENT_ID/SECRET na integração com o Google Agenda.
 * AUTH_GOOGLE_* tem prioridade para quem quiser um cliente OAuth separado só
 * para o login; sem nenhum dos dois pares o provider não é registrado e o botão
 * "Entrar com Google" some da tela — em vez de quebrar em runtime.
 */
const googleClientId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret =
  process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

export const isGoogleAuthConfigured = Boolean(googleClientId && googleClientSecret);

const authUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  tenantId: true,
} as const;

async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { ...authUserSelect, passwordHash: true },
  });
}

/**
 * Anota o vínculo com a conta Google. Não derruba o login se falhar: é metadado
 * (por onde a pessoa entrou), não autorização.
 */
async function linkGoogleAccount(userId: string, googleSub: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { googleId: googleSub, googleLinkedAt: new Date() },
    });
  } catch (error) {
    console.error("[auth] não foi possível vincular a conta Google:", error);
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  // `error` aponta para /login: assim o erro do OAuth volta como ?error= na
  // própria tela de login, em português, em vez da página padrão do NextAuth.
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const context = await requestContext();
        const parsed = credentialsSchema.safeParse(raw);

        if (!parsed.success) {
          await recordLoginAttempt({
            context,
            email: typeof raw?.email === "string" ? raw.email : null,
            success: false,
            provider: "credentials",
            reason: "invalid_payload",
          });
          return null;
        }

        const { email, password } = parsed.data;

        // O freio vem ANTES do bcrypt: quem está bloqueado não deve nem custar
        // CPU, que é justamente o recurso que um ataque quer consumir.
        const block = await peekLoginBlock(email, context.ip);
        if (block.blocked) {
          await recordLoginAttempt({
            context,
            email,
            success: false,
            provider: "credentials",
            reason: "blocked",
          });
          return null;
        }

        const user = await findUserByEmail(email);
        const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user?.passwordHash || !ok) {
          await registerLoginFailure(email, context.ip);
          await recordLoginAttempt({
            context,
            email,
            success: false,
            provider: "credentials",
            reason: user ? "bad_password" : "no_account",
          });
          return null;
        }

        // Acertou: o contador zera. Sem isso, quem erra duas vezes hoje e uma
        // amanhã acabaria bloqueado sem nunca ter sofrido ataque nenhum.
        await clearLoginFailures(email, context.ip);
        await recordLoginAttempt({ context, email, success: true, provider: "credentials" });

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
          tenantId: user.tenantId,
        };
      },
    }),
    ...(isGoogleAuthConfigured
      ? [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            // `select_account` evita o login silencioso na única conta logada no
            // navegador — em máquina compartilhada isso entrava na conta errada
            // sem a pessoa perceber que trocou de identidade.
            authorization: { params: { prompt: "select_account" } },
          }),
        ]
      : []),
  ],
  callbacks: {
    /**
     * O Google aqui **não cria conta**: é outra porta para uma conta que já
     * existe. O /cadastro exige CPF/CNPJ, telefone, nascimento e segmento —
     * dados que o Google não fornece — então um tenant criado por aqui nasceria
     * pela metade. Quem ainda não tem conta é mandado para o cadastro.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== GOOGLE_PROVIDER) return true;

      const context = await requestContext();
      const email = user.email?.toLowerCase() ?? "";

      // Sem e-mail verificado pelo Google, quem controla um domínio qualquer
      // poderia reivindicar o endereço de um cliente.
      if (!email || (profile as { email_verified?: boolean } | undefined)?.email_verified !== true) {
        await recordLoginAttempt({
          context,
          email: email || null,
          success: false,
          provider: "google",
          reason: "google_unverified",
        });
        return "/login?error=google_unverified";
      }

      const dbUser = await findUserByEmail(email);
      if (!dbUser) {
        await recordLoginAttempt({
          context,
          email,
          success: false,
          provider: "google",
          reason: "google_no_account",
        });
        return "/login?error=google_no_account";
      }

      await linkGoogleAccount(dbUser.id, account.providerAccountId);
      await clearLoginFailures(email, context.ip);
      await recordLoginAttempt({ context, email, success: true, provider: "google" });
      return true;
    },

    async jwt({ token, user, account }) {
      // No login pelo Google o `user` vem do perfil do Google, não do nosso
      // banco: `id` é o `sub` do Google e não existe role nem tenantId. Sem
      // esta releitura `session.user.id` viraria o id do Google e toda query
      // multi-tenant passaria a filtrar por um tenant que não existe.
      if (account?.provider === GOOGLE_PROVIDER && user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: authUserSelect,
        });
        if (dbUser) {
          token.sub = dbUser.id;
          token.name = dbUser.name;
          token.email = dbUser.email;
          token.role = dbUser.role;
          token.tenantId = dbUser.tenantId;
          return token;
        }
      }

      if (user) {
        token.role = user.role;
        token.tenantId = user.tenantId;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.tenantId = token.tenantId as string;
      }
      return session;
    },
  },
});
