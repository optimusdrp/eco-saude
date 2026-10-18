import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (antigo "middleware" do Next.js): roda antes de cada página.
 * Faz só uma checagem RÁPIDA e otimista: sem cookie de sessão, vai para o login.
 * A validação real (sessão no banco, 2FA, permissões) acontece no DAL
 * (src/lib/auth/dal.ts), perto dos dados.
 */
const SESSION_COOKIE = "eco_bo_session";
const PUBLIC_PATHS = ["/login"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p);
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // Não roda para arquivos estáticos e imagens
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
