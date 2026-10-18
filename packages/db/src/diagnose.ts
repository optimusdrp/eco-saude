/**
 * Traduz erros de conexão com o PostgreSQL em instruções práticas.
 * Usado por migrate.ts, seed.ts e check.ts para que o erro diga o que fazer,
 * e não só "falhou".
 */

/** Extrai o código do erro, mesmo quando o drizzle embrulha o erro original em `cause`. */
function errorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

/** Mostra a URL de conexão sem a senha (nunca imprimir senha no terminal). */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "(DATABASE_URL inválida)";
  }
}

/** Devolve um texto explicando a causa provável e como resolver. */
export function explainDbError(error: unknown, url: string): string {
  const code = errorCode(error);
  const target = safeUrl(url);
  const port = (() => {
    try {
      return new URL(url).port || "5432";
    } catch {
      return "?";
    }
  })();

  switch (code) {
    // Senha errada
    case "28P01":
    case "28000":
      return [
        `Usuário ou senha recusados pelo PostgreSQL em ${target}.`,
        "",
        "Causas mais comuns:",
        `  1. Existe OUTRO PostgreSQL instalado no computador usando a porta ${port}`,
        "     (mensagem de erro em português indica isso: a imagem Docker responde em inglês).",
        `     Confira com:  netstat -ano | findstr :${port}`,
        "     Solução: use a porta do Docker deste projeto (54320) no DATABASE_URL do .env:",
        "       DATABASE_URL=postgres://postgres:postgres@localhost:54320/ecosaude",
        "  2. O volume do Docker foi criado antes com outra senha (a senha só vale na 1ª criação).",
        "     Solução (APAGA os dados locais): pnpm db:reset-local",
        "",
        "Depois rode: pnpm db:check",
      ].join("\n");

    // Nada escutando na porta
    case "ECONNREFUSED":
      return [
        `Nenhum PostgreSQL respondeu em ${target}.`,
        "  1. O Docker Desktop está aberto?",
        "  2. Suba o banco: pnpm db:up  (e aguarde uns segundos)",
        "  3. Confira se a porta do DATABASE_URL é 54320.",
      ].join("\n");

    // Banco não existe
    case "3D000":
      return [
        `O servidor respondeu, mas o banco do DATABASE_URL não existe (${target}).`,
        "  Se estiver usando o Docker deste projeto, o banco \"ecosaude\" é criado sozinho.",
        "  Confira o nome do banco no final do DATABASE_URL.",
      ].join("\n");

    case "ENOTFOUND":
      return `Endereço do servidor não encontrado em ${target}. Confira o host no DATABASE_URL.`;

    case "ETIMEDOUT":
      return `Tempo esgotado ao conectar em ${target}. Firewall ou servidor fora do ar?`;

    default:
      return `Erro ao acessar o banco (${target}): ${(error as Error)?.message ?? String(error)}`;
  }
}
