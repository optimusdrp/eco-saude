import { absenceOn, addDaysIso, dayMinutes, todayIso, toHHMM, utcToZoned, weeklyCapacity, weeklyOf, zonedToUtc } from "@ecosaude/core/crm";
import { asc, db, eq, inSequence, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { Badge, colorOf, EmptyState, PageHeader, Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { absencesByProfessional } from "@/modules/crm/hours";
import { ClinicProfileForm, ProfessionalButton } from "../forms";
import { AbsenceButton, DeleteAbsence } from "./AbsenceTools";

export const metadata: Metadata = { title: "Clínica e profissionais" };
export const dynamic = "force-dynamic";

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** Horas com vírgula decimal: 41,7 */
const hours = (min: number) => (min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const dateBR = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/**
 * AJUSTES > CLÍNICA E PROFISSIONAIS (exige "config.clinica")
 *  - SEMANA DA CLÍNICA: quem atende em cada dia, com os períodos de cada dia
 *    (cada profissional pode ter horários diferentes por dia) e a capacidade
 *  - PRÓXIMOS 14 DIAS: quem está ausente (férias, congresso, folga)
 *  - cadastro de profissionais (semana completa, duração, cor, acesso)
 *  - dados da clínica (nome que aparece nas mensagens, telefone, cidade)
 */
export default async function ClinicSettingsPage() {
  const ctx = await requireCrm("config.clinica");
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, ctx.user.clinicId) });
  const { pros, users, absences } = await withTenant(ctx.user.clinicId, async (tx) => {
    const [pros, users] = await inSequence([
      () => tx.select().from(schema.professionals).orderBy(asc(schema.professionals.name)),
      () => tx.select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)).orderBy(asc(schema.clinicUsers.name)),
    ] as const);
    const ids = pros.map((p) => p.id);
    // Ausências cadastradas (com id, para remover) a partir de hoje
    const rows = ids.length ? await tx.select().from(schema.professionalAbsences).orderBy(asc(schema.professionalAbsences.startsOn)) : [];
    return { pros, users, absences: { rows: rows.filter((r) => r.endsOn >= todayIso()), map: await absencesByProfessional(tx, ids) } };
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const active = pros.filter((p) => p.active);
  const proName = new Map(pros.map((p) => [p.id, p.name]));

  const total = active.reduce(
    (s, p) => {
      const c = weeklyCapacity(weeklyOf(p), p.slotMinutes);
      return { minutes: s.minutes + c.minutes, slots: s.slots + c.slots };
    },
    { minutes: 0, slots: 0 },
  );

  // Próximos 14 dias: quem está fora em cada dia (para enxergar férias sobrepostas)
  const today = todayIso();
  const next14 = Array.from({ length: 14 }, (_, i) => {
    const date = addDaysIso(today, i);
    const weekday = utcToZoned(zonedToUtc(date, "12:00")).weekday;
    const away = active.filter((p) => dayMinutes(weeklyOf(p), weekday, p.slotMinutes) && absenceOn(absences.map.get(p.id), date));
    const working = active.filter((p) => dayMinutes(weeklyOf(p), weekday, p.slotMinutes) && !absenceOn(absences.map.get(p.id), date));
    return { date, weekday, away, working };
  });

  return (
    <>
      <PageHeader
        title="Clínica e profissionais"
        description="Quem atende, em quais horários de cada dia, quando está ausente e como a clínica aparece para os pacientes."
        actions={
          <>
            {active.length ? <AbsenceButton professionals={active.map((p) => ({ id: p.id, name: p.name }))} /> : null}
            <ProfessionalButton users={users} />
          </>
        }
      />

      {/* ------------------------------ Grade da semana ------------------------------ */}
      <Panel
        title="Semana da clínica"
        description={
          active.length
            ? `Capacidade: ${hours(total.minutes)} horas e até ${total.slots} consultas por semana com ${active.length} ${active.length === 1 ? "profissional" : "profissionais"}.`
            : "Cadastre quem atende para ver a semana."
        }
        className="mb-5"
      >
        {active.length === 0 ? (
          <EmptyState title="Nenhum profissional ativo">Use “Novo profissional” para começar a usar a agenda.</EmptyState>
        ) : (
          <div className="thin-scroll relative overflow-x-auto">
            <table className="w-full min-w-[50rem] table-fixed text-sm">
              <thead>
                <tr className="text-xs text-ink-soft">
                  <th scope="col" className="w-44 py-2 pr-3 text-left font-semibold">
                    Profissional
                  </th>
                  {WEEK.map((d) => (
                    <th key={d} scope="col" className="px-1 py-2 text-center font-semibold capitalize">
                      {WEEKDAYS[d]}
                    </th>
                  ))}
                  <th scope="col" className="w-28 py-2 pl-3 text-right font-semibold">
                    Semana
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {active.map((p) => {
                  const week = weeklyOf(p);
                  const cap = weeklyCapacity(week, p.slotMinutes);
                  return (
                    <tr key={p.id}>
                      <th scope="row" className="py-2 pr-3 text-left font-semibold">
                        <span className="flex items-center gap-2">
                          <span className={cn("size-2.5 shrink-0 rounded-full", colorOf(p.color).dot)} aria-hidden />
                          <span className="truncate">{p.name}</span>
                        </span>
                      </th>
                      {WEEK.map((d) => {
                        const day = dayMinutes(week, d, p.slotMinutes);
                        return (
                          <td key={d} className="px-1 py-2 align-top">
                            {day ? (
                              <span className={cn("block space-y-0.5 rounded-lg border-l-4 px-1.5 py-1 text-center text-xs leading-tight", colorOf(p.color).soft, colorOf(p.color).border)}>
                                {day.periods.map((x) => (
                                  <span key={x.start} className="block font-semibold tabular">
                                    {toHHMM(x.start)}–{toHHMM(x.end)}
                                  </span>
                                ))}
                                {day.slot !== p.slotMinutes ? <span className="block text-[0.68rem] text-ink-soft">{day.slot} min</span> : null}
                              </span>
                            ) : (
                              <span className="block rounded-lg bg-fog py-2 text-center text-xs text-ink-soft" aria-label="não atende">
                                folga
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2 pl-3 text-right align-top text-xs whitespace-nowrap text-ink-soft tabular">
                        <span className="block font-semibold text-ink">{hours(cap.minutes)} h</span>
                        {cap.slots} consultas
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---------------------------- Ausências e próximos dias ---------------------------- */}
      {active.length ? (
        <Panel title="Ausências e próximos 14 dias" description="Férias, congressos e folgas. Nesses dias o profissional não aparece com horários livres." className="mb-5">
          <ol className="thin-scroll relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" aria-label="Próximos 14 dias">
            {next14.map((d) => (
              <li key={d.date} className={cn("w-[5.25rem] shrink-0 rounded-xl p-2 text-center ring-1", d.away.length ? "bg-erp-tint ring-erp/40" : "bg-paper ring-line")}>
                <span className="block text-xs text-ink-soft capitalize">{WEEKDAYS[d.weekday]}</span>
                <span className="block font-semibold tabular">{dateBR(d.date)}</span>
                <span className="mt-1 block text-[0.68rem] leading-tight text-ink-soft">
                  {d.working.length} {d.working.length === 1 ? "atende" : "atendem"}
                  {d.away.length ? <span className="block font-semibold text-erp-ink">{d.away.length} fora</span> : null}
                </span>
              </li>
            ))}
          </ol>
          {absences.rows.length ? (
            <ul className="mt-2 divide-y divide-line">
              {absences.rows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <strong>{proName.get(a.professionalId) ?? "Profissional"}</strong>: {a.startsOn === a.endsOn ? dateBR(a.startsOn) : `${dateBR(a.startsOn)} a ${dateBR(a.endsOn)}`}
                    {a.reason ? <span className="text-ink-soft">{`, ${a.reason}`}</span> : null}
                  </span>
                  <DeleteAbsence id={a.id} label={`${proName.get(a.professionalId) ?? ""} ${dateBR(a.startsOn)}`} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">Nenhuma ausência marcada.</p>
          )}
        </Panel>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel title="Profissionais" description="Os horários de cada dia e a duração da consulta definem os horários livres da agenda e da lista de espera.">
          {pros.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum profissional cadastrado.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pros.map((p) => {
                const week = weeklyOf(p);
                const cap = weeklyCapacity(week, p.slotMinutes);
                const days = WEEK.filter((d) => dayMinutes(week, d, p.slotMinutes)).map((d) => WEEKDAYS[d]);
                return (
                  <li key={p.id} className={cn("flex flex-wrap items-center gap-3 py-3", !p.active && "opacity-60")}>
                    <span className={cn("size-3 shrink-0 rounded-full", colorOf(p.color).dot)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {p.name}
                        {p.specialty ? <span className="font-normal text-ink-soft">{`, ${p.specialty}`}</span> : null}
                      </p>
                      <p className="text-sm text-ink-soft">
                        {days.join(", ")}. Consultas de {p.slotMinutes} min, {hours(cap.minutes)} h por semana.
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!p.active ? <Badge>fora da agenda</Badge> : null}
                        {absences.map.get(p.id)?.length ? <Badge tone="warning">{absences.map.get(p.id)!.length} ausência(s) marcada(s)</Badge> : null}
                        {p.userId ? <Badge tone="crm">acesso: {userName.get(p.userId) ?? "usuário desativado"}</Badge> : <Badge>sem acesso ao sistema</Badge>}
                      </div>
                    </div>
                    <ProfessionalButton
                      users={users}
                      initial={{
                        id: p.id,
                        name: p.name,
                        specialty: p.specialty ?? "",
                        color: p.color,
                        slotMinutes: p.slotMinutes,
                        weeklySchedule: week,
                        userId: p.userId ?? "",
                        active: p.active,
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Dados da clínica" description="Como a clínica aparece para os pacientes.">
          <ClinicProfileForm
            initial={{
              tradeName: clinic?.tradeName ?? ctx.user.clinicName,
              phone: clinic?.phone ?? "",
              email: clinic?.email ?? "",
              city: clinic?.city ?? "",
              state: clinic?.state ?? "",
              timeZone: clinic?.timeZone ?? ctx.user.clinicTimeZone,
            }}
            legal={{ legalName: clinic?.legalName ?? null, cnpj: clinic?.cnpj ?? null }}
          />
        </Panel>
      </div>
    </>
  );
}
