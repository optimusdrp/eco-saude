import { AlertTriangle, Pill } from "lucide-react";
import type { PatientRecord } from "@/modules/pep/records";
import { Avatar } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { ProfileEditor } from "./ProfileEditor";

const SEX = { F: "Feminino", M: "Masculino" } as const;

/**
 * Topo do prontuário: quem é o paciente e o que todo profissional precisa saber antes de
 * qualquer conduta. ALERGIAS em destaque (vermelho), "não perguntado" diferente de "nega".
 */
export function PatientSummary({ patient, canEdit, compact = false, limited = false }: { patient: PatientRecord; canEdit: boolean; compact?: boolean; /** Só identificação (sem permissão para o resumo de segurança) */ limited?: boolean }) {
  const { identity, profile } = patient;
  const active = profile.problems.filter((p) => p.active);
  const cpf = identity.cpf ? `${identity.cpf.slice(0, 3)}.${identity.cpf.slice(3, 6)}.${identity.cpf.slice(6, 9)}-${identity.cpf.slice(9)}` : null;
  return (
    <section aria-label="Resumo do paciente" className="rounded-2xl bg-paper ring-1 ring-line">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <Avatar name={identity.name} size={compact ? "md" : "lg"} />
        <div className="min-w-0 flex-1">
          <h1 className={cn("font-bold", compact ? "text-xl" : "text-2xl")}>{identity.name}</h1>
          <p className="text-sm text-ink-soft">
            {[patient.age !== null ? `${patient.age} anos` : "Idade não informada", identity.sex ? SEX[identity.sex] : null, cpf ? `CPF ${cpf}` : null].filter(Boolean).join(", ")}
          </p>
          {patient.anonymized ? <p className="mt-1 text-sm font-semibold text-erp-ink">Cadastro anonimizado a pedido do titular (LGPD). O prontuário é guardado por obrigação legal.</p> : null}
        </div>
        {canEdit && !limited && !patient.anonymized ? (
          <ProfileEditor
            contactId={patient.contact.id}
            initial={{ allergies: profile.allergies, noKnownAllergies: profile.noKnownAllergies, medications: profile.medications, problems: profile.problems, history: profile.history, version: profile.version }}
          />
        ) : null}
      </div>

      {limited ? null : (
      <dl className="grid gap-px overflow-hidden rounded-b-2xl border-t border-line bg-line sm:grid-cols-3">
        <div className={cn("bg-paper p-4", profile.allergies.length ? "bg-alert-tint" : "")}>
          <dt className={cn("flex items-center gap-1.5 text-xs font-bold", profile.allergies.length ? "text-alert" : "text-ink-soft")}>
            <AlertTriangle className="size-3.5" aria-hidden />
            Alergias
          </dt>
          <dd className="mt-1">
            {profile.allergies.length ? (
              <ul className="space-y-0.5">
                {profile.allergies.map((a) => (
                  <li key={a.name} className="font-semibold text-alert">
                    {a.name}
                    {a.reaction || a.severity ? <span className="font-normal"> ({[a.reaction, a.severity].filter(Boolean).join(", ")})</span> : null}
                  </li>
                ))}
              </ul>
            ) : profile.noKnownAllergies ? (
              <span>Nega alergias</span>
            ) : (
              <span className="text-ink-soft">Não registrado. Pergunte.</span>
            )}
          </dd>
        </div>
        <div className="bg-paper p-4">
          <dt className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
            <Pill className="size-3.5" aria-hidden />
            Medicamentos em uso
          </dt>
          <dd className="mt-1">
            {profile.medications.length ? (
              <ul className="space-y-0.5">
                {profile.medications.map((m) => (
                  <li key={m.name}>
                    {m.name}
                    {m.dose ? <span className="text-ink-soft"> {m.dose}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-ink-soft">Nenhum registrado</span>
            )}
          </dd>
        </div>
        <div className="bg-paper p-4">
          <dt className="text-xs font-bold text-ink-soft">Problemas ativos</dt>
          <dd className="mt-1">
            {active.length ? (
              <ul className="space-y-0.5">
                {active.map((p) => (
                  <li key={`${p.cid}-${p.name}`}>
                    {p.cid ? <span className="font-semibold tabular">{p.cid} </span> : null}
                    {p.name}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-ink-soft">Nenhum registrado</span>
            )}
          </dd>
        </div>
        {profile.history && !compact ? (
          <div className="bg-paper p-4 sm:col-span-3">
            <dt className="text-xs font-bold text-ink-soft">Antecedentes</dt>
            <dd className="mt-1 whitespace-pre-wrap">{profile.history}</dd>
          </div>
        ) : null}
      </dl>
      )}
    </section>
  );
}
