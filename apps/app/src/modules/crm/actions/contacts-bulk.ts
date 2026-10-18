"use server";

import { inArray, schema, sql } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, type ActionState } from "@/lib/server";
import { runCrm } from "../run";

/**
 * ETIQUETAS EM LOTE (tela de Contatos): adiciona ou remove uma etiqueta de
 * vários contatos de uma vez. Etiqueta é texto curto em minúsculas
 * ("vip", "convênio", "indicação"): "VIP " vira "vip".
 */
export async function bulkTagAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("contatos.massa");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({
      ids: z.array(z.uuid()).min(1, "Escolha ao menos um contato.").max(500),
      tag: z
        .string()
        .trim()
        .toLowerCase()
        .min(1, "Escreva a etiqueta.")
        .max(40, "Etiqueta muito longa (até 40 letras)."),
      mode: z.enum(["adicionar", "remover"]),
    })
    .safeParse({ ids: form.getAll("id"), tag: field(form, "tag") ?? "", mode: field(form, "mode") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos.", errors: { tag: parsed.error.issues[0]?.message ?? "" } };
  const { ids, tag, mode } = parsed.data;
  try {
    await runCrm(ctx, (tx) =>
      tx
        .update(schema.contacts)
        .set({
          tags:
            mode === "adicionar"
              ? // sem repetir: só acrescenta se ainda não tem
                sql`case when ${tag} = any(${schema.contacts.tags}) then ${schema.contacts.tags} else array_append(${schema.contacts.tags}, ${tag}) end`
              : sql`array_remove(${schema.contacts.tags}, ${tag})`,
          version: sql`${schema.contacts.version} + 1`,
        })
        .where(inArray(schema.contacts.id, ids)),
    );
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/crm/contatos");
  revalidatePath("/crm/jornada");
  const n = ids.length;
  return { ok: true, message: mode === "adicionar" ? `Etiqueta “${tag}” adicionada a ${n} ${n === 1 ? "contato" : "contatos"}.` : `Etiqueta “${tag}” removida de ${n} ${n === 1 ? "contato" : "contatos"}.` };
}
