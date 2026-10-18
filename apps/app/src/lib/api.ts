import "server-only";
import type { ClinicPermission } from "@ecosaude/core/crm";
import { NextResponse } from "next/server";
import { authorizeCrm, type CrmContext } from "@/lib/auth/dal";

/**
 * Rotas de API usadas pelas telas (JSON). Mesma verificação das actions:
 * sessão válida, módulo CRM contratado e permissão do perfil.
 */
export async function apiContext(permission: ClinicPermission): Promise<CrmContext | NextResponse> {
  const ctx = await authorizeCrm(permission);
  if (!ctx) return NextResponse.json({ error: "Sem acesso." }, { status: 401 });
  return ctx;
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;
