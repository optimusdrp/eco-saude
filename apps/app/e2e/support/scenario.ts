import { demo, exec, value } from "./db";

/**
 * Cenários reaproveitados pelos testes. Tudo é refeito a cada execução: o mesmo banco de
 * testes pode ser usado muitas vezes (inclusive em dias diferentes, sem depender das datas
 * da demonstração).
 */

/** Apaga o que os testes do Prontuário criam (como dono das tabelas, sem as travas do app) */
export async function resetClinicalData() {
  await exec(`delete from user_notices; delete from pep_audit; delete from pep_triages; delete from pep_documents; delete from pep_addenda;
              delete from pep_encounters; delete from pep_patient_profiles; delete from pep_settings; delete from pep_templates;
              delete from tasks where kind = 'retorno'`);
  await exec(`update clinic_users set unit_ids = '{}', permission_grants = '{}', permission_revokes = '{}',
              health_council = null, health_council_number = null, health_council_uf = null`);
}

/**
 * Garante UMA consulta HOJE (22:00, horário de Brasília) do paciente com o profissional,
 * no local da semana do profissional, e devolve o id. Consultas anteriores dos dois hoje somem.
 */
export async function todayAppointment(contactName: string, professionalName: string): Promise<{ appointmentId: string; contactId: string }> {
  const contactId = (await demo.contactId(contactName))!;
  const proId = (await demo.professionalId(professionalName))!;
  await exec(
    `delete from appointments where contact_id = $1 and professional_id = $2
        and (starts_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date`,
    [contactId, proId],
  );
  // Unidade e consultório do primeiro período do dia (o mesmo que a regra do app escolheria)
  const id = await value<string>(
    `insert into appointments (clinic_id, contact_id, professional_id, unit_id, room_id, starts_at, ends_at, status, service)
     select p.clinic_id, $1, p.id,
            coalesce((p.weekly_schedule -> extract(dow from now() at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'unitId')::uuid,
                     (select u.id from clinic_units u where u.clinic_id = p.clinic_id and u.main)),
            (p.weekly_schedule -> extract(dow from now() at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'roomId')::uuid,
            ((now() at time zone 'America/Sao_Paulo')::date + time '22:00') at time zone 'America/Sao_Paulo',
            ((now() at time zone 'America/Sao_Paulo')::date + time '22:30') at time zone 'America/Sao_Paulo',
            'agendado', 'Retorno'
       from professionals p where p.id = $2
     returning id`,
    [contactId, proId],
  );
  return { appointmentId: id!, contactId };
}
