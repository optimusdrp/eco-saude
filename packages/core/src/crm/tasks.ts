/**
 * TAREFA RÁPIDA: entende datas e responsável escritos no próprio texto.
 *
 *   "Ligar para Ana amanhã @paula"   -> título "Ligar para Ana", amanhã, responsável Paula
 *   "Conferir convênio sexta"        -> próxima sexta-feira
 *   "Enviar exame 20/10"             -> 20/10 (este ano; se já passou, o próximo)
 *   "Revisar orçamento em 3 dias"    -> hoje + 3
 *   "Retornar ligação semana que vem"-> hoje + 7
 *
 * Funções puras (sem banco, sem tela), com testes em crm.test.ts.
 */
import { addDaysIso } from "./time";

export interface QuickTask {
  title: string;
  /** AAAA-MM-DD (null = não falou a data: vale o padrão da tela, hoje) */
  dueDate: string | null;
  /** Trecho que virou data (para mostrar "entendi: amanhã") */
  dateText: string | null;
  /** id do responsável encontrado pelo @nome */
  assigneeId: string | null;
  assigneeName: string | null;
}

const WEEKDAYS: [RegExp, number][] = [
  [/^domingo$/, 0],
  [/^segunda(-feira)?$/, 1],
  [/^terca(-feira)?$/, 2],
  [/^quarta(-feira)?$/, 3],
  [/^quinta(-feira)?$/, 4],
  [/^sexta(-feira)?$/, 5],
  [/^sabado$/, 6],
];

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Dia da semana (0 = domingo) de uma data AAAA-MM-DD */
function weekdayOf(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Lê o texto. `today` é a data de hoje no fuso da clínica (AAAA-MM-DD);
 * `team` é a lista de pessoas para o @nome (casa pelo começo do primeiro nome, sem acento).
 */
export function parseQuickTask(input: string, today: string, team: { id: string; name: string }[] = []): QuickTask {
  let text = ` ${input.trim()} `;
  let dueDate: string | null = null;
  let dateText: string | null = null;

  // Cada regra: expressão (sobre o texto sem acento) e como calcular a data.
  // A busca é feita no texto "plano", mas o recorte é no original (mesmo tamanho).
  const rules: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/\s(depois de amanha)\s/, () => addDaysIso(today, 2)],
    [/\s(amanha)\s/, () => addDaysIso(today, 1)],
    [/\s(hoje)\s/, () => today],
    [/\s(semana que vem|proxima semana)\s/, () => addDaysIso(today, 7)],
    [/\s(em (\d{1,3}) dias?)\s/, (m) => addDaysIso(today, Number(m[2]))],
    [
      /\s((?:dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)\s/,
      (m) => {
        const d = Number(m[2]);
        const mo = Number(m[3]);
        if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
        let y = m[4] ? Number(m[4].length === 2 ? `20${m[4]}` : m[4]) : Number(today.slice(0, 4));
        let iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        // Sem ano e a data já passou: é a do ano que vem
        if (!m[4] && iso < today) {
          y += 1;
          iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
        return iso;
      },
    ],
    [
      /\s((?:na |no |nesta |neste |proxima |proximo )?(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado))\s/,
      (m) => {
        const target = WEEKDAYS.find(([re]) => re.test(m[2]!))?.[1];
        if (target === undefined) return null;
        // Sempre a PRÓXIMA ocorrência (se hoje é sexta, "sexta" = daqui a 7 dias)
        const diff = (target - weekdayOf(today) + 7) % 7 || 7;
        return addDaysIso(today, diff);
      },
    ],
  ];

  for (const [re, calc] of rules) {
    const m = plain(text).match(re);
    if (!m || m.index === undefined) continue;
    const date = calc(m);
    if (!date) continue;
    const start = m.index + 1;
    const end = start + m[1]!.length;
    dateText = text.slice(start, end);
    dueDate = date;
    text = `${text.slice(0, start)}${text.slice(end)}`;
    break;
  }

  // @responsável
  let assigneeId: string | null = null;
  let assigneeName: string | null = null;
  const at = text.match(/(^|\s)@([\p{L}.-]+)/u);
  if (at && at.index !== undefined) {
    const handle = plain(at[2]!);
    const who = team.find((u) => plain(u.name.split(" ")[0] ?? "").startsWith(handle)) ?? team.find((u) => plain(u.name).includes(handle));
    if (who) {
      assigneeId = who.id;
      assigneeName = who.name;
      text = `${text.slice(0, at.index)} ${text.slice(at.index + at[0].length)}`;
    }
  }

  const title = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim()
    .replace(/[,;:\-]+$/, "")
    .trim();
  return { title, dueDate, dateText: dateText?.trim() ?? null, assigneeId, assigneeName };
}
