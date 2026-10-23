import { runDemoExtras } from "@ecosaude/db/seed-demo";
import { E2E } from "./support/env";
import { value } from "./support/db";
import { expect, test } from "./support/fixtures";

/**
 * DADOS DE DEMONSTRAÇÃO (pnpm db:seed -- --demo): cada tela tem o que mostrar.
 *
 * O complemento do seed é aditivo; aqui ele roda de novo para recolocar o prontuário de
 * demonstração (outros testes limpam os dados clínicos) e confirmar que rodar duas vezes
 * não duplica nada.
 */
test("a demonstração preenche todas as telas e pode rodar de novo sem duplicar", async ({ as }) => {
  test.setTimeout(180_000);
  await runDemoExtras(E2E.databaseUrl);
  const count = () => value<number>("select count(*)::int from appointments");
  const before = await count();
  await runDemoExtras(E2E.databaseUrl);
  expect(await count(), "rodar de novo não cria consultas repetidas").toBe(before);

  // Banco: o que cada tela precisa
  const n = (sql: string) => value<number>(sql);
  expect(await n("select count(*)::int from appointments where status in ('compareceu','faltou')")).toBeGreaterThanOrEqual(150); // risco aprendido
  expect(await n("select count(*)::int from appointments where arrived_at is not null and finished_at is not null")).toBeGreaterThanOrEqual(50); // duração
  expect(await n("select count(*)::int from pep_encounters where status = 'finalizado'")).toBeGreaterThanOrEqual(20);
  expect(await n("select count(*)::int from pep_documents")).toBeGreaterThan(0);
  expect(await n("select count(*)::int from privacy_requests")).toBeGreaterThanOrEqual(3);
  expect(await n("select count(*)::int from automation_rules")).toBeGreaterThanOrEqual(3);
  expect(await n("select count(*)::int from leads where 'lab' = any(interests)")).toBeGreaterThan(0);

  // Telas (gestão)
  const g = await as("gestor");
  const checks: [string, RegExp][] = [
    ["/configuracoes/duracoes", /atendimentos medidos/],
    ["/crm/contatos/privacidade", /LGPD-\d{4}-00002/],
    ["/configuracoes/automacoes?aba=regras", /Urgência: avisar a gestão/],
    ["/configuracoes/prontuario", /Acesso de emergência/],
    ["/crm/conversas/leads", /Priscila Antunes/],
    ["/configuracoes/equipe", /Joana Martins/],
  ];
  for (const [path, text] of checks) {
    await g.goto(path);
    await expect(g.getByText(text).first(), path).toBeVisible();
  }

  // Tarefas da recepção (atrasada, de hoje e de retorno)
  const r = await as("recepcao");
  await r.goto("/crm/tarefas");
  await expect(r.getByText("Enviar resultado de exame por e-mail").first()).toBeVisible();

  // Prontuário: histórico do paciente e documento que confere na verificação pública
  const b = await as("beatriz");
  const contact = await value<string>(
    "select e.contact_id from pep_encounters e join professionals p on p.id = e.professional_id where p.name = 'Dra. Beatriz Lemos' and e.status = 'finalizado' group by e.contact_id order by count(*) desc limit 1",
  );
  await b.goto(`/prontuario/pacientes/${contact}`);
  await expect(b.getByText("Dra. Beatriz Lemos, Dermatologia").first()).toBeVisible();
  const code = await value<string>("select verification_code from pep_documents where revoked_at is null limit 1");
  const pub = await as("anonimo");
  await pub.goto(`/documento/${code}`);
  await expect(pub.getByRole("heading", { name: /autêntico/i })).toBeVisible();
});
