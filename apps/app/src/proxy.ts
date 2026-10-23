import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy: checagem rápida antes de cada página. Sem cookie de sessão, vai para o login.
 * A validação real (sessão no banco, permissões, módulo contratado) fica no DAL.
 * Webhooks e rotinas agendadas têm autenticação própria (assinatura/segredo).
 */
const SESSION_COOKIE = "eco_app_session";
// /api/midia/: link temporário e ASSINADO de anexo enviado (o Instagram busca o arquivo por link)
// /documento: verificação pública de receita/atestado pelo código impresso (farmácia, escola, empresa)
const PUBLIC_PREFIXES = ["/login", "/api/webhooks/", "/api/cron/", "/api/midia/", "/documento"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (!isPublic && !req.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
