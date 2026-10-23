/**
 * ÁREAS, ESPECIALIDADES E FORMULÁRIOS PRONTOS DO PRONTUÁRIO
 *
 * Como funciona, em linguagem simples:
 *  1. A clínica escolhe as ÁREAS em que atende (Ajustes > Prontuário): medicina, odontologia,
 *     psicologia, fisioterapia...
 *  2. Cada PROFISSIONAL tem uma especialidade (texto livre no cadastro). O Tropi reconhece a
 *     especialidade pelo nome e por apelidos comuns ("dermato", "dentista", "psicóloga").
 *  3. Cada especialidade traz formulários prontos: PRIMEIRA CONSULTA (anamnese completa) e
 *     RETORNO (evolução). Algumas têm um terceiro (ex.: pré-natal, curativo).
 *  4. Ao atender, o Tropi escolhe o formulário: o que a gestão definiu para aquele profissional;
 *     senão o da especialidade dele (primeira consulta ou retorno); senão o geral da área.
 *  5. Cada ÁREA também define o que aparece no atendimento: sinais vitais e quais documentos
 *     a profissão pode emitir (psicólogo não emite receita de medicamento, por exemplo).
 *
 * IMPORTANTE (revisão profissional): os formulários seguem roteiros clínicos usuais e as
 * resoluções dos conselhos sobre registro (CFM 1.638/2002, CFO 118/2012, CFP 01/2009,
 * COFFITO 414/2012, CFN 594/2017, COFEN 358/2009). Os documentos permitidos por área são uma
 * regra conservadora: confirme com o responsável técnico de cada área antes de liberar.
 * A clínica pode editar qualquer formulário em Ajustes > Prontuário > Modelos.
 */
import type { DocumentKind, TemplateField } from "./index";

/* ---------------------------------- Áreas ---------------------------------- */

export const CLINIC_AREAS = ["medicina", "odontologia", "psicologia", "fisioterapia", "terapia_ocupacional", "nutricao", "fonoaudiologia", "enfermagem", "estetica"] as const;
export type ClinicArea = (typeof CLINIC_AREAS)[number];

export const AREA_LABEL: Record<ClinicArea, string> = {
  medicina: "Medicina",
  odontologia: "Odontologia",
  psicologia: "Psicologia",
  fisioterapia: "Fisioterapia",
  terapia_ocupacional: "Terapia ocupacional",
  nutricao: "Nutrição",
  fonoaudiologia: "Fonoaudiologia",
  enfermagem: "Enfermagem",
  estetica: "Estética e biomedicina estética",
};

/** Conselho profissional -> área (usado quando a especialidade não é reconhecida) */
const COUNCIL_AREA: Record<string, ClinicArea> = {
  CRM: "medicina",
  CRO: "odontologia",
  CRP: "psicologia",
  CREFITO: "fisioterapia",
  CRN: "nutricao",
  CRFA: "fonoaudiologia",
  COREN: "enfermagem",
  CRBM: "estetica",
};

export interface AreaRules {
  /** Mostra o bloco de sinais vitais no atendimento */
  vitals: boolean;
  /** Documentos que a profissão emite pelo Tropi */
  documents: readonly DocumentKind[];
  /** Nome do bloco de diagnóstico (CID-10) */
  diagnosisLabel: string;
}

/**
 * O que cada área mostra e emite. Receita de medicamento: só medicina e odontologia
 * (prescrição é ato privativo). Atestado: profissões com norma do conselho que o permite.
 */
export const AREA_RULES: Record<ClinicArea, AreaRules> = {
  medicina: { vitals: true, documents: ["receita", "receita_especial", "atestado", "declaracao", "pedido_exames", "encaminhamento"], diagnosisLabel: "Diagnóstico (CID-10)" },
  odontologia: { vitals: true, documents: ["receita", "receita_especial", "atestado", "declaracao", "pedido_exames", "encaminhamento"], diagnosisLabel: "Diagnóstico (CID-10)" },
  psicologia: { vitals: false, documents: ["atestado", "declaracao", "encaminhamento"], diagnosisLabel: "Hipótese diagnóstica (CID-10, opcional)" },
  fisioterapia: { vitals: true, documents: ["atestado", "declaracao", "encaminhamento"], diagnosisLabel: "CID-10 do encaminhamento (opcional)" },
  terapia_ocupacional: { vitals: false, documents: ["atestado", "declaracao", "encaminhamento"], diagnosisLabel: "CID-10 do encaminhamento (opcional)" },
  nutricao: { vitals: true, documents: ["declaracao", "pedido_exames", "encaminhamento"], diagnosisLabel: "CID-10 relacionado (opcional)" },
  fonoaudiologia: { vitals: false, documents: ["declaracao", "encaminhamento"], diagnosisLabel: "CID-10 relacionado (opcional)" },
  enfermagem: { vitals: true, documents: ["declaracao", "encaminhamento"], diagnosisLabel: "CID-10 relacionado (opcional)" },
  estetica: { vitals: false, documents: ["declaracao", "encaminhamento"], diagnosisLabel: "CID-10 relacionado (opcional)" },
};

/* ------------------------- Atalhos para montar campos ------------------------- */

const titulo = (id: string, label: string): TemplateField => ({ id, label, type: "titulo" });
const curto = (id: string, label: string, extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "texto", ...extra });
const longo = (id: string, label: string, extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "texto_longo", ...extra });
const num = (id: string, label: string, unit?: string, extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "numero", ...(unit ? { unit } : {}), ...extra });
const escolha = (id: string, label: string, options: string[], extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "escolha", options, ...extra });
const varias = (id: string, label: string, options: string[], extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "multipla", options, ...extra });
const escala = (id: string, label: string, extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "escala", ...extra });
const simNao = (id: string, label: string, extra: Partial<TemplateField> = {}): TemplateField => ({ id, label, type: "sim_nao", ...extra });
const obrig = { required: true } as const;

/* ---------------------- Blocos comuns (medicina) ---------------------- */

/** Anamnese médica: começo (queixa e história) */
const medInicio = [curto("queixa", "Queixa principal", obrig), longo("hda", "História da doença atual", { ...obrig, hint: "Início, duração, intensidade, fatores de melhora e piora" })];

/** Anamnese médica: antecedentes e hábitos */
const medAntecedentes = [
  titulo("sec_antecedentes", "Antecedentes"),
  longo("antecedentes_pessoais", "Antecedentes pessoais", { hint: "Doenças prévias, cirurgias, internações" }),
  longo("antecedentes_familiares", "Antecedentes familiares"),
  varias("habitos", "Hábitos", ["Tabagismo", "Ex-tabagista", "Álcool", "Outras substâncias", "Atividade física regular", "Sedentarismo"]),
  longo("revisao_sistemas", "Revisão de sistemas"),
];

/** Exame físico geral */
const medExame = (extra: TemplateField[] = []) => [titulo("sec_exame", "Exame físico"), escolha("estado_geral", "Estado geral", ["Bom", "Regular", "Ruim"]), ...extra, longo("exame_fisico", "Exame físico (outros achados)")];

/** Primeira consulta médica: base + perguntas da especialidade + exame da especialidade */
const medPrimeira = (especifico: TemplateField[], exame: TemplateField[] = []) => [...medInicio, ...especifico, ...medAntecedentes, ...medExame(exame)];

/** Retorno médico: evolução, adesão, exames + perguntas da especialidade */
const medRetorno = (especifico: TemplateField[] = [], exame: TemplateField[] = []) => [
  longo("evolucao", "Evolução desde a última consulta", obrig),
  escolha("adesao", "Seguiu o tratamento?", ["Sim", "Em parte", "Não"]),
  longo("efeitos_adversos", "Efeitos colaterais ou intercorrências"),
  ...especifico,
  longo("exames_trazidos", "Exames trazidos (resultados)"),
  titulo("sec_exame", "Exame físico"),
  ...exame,
  longo("exame_fisico", "Exame físico"),
];

/* ------------------------------ Especialidades ------------------------------ */

export type TemplateKind = "primeira" | "retorno" | "outro";

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = { primeira: "Primeira consulta", retorno: "Retorno", outro: "Outro" };

export interface SpecialtyTemplate {
  kind: TemplateKind;
  /** Para kind "outro": sufixo da chave (ex.: "prenatal") */
  slug?: string;
  name: string;
  fields: TemplateField[];
}

export interface Specialty {
  key: string;
  label: string;
  area: ClinicArea;
  /** Formulário geral da área (usado quando a especialidade do profissional não é reconhecida) */
  general?: boolean;
  /** Outros nomes (sem acento, minúsculas): reconhecem o texto livre do cadastro */
  aliases: string[];
  templates: SpecialtyTemplate[];
}

const par = (primeira: TemplateField[], retorno: TemplateField[], extras: SpecialtyTemplate[] = []): SpecialtyTemplate[] => [
  { kind: "primeira", name: "Primeira consulta", fields: primeira },
  { kind: "retorno", name: "Retorno / evolução", fields: retorno },
  ...extras,
];

const DOR = escala("dor", "Dor (0 = sem dor, 10 = pior dor)");

export const SPECIALTIES: Specialty[] = [
  /* ================================ Medicina ================================ */
  {
    key: "clinica_geral",
    label: "Clínica médica geral",
    area: "medicina",
    general: true,
    aliases: ["clinica geral", "clinico geral", "clinica medica", "medicina geral", "medicina de familia", "medicina de familia e comunidade", "mfc", "generalista", "clinica"],
    templates: par(medPrimeira([]), medRetorno()),
  },
  {
    key: "pediatria",
    label: "Pediatria",
    area: "medicina",
    aliases: ["pediatra", "pediatria", "puericultura"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_gestacao", "Gestação e nascimento"),
          num("idade_gestacional", "Idade gestacional ao nascer", "semanas"),
          escolha("tipo_parto", "Tipo de parto", ["Normal", "Cesárea", "Fórceps"]),
          num("peso_nascer", "Peso ao nascer", "g"),
          curto("apgar", "Apgar (1º e 5º minuto)"),
          longo("intercorrencias_neonatais", "Intercorrências neonatais"),
          titulo("sec_crescimento", "Crescimento e desenvolvimento"),
          escolha("aleitamento", "Aleitamento", ["Materno exclusivo", "Misto", "Fórmula", "Já desmamado"]),
          longo("alimentacao", "Alimentação atual"),
          longo("dnpm", "Desenvolvimento neuropsicomotor", { hint: "Marcos: sustento cefálico, sentar, andar, falar" }),
          escolha("vacinas", "Vacinação", ["Em dia (carteira conferida)", "Atrasada", "Não trouxe a carteira"]),
          longo("sono_escola", "Sono, escola e rotina"),
        ],
        [num("perimetro_cefalico", "Perímetro cefálico", "cm")],
      ),
      medRetorno(
        [escolha("vacinas", "Vacinação", ["Em dia (carteira conferida)", "Atrasada", "Não trouxe a carteira"]), longo("crescimento", "Crescimento e ganho de peso"), longo("alimentacao", "Alimentação")],
        [num("perimetro_cefalico", "Perímetro cefálico", "cm")],
      ),
    ),
  },
  {
    key: "ginecologia_obstetricia",
    label: "Ginecologia e obstetrícia",
    area: "medicina",
    aliases: ["ginecologia", "obstetricia", "ginecologista", "obstetra", "ginecologia e obstetricia", "go", "gineco"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_gineco", "História ginecológica e obstétrica"),
          curto("dum", "Data da última menstruação (DUM)"),
          escolha("ciclo", "Ciclo menstrual", ["Regular", "Irregular", "Amenorreia", "Menopausa"]),
          num("gestacoes", "Gestações (G)"),
          num("partos", "Partos (P)"),
          num("abortos", "Abortos (A)"),
          escolha("contracepcao", "Método contraceptivo", ["Nenhum", "Pílula", "DIU de cobre", "DIU hormonal", "Implante", "Injetável", "Preservativo", "Laqueadura / vasectomia do parceiro", "Outro"]),
          curto("ultimo_preventivo", "Último preventivo (citopatológico) e resultado"),
          curto("ultima_mamografia", "Última mamografia e resultado"),
        ],
        [longo("exame_mamas", "Exame das mamas"), longo("exame_especular", "Exame especular"), longo("toque_vaginal", "Toque vaginal")],
      ),
      medRetorno([curto("dum", "Data da última menstruação (DUM)")], [longo("exame_ginecologico", "Exame ginecológico")]),
      [
        {
          kind: "outro",
          slug: "prenatal",
          name: "Consulta de pré-natal",
          fields: [
            num("idade_gestacional", "Idade gestacional", "semanas", obrig),
            curto("dpp", "Data provável do parto (DPP)"),
            longo("queixas", "Queixas"),
            num("altura_uterina", "Altura uterina", "cm"),
            num("bcf", "Batimentos cardíacos fetais (BCF)", "bpm"),
            escolha("movimentos_fetais", "Movimentos fetais", ["Presentes", "Diminuídos", "Ausentes", "Ainda não percebidos"]),
            escolha("edema", "Edema", ["Ausente", "+", "++", "+++"]),
            longo("exames_prenatal", "Exames do pré-natal (resultados)"),
            escolha("risco_gestacional", "Risco gestacional", ["Habitual", "Alto risco"]),
            longo("orientacoes", "Orientações dadas"),
          ],
        },
      ],
    ),
  },
  {
    key: "cardiologia",
    label: "Cardiologia",
    area: "medicina",
    aliases: ["cardiologista", "cardiologia", "cardio"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_cardio", "Sintomas cardiovasculares"),
          simNao("dor_toracica", "Dor torácica"),
          escolha("dispneia_nyha", "Dispneia (classe funcional NYHA)", ["Sem dispneia", "I", "II", "III", "IV"]),
          varias("sintomas_cardio", "Outros sintomas", ["Palpitações", "Síncope ou pré-síncope", "Edema de membros inferiores", "Ortopneia", "Dispneia paroxística noturna", "Claudicação"]),
          varias("fatores_risco", "Fatores de risco", ["Hipertensão", "Diabetes", "Dislipidemia", "Tabagismo", "Obesidade", "Sedentarismo", "História familiar de doença coronariana precoce"]),
        ],
        [longo("ausculta_cardiaca", "Ausculta cardíaca"), longo("pulsos", "Pulsos periféricos"), longo("ecg", "ECG (laudo)")],
      ),
      medRetorno([escolha("dispneia_nyha", "Dispneia (classe funcional NYHA)", ["Sem dispneia", "I", "II", "III", "IV"]), longo("controle_pressorico", "Controle da pressão em casa (medidas trazidas)")], [longo("ausculta_cardiaca", "Ausculta cardíaca")]),
    ),
  },
  {
    key: "dermatologia",
    label: "Dermatologia",
    area: "medicina",
    aliases: ["dermatologista", "dermatologia", "dermato"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_lesao", "Lesão ou queixa de pele"),
          curto("localizacao", "Localização"),
          curto("tempo_evolucao", "Tempo de evolução"),
          varias("sintomas_pele", "Sintomas", ["Prurido", "Dor", "Ardor", "Sangramento", "Crescimento recente", "Descamação", "Secreção"]),
          escolha("fototipo", "Fototipo (Fitzpatrick)", ["I", "II", "III", "IV", "V", "VI"]),
          escolha("protetor", "Uso de protetor solar", ["Diário", "Às vezes", "Não usa"]),
          longo("tratamentos_previos", "Tratamentos já feitos"),
        ],
        [
          longo("exame_dermatologico", "Exame dermatológico", { ...obrig, hint: "Tipo de lesão, cor, forma, bordas, distribuição" }),
          varias("abcde", "Lesão pigmentada: critérios ABCDE", ["Assimetria", "Bordas irregulares", "Cores variadas", "Diâmetro maior que 6 mm", "Evolução (mudou)"]),
          longo("dermatoscopia", "Dermatoscopia"),
        ],
      ),
      medRetorno([escolha("resposta", "Resposta ao tratamento", ["Melhora completa", "Melhora parcial", "Sem mudança", "Piora"])], [longo("exame_dermatologico", "Exame dermatológico")]),
    ),
  },
  {
    key: "ortopedia",
    label: "Ortopedia e traumatologia",
    area: "medicina",
    aliases: ["ortopedia", "ortopedista", "traumatologia", "ortopedia e traumatologia", "orto"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_queixa_orto", "Queixa musculoesquelética"),
          varias("regiao", "Região", ["Coluna cervical", "Coluna torácica", "Coluna lombar", "Ombro", "Cotovelo", "Punho e mão", "Quadril", "Joelho", "Tornozelo e pé"]),
          escolha("lado", "Lado", ["Direito", "Esquerdo", "Bilateral", "Não se aplica"]),
          longo("mecanismo", "Mecanismo do trauma ou início dos sintomas"),
          DOR,
          simNao("irradiacao", "Dor irradia?"),
          longo("limitacao", "Limitação funcional (trabalho, esporte, dia a dia)"),
        ],
        [longo("inspecao_palpacao", "Inspeção e palpação"), longo("adm", "Amplitude de movimento"), longo("testes_especiais", "Testes especiais"), longo("neurovascular", "Exame neurovascular"), longo("imagem", "Exames de imagem (laudo)")],
      ),
      medRetorno([DOR, longo("funcao", "Evolução funcional"), simNao("fisioterapia", "Está fazendo fisioterapia?")], [longo("adm", "Amplitude de movimento")]),
    ),
  },
  {
    key: "neurologia",
    label: "Neurologia",
    area: "medicina",
    aliases: ["neurologista", "neurologia", "neuro"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_neuro", "Sintomas neurológicos"),
          varias("sintomas_neuro", "Sintomas", ["Cefaleia", "Tontura ou vertigem", "Crises convulsivas", "Perda de força", "Formigamento", "Alteração de memória", "Tremor", "Alteração da fala", "Alteração visual"]),
          longo("cefaleia", "Se cefaleia: localização, frequência, duração, gatilhos e aura"),
          longo("crises", "Se crises: descrição, frequência e última crise"),
        ],
        [
          escolha("consciencia", "Nível de consciência", ["Alerta e orientado", "Sonolento", "Confuso", "Torporoso"]),
          longo("pares_cranianos", "Pares cranianos"),
          longo("forca_reflexos", "Força e reflexos"),
          longo("sensibilidade_coordenacao", "Sensibilidade e coordenação"),
          longo("marcha", "Marcha e equilíbrio"),
        ],
      ),
      medRetorno([longo("crises", "Crises ou dores desde a última consulta (frequência)")], [longo("exame_neurologico", "Exame neurológico")]),
    ),
  },
  {
    key: "psiquiatria",
    label: "Psiquiatria",
    area: "medicina",
    aliases: ["psiquiatra", "psiquiatria"],
    templates: par(
      [
        curto("queixa", "Queixa principal", obrig),
        longo("hda", "História da doença atual", obrig),
        longo("historia_psiquiatrica", "História psiquiátrica (tratamentos, internações, medicações anteriores)"),
        longo("substancias", "Uso de álcool e outras substâncias"),
        longo("antecedentes_familiares", "Antecedentes familiares psiquiátricos"),
        longo("historia_social", "História pessoal e social (trabalho, família, rede de apoio)"),
        titulo("sec_mental", "Exame do estado mental"),
        longo("aparencia_comportamento", "Aparência e comportamento"),
        escolha("humor", "Humor", ["Eutímico", "Deprimido", "Ansioso", "Irritável", "Expansivo"]),
        longo("pensamento", "Pensamento (curso, forma e conteúdo)"),
        longo("sensopercepcao", "Sensopercepção"),
        escolha("critica", "Juízo e crítica", ["Preservados", "Parcialmente comprometidos", "Comprometidos"]),
        escolha("risco", "Avaliação de risco (auto ou heteroagressão)", ["Sem indícios", "Baixo", "Moderado", "Alto"], obrig),
        longo("risco_conduta", "Se há risco: plano de segurança combinado"),
      ],
      [
        longo("evolucao", "Evolução desde a última consulta", obrig),
        escolha("adesao", "Adesão à medicação", ["Sim", "Em parte", "Não"]),
        longo("efeitos_adversos", "Efeitos colaterais"),
        escala("humor_relatado", "Humor relatado (0 = muito mal, 10 = muito bem)"),
        longo("sono_apetite", "Sono e apetite"),
        longo("estado_mental", "Exame do estado mental"),
        escolha("risco", "Avaliação de risco (auto ou heteroagressão)", ["Sem indícios", "Baixo", "Moderado", "Alto"], obrig),
      ],
    ),
  },
  {
    key: "endocrinologia",
    label: "Endocrinologia",
    area: "medicina",
    aliases: ["endocrinologista", "endocrinologia", "endocrino", "endocrinologia e metabologia"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_endo", "História endócrina"),
          varias("condicoes", "Condições", ["Diabetes tipo 1", "Diabetes tipo 2", "Pré-diabetes", "Hipotireoidismo", "Hipertireoidismo", "Nódulo de tireoide", "Obesidade", "Dislipidemia", "Osteoporose", "SOP"]),
          num("hba1c", "Hemoglobina glicada (HbA1c)", "%"),
          longo("glicemias", "Glicemias trazidas (jejum e pós-prandial)"),
          longo("historico_peso", "Histórico de peso"),
        ],
        [num("circ_abdominal", "Circunferência abdominal", "cm"), longo("tireoide", "Palpação da tireoide"), simNao("acantose", "Acantose nigricans"), longo("pes", "Exame dos pés (diabetes)")],
      ),
      medRetorno([num("hba1c", "Hemoglobina glicada (HbA1c)", "%"), longo("glicemias", "Glicemias trazidas"), simNao("hipoglicemias", "Teve hipoglicemias?")], [num("circ_abdominal", "Circunferência abdominal", "cm")]),
    ),
  },
  {
    key: "oftalmologia",
    label: "Oftalmologia",
    area: "medicina",
    aliases: ["oftalmologista", "oftalmologia", "oftalmo", "oculista"],
    templates: par(
      [
        curto("queixa", "Queixa principal", obrig),
        longo("hda", "História da doença atual"),
        varias("sintomas_olho", "Sintomas", ["Baixa visão para longe", "Baixa visão para perto", "Dor", "Vermelhidão", "Coceira", "Lacrimejamento", "Moscas volantes", "Flashes"]),
        simNao("usa_oculos", "Usa óculos ou lentes?"),
        longo("antecedentes", "Antecedentes (diabetes, hipertensão, glaucoma na família, cirurgias oculares)"),
        titulo("sec_exame_olho", "Exame oftalmológico"),
        curto("av_od", "Acuidade visual OD (sem / com correção)"),
        curto("av_oe", "Acuidade visual OE (sem / com correção)"),
        longo("refracao", "Refração"),
        longo("biomicroscopia", "Biomicroscopia"),
        num("pio_od", "Pressão intraocular OD", "mmHg"),
        num("pio_oe", "Pressão intraocular OE", "mmHg"),
        longo("fundoscopia", "Fundoscopia"),
      ],
      [
        longo("evolucao", "Evolução", obrig),
        curto("av_od", "Acuidade visual OD"),
        curto("av_oe", "Acuidade visual OE"),
        num("pio_od", "Pressão intraocular OD", "mmHg"),
        num("pio_oe", "Pressão intraocular OE", "mmHg"),
        longo("exame", "Exame oftalmológico"),
      ],
    ),
  },
  {
    key: "otorrinolaringologia",
    label: "Otorrinolaringologia",
    area: "medicina",
    aliases: ["otorrino", "otorrinolaringologista", "otorrinolaringologia"],
    templates: par(
      medPrimeira(
        [varias("sintomas_orl", "Sintomas", ["Dor de ouvido", "Perda auditiva", "Zumbido", "Vertigem", "Obstrução nasal", "Coriza", "Sangramento nasal", "Ronco", "Dor de garganta", "Rouquidão"])],
        [longo("otoscopia", "Otoscopia"), longo("rinoscopia", "Rinoscopia"), longo("oroscopia", "Oroscopia"), longo("pescoco", "Pescoço")],
      ),
      medRetorno([], [longo("otoscopia", "Otoscopia"), longo("rinoscopia", "Rinoscopia"), longo("oroscopia", "Oroscopia")]),
    ),
  },
  {
    key: "urologia",
    label: "Urologia",
    area: "medicina",
    aliases: ["urologista", "urologia", "uro"],
    templates: par(
      medPrimeira(
        [
          varias("sintomas_urinarios", "Sintomas urinários", ["Jato fraco", "Esforço para urinar", "Urgência", "Aumento da frequência", "Noctúria", "Incontinência", "Ardência", "Sangue na urina"]),
          num("ipss", "Escore de sintomas prostáticos (IPSS, 0 a 35)"),
          curto("psa", "Último PSA e data"),
        ],
        [longo("exame_genital", "Exame da genitália"), longo("toque_retal", "Toque retal (se indicado)")],
      ),
      medRetorno([num("ipss", "Escore de sintomas prostáticos (IPSS, 0 a 35)"), curto("psa", "Último PSA e data")]),
    ),
  },
  {
    key: "gastroenterologia",
    label: "Gastroenterologia",
    area: "medicina",
    aliases: ["gastroenterologista", "gastroenterologia", "gastro"],
    templates: par(
      medPrimeira(
        [
          varias("sintomas_gi", "Sintomas", ["Dor abdominal", "Azia", "Náusea ou vômito", "Diarreia", "Constipação", "Sangramento", "Perda de peso", "Disfagia", "Distensão"]),
          longo("habito_intestinal", "Hábito intestinal (frequência e aspecto)"),
          curto("endoscopias", "Endoscopias ou colonoscopias anteriores"),
        ],
        [longo("exame_abdominal", "Exame do abdome")],
      ),
      medRetorno([longo("habito_intestinal", "Hábito intestinal")], [longo("exame_abdominal", "Exame do abdome")]),
    ),
  },
  {
    key: "pneumologia",
    label: "Pneumologia",
    area: "medicina",
    aliases: ["pneumologista", "pneumologia", "pneumo"],
    templates: par(
      medPrimeira(
        [
          varias("sintomas_resp", "Sintomas", ["Tosse", "Catarro", "Chiado", "Falta de ar", "Dor torácica", "Hemoptise", "Ronco e apneia"]),
          escolha("mmrc", "Falta de ar (escala mMRC)", ["0", "1", "2", "3", "4"]),
          num("macos_ano", "Carga tabágica", "maços-ano"),
          longo("espirometria", "Espirometria (resultado)"),
        ],
        [longo("ausculta_pulmonar", "Ausculta pulmonar")],
      ),
      medRetorno([escolha("mmrc", "Falta de ar (escala mMRC)", ["0", "1", "2", "3", "4"]), num("crises", "Crises desde a última consulta")], [longo("ausculta_pulmonar", "Ausculta pulmonar")]),
    ),
  },
  {
    key: "geriatria",
    label: "Geriatria",
    area: "medicina",
    aliases: ["geriatra", "geriatria", "gerontologia"],
    templates: par(
      medPrimeira(
        [
          titulo("sec_ampla", "Avaliação geriátrica ampla"),
          escolha("avd", "Atividades básicas (banho, vestir, comer)", ["Independente", "Ajuda parcial", "Dependente"]),
          escolha("aivd", "Atividades instrumentais (remédios, dinheiro, compras)", ["Independente", "Ajuda parcial", "Dependente"]),
          num("quedas", "Quedas nos últimos 12 meses"),
          num("meem", "Mini exame do estado mental (0 a 30)"),
          num("gds", "Escala de depressão geriátrica (GDS-15)"),
          simNao("incontinencia", "Incontinência urinária"),
          num("n_medicamentos", "Quantos medicamentos usa"),
          longo("cuidador", "Cuidador e rede de apoio"),
        ],
        [longo("marcha_equilibrio", "Marcha e equilíbrio (ex.: levantar e andar cronometrado)")],
      ),
      medRetorno([num("quedas", "Quedas desde a última consulta"), escolha("avd", "Atividades básicas", ["Independente", "Ajuda parcial", "Dependente"])]),
    ),
  },
  {
    key: "reumatologia",
    label: "Reumatologia",
    area: "medicina",
    aliases: ["reumatologista", "reumatologia", "reumato"],
    templates: par(
      medPrimeira(
        [longo("articulacoes", "Articulações acometidas"), num("rigidez_matinal", "Rigidez matinal", "minutos"), varias("sistemicos", "Sintomas sistêmicos", ["Febre", "Perda de peso", "Fadiga", "Lesões de pele", "Olhos secos", "Boca seca", "Raynaud"]), DOR],
        [longo("exame_articular", "Exame articular (dolorosas e edemaciadas)")],
      ),
      medRetorno([DOR, num("rigidez_matinal", "Rigidez matinal", "minutos")], [longo("exame_articular", "Exame articular")]),
    ),
  },

  /* =============================== Odontologia =============================== */
  {
    key: "odonto_geral",
    label: "Clínica geral odontológica",
    area: "odontologia",
    general: true,
    aliases: ["odontologia", "dentista", "cirurgiao dentista", "cirurgia dentista", "clinica geral odontologica", "odontologo", "odontologa", "clinico geral odontologico", "dentistica", "protese dentaria", "protesista"],
    templates: par(
      [
        curto("queixa", "Queixa principal", obrig),
        longo("historia", "História da queixa"),
        titulo("sec_saude", "Saúde geral"),
        varias("condicoes", "Condições de atenção", ["Hipertensão", "Diabetes", "Cardiopatia", "Usa anticoagulante", "Problema de coagulação", "Gestante", "Alergia a anestésico", "Usa bifosfonato", "Hepatite ou HIV", "Radioterapia de cabeça e pescoço"]),
        simNao("sangramento_previo", "Sangrou muito em extração anterior?"),
        longo("reacao_anestesia", "Reações em anestesias anteriores"),
        titulo("sec_habitos", "Higiene e hábitos"),
        num("escovacao", "Escovações por dia"),
        simNao("fio_dental", "Usa fio dental?"),
        varias("habitos", "Hábitos", ["Bruxismo / ranger os dentes", "Roer unhas", "Tabagismo", "Respirador bucal", "Consumo frequente de açúcar"]),
        titulo("sec_exame", "Exame clínico"),
        longo("extraoral", "Exame extraoral (face, ATM, linfonodos)"),
        longo("intraoral", "Exame intraoral (mucosas, língua, palato)"),
        longo("odontograma", "Odontograma: dentes e situação", { ...obrig, hint: "Ex.: 16 cárie oclusal; 36 restauração MOD; 48 incluso" }),
        escolha("periodonto", "Condição periodontal", ["Saudável", "Gengivite", "Periodontite", "Não avaliado"]),
        longo("radiografias", "Radiografias (achados)"),
        titulo("sec_plano", "Plano de tratamento"),
        longo("plano_tratamento", "Plano de tratamento por etapa", obrig),
      ],
      [
        longo("procedimento", "Procedimento realizado", obrig),
        curto("dentes", "Dentes ou regiões"),
        curto("anestesia", "Anestesia (tipo e quantidade de tubetes)"),
        curto("materiais", "Materiais (marca e lote, quando aplicável)"),
        longo("intercorrencias", "Intercorrências"),
        longo("orientacoes", "Orientações pós-procedimento"),
        longo("proxima_etapa", "Próxima etapa do plano"),
      ],
    ),
  },
  {
    key: "ortodontia",
    label: "Ortodontia",
    area: "odontologia",
    aliases: ["ortodontia", "ortodontista", "ortodontia e ortopedia facial"],
    templates: par(
      [
        curto("queixa", "Queixa principal", obrig),
        escolha("angle", "Classe de Angle", ["Classe I", "Classe II divisão 1", "Classe II divisão 2", "Classe III"]),
        varias("mordida", "Mordida", ["Normal", "Aberta anterior", "Profunda", "Cruzada anterior", "Cruzada posterior"]),
        longo("apinhamento", "Apinhamento e diastemas"),
        longo("habitos", "Hábitos (sucção, respiração bucal, deglutição atípica)"),
        longo("documentacao", "Documentação (radiografias, fotos, modelos)"),
        escolha("aparelho", "Aparelho indicado", ["Fixo metálico", "Fixo estético", "Alinhadores", "Móvel", "Ortopédico", "A definir"]),
        longo("plano_tratamento", "Plano de tratamento e tempo previsto", obrig),
      ],
      [
        longo("procedimento", "Manutenção realizada", obrig),
        curto("arco", "Arco ou alinhador atual"),
        curto("elasticos", "Elásticos"),
        escolha("colaboracao", "Colaboração do paciente", ["Boa", "Regular", "Ruim"]),
        longo("orientacoes", "Orientações"),
      ],
    ),
  },
  {
    key: "endodontia",
    label: "Endodontia",
    area: "odontologia",
    aliases: ["endodontia", "endodontista", "canal", "tratamento de canal"],
    templates: par(
      [
        curto("dente", "Dente", obrig),
        longo("historia_dor", "História da dor"),
        DOR,
        varias("testes", "Testes positivos", ["Frio", "Calor", "Percussão vertical", "Percussão horizontal", "Palpação apical"]),
        escolha("diagnostico_pulpar", "Diagnóstico pulpar", ["Polpa normal", "Pulpite reversível", "Pulpite irreversível", "Necrose pulpar", "Tratamento endodôntico prévio"]),
        escolha("diagnostico_periapical", "Diagnóstico periapical", ["Normal", "Periodontite apical sintomática", "Periodontite apical assintomática", "Abscesso apical agudo", "Abscesso apical crônico"]),
        longo("radiografia", "Radiografia periapical"),
        longo("plano_tratamento", "Plano", obrig),
      ],
      [
        curto("dente", "Dente", obrig),
        escolha("etapa", "Etapa", ["Acesso e preparo", "Odontometria", "Instrumentação", "Medicação intracanal", "Obturação", "Retratamento"]),
        curto("odontometria", "Comprimento de trabalho (por canal)"),
        curto("medicacao_intracanal", "Medicação intracanal"),
        longo("procedimento", "Procedimento realizado", obrig),
        longo("intercorrencias", "Intercorrências"),
      ],
    ),
  },
  {
    key: "periodontia",
    label: "Periodontia",
    area: "odontologia",
    aliases: ["periodontia", "periodontista"],
    templates: par(
      [
        curto("queixa", "Queixa principal", obrig),
        longo("sondagem", "Profundidade de sondagem (por sítio)", obrig),
        num("sangramento_sondagem", "Sangramento à sondagem", "%"),
        num("indice_placa", "Índice de placa", "%"),
        longo("mobilidade", "Mobilidade dentária"),
        longo("furca", "Lesões de furca"),
        escolha("diagnostico", "Diagnóstico periodontal", ["Saúde periodontal", "Gengivite", "Periodontite estágio I", "Periodontite estágio II", "Periodontite estágio III", "Periodontite estágio IV"]),
        longo("plano_tratamento", "Plano de tratamento", obrig),
      ],
      [longo("procedimento", "Procedimento realizado (raspagem, cirurgia, manutenção)", obrig), num("sangramento_sondagem", "Sangramento à sondagem", "%"), num("indice_placa", "Índice de placa", "%"), longo("orientacoes", "Orientações de higiene")],
    ),
  },
  {
    key: "implantodontia",
    label: "Implantodontia",
    area: "odontologia",
    aliases: ["implantodontia", "implantodontista", "implante", "implantes"],
    templates: par(
      [
        curto("regiao", "Região do implante", obrig),
        longo("avaliacao_ossea", "Avaliação óssea (altura, espessura)"),
        longo("tomografia", "Tomografia (achados)"),
        varias("condicoes", "Condições de atenção", ["Diabetes descompensado", "Tabagismo", "Usa bifosfonato", "Radioterapia na região", "Bruxismo"]),
        longo("plano_tratamento", "Planejamento cirúrgico e protético", obrig),
      ],
      [
        escolha("etapa", "Etapa", ["Cirurgia de instalação", "Enxerto", "Reabertura", "Moldagem", "Prótese sobre implante", "Manutenção"]),
        curto("implante", "Implante (marca, diâmetro, comprimento e lote)"),
        num("torque", "Torque de inserção", "Ncm"),
        longo("procedimento", "Procedimento realizado", obrig),
        longo("intercorrencias", "Intercorrências"),
        longo("orientacoes", "Orientações pós-operatórias"),
      ],
    ),
  },
  {
    key: "odontopediatria",
    label: "Odontopediatria",
    area: "odontologia",
    aliases: ["odontopediatria", "odontopediatra", "dentista infantil"],
    templates: par(
      [
        curto("queixa", "Queixa principal (relatada pelo responsável)", obrig),
        escolha("comportamento", "Comportamento (escala de Frankl)", ["Definitivamente positivo", "Positivo", "Negativo", "Definitivamente negativo"]),
        longo("dieta", "Dieta (açúcar, mamadeira noturna)"),
        varias("habitos", "Hábitos", ["Chupeta", "Sucção digital", "Mamadeira", "Respiração bucal", "Bruxismo"]),
        simNao("fluor", "Usa creme dental com flúor?"),
        longo("odontograma", "Odontograma (decíduos e permanentes)", obrig),
        longo("plano_tratamento", "Plano de tratamento", obrig),
      ],
      [longo("procedimento", "Procedimento realizado", obrig), escolha("comportamento", "Comportamento (escala de Frankl)", ["Definitivamente positivo", "Positivo", "Negativo", "Definitivamente negativo"]), longo("orientacoes", "Orientações ao responsável")],
    ),
  },

  /* ================================ Psicologia ================================ */
  {
    key: "psicologia_clinica",
    label: "Psicologia clínica",
    area: "psicologia",
    general: true,
    aliases: ["psicologia", "psicologo", "psicologa", "psicoterapia", "psicoterapeuta", "psicologia clinica", "terapia cognitivo comportamental", "tcc", "psicanalise"],
    templates: par(
      [
        longo("demanda", "Demanda / motivo da procura", obrig),
        longo("historia", "História da queixa"),
        longo("historia_familiar", "Contexto familiar"),
        longo("social_trabalho", "Relações sociais, trabalho e estudo"),
        longo("tratamentos_anteriores", "Tratamentos psicológicos ou psiquiátricos anteriores"),
        simNao("medicacao_psiquiatrica", "Usa medicação psiquiátrica?"),
        longo("substancias", "Uso de álcool e outras substâncias"),
        longo("sono_apetite", "Sono e apetite"),
        escolha("risco", "Avaliação de risco (auto ou heteroagressão)", ["Sem indícios", "Baixo", "Moderado", "Alto"], obrig),
        longo("risco_conduta", "Se há risco: encaminhamentos e plano de segurança"),
        longo("impressoes", "Impressões iniciais e hipóteses de trabalho"),
        longo("objetivos", "Objetivos terapêuticos", obrig),
        curto("contrato", "Contrato (frequência e duração das sessões)"),
      ],
      [
        longo("temas", "Temas trabalhados na sessão", obrig),
        longo("intervencoes", "Intervenções e técnicas"),
        escala("humor_relatado", "Humor relatado (0 = muito mal, 10 = muito bem)"),
        escolha("risco", "Avaliação de risco", ["Sem indícios", "Baixo", "Moderado", "Alto"]),
        longo("combinados", "Tarefas e combinados"),
        longo("proxima_sessao", "Plano para a próxima sessão"),
      ],
    ),
  },
  {
    key: "psicologia_infantil",
    label: "Psicologia infantil",
    area: "psicologia",
    aliases: ["psicologia infantil", "psicologa infantil", "psicologo infantil", "psicoterapia infantil", "ludoterapia"],
    templates: par(
      [
        longo("demanda", "Queixa trazida pelos responsáveis", obrig),
        longo("desenvolvimento", "Gestação, parto e desenvolvimento"),
        longo("escola", "Escola (adaptação, aprendizagem, relação com colegas)"),
        longo("dinamica_familiar", "Dinâmica familiar"),
        longo("rotina", "Rotina, sono e alimentação"),
        escolha("risco", "Sinais de risco ou violação de direitos", ["Sem indícios", "Há indícios (ver conduta)"], obrig),
        longo("risco_conduta", "Se há indícios: conduta e comunicação aos órgãos de proteção"),
        longo("objetivos", "Objetivos terapêuticos", obrig),
      ],
      [longo("temas", "Temas e recursos da sessão (brincar, desenho...)", obrig), longo("observacoes", "Observações do comportamento"), longo("devolutiva", "Devolutiva aos responsáveis"), longo("proxima_sessao", "Plano para a próxima sessão")],
    ),
  },
  {
    key: "neuropsicologia",
    label: "Neuropsicologia",
    area: "psicologia",
    aliases: ["neuropsicologia", "neuropsicologo", "neuropsicologa", "avaliacao neuropsicologica"],
    templates: par(
      [
        longo("demanda", "Motivo da avaliação e quem encaminhou", obrig),
        longo("queixas_cognitivas", "Queixas cognitivas (memória, atenção, linguagem)"),
        curto("escolaridade", "Escolaridade"),
        escolha("lateralidade", "Lateralidade", ["Destro", "Canhoto", "Ambidestro"]),
        longo("historia_medica", "História médica e medicações"),
        longo("plano_avaliacao", "Plano de avaliação (instrumentos previstos)", obrig),
      ],
      [longo("instrumentos", "Instrumentos aplicados na sessão", obrig), longo("observacoes", "Observações durante a testagem"), longo("resultados", "Resultados parciais")],
    ),
  },

  /* =============================== Fisioterapia =============================== */
  {
    key: "fisio_traumato",
    label: "Fisioterapia traumato-ortopédica",
    area: "fisioterapia",
    general: true,
    aliases: ["fisioterapia", "fisioterapeuta", "fisioterapia ortopedica", "fisioterapia traumato ortopedica", "fisioterapia traumato-ortopedica", "fisio", "fisioterapia esportiva", "pilates", "rpg"],
    templates: par(
      [
        curto("diagnostico_medico", "Diagnóstico clínico / encaminhamento"),
        curto("encaminhado_por", "Encaminhado por"),
        curto("queixa", "Queixa principal", obrig),
        longo("historia", "História (início, mecanismo, tratamentos feitos)"),
        DOR,
        titulo("sec_avaliacao", "Avaliação física"),
        longo("postura", "Inspeção e postura"),
        longo("palpacao", "Palpação"),
        longo("adm", "Amplitude de movimento (goniometria)"),
        longo("forca", "Força muscular (escala de Oxford, 0 a 5)"),
        longo("testes_especiais", "Testes especiais"),
        longo("funcionalidade", "Funcionalidade (atividades limitadas)"),
        titulo("sec_plano", "Diagnóstico e plano"),
        longo("diagnostico_cinetico", "Diagnóstico cinético-funcional", obrig),
        longo("objetivos", "Objetivos (curto e longo prazo)", obrig),
        longo("plano", "Condutas e frequência", obrig),
      ],
      [DOR, longo("condutas", "Condutas realizadas na sessão", obrig), longo("resposta", "Resposta do paciente"), longo("evolucao_funcional", "Evolução funcional"), longo("orientacoes", "Exercícios e orientações para casa")],
    ),
  },
  {
    key: "fisio_neuro",
    label: "Fisioterapia neurofuncional",
    area: "fisioterapia",
    aliases: ["fisioterapia neurologica", "fisioterapia neurofuncional", "neurofuncional"],
    templates: par(
      [
        curto("diagnostico_medico", "Diagnóstico clínico", obrig),
        longo("historia", "História da doença e tempo de lesão"),
        longo("tonus", "Tônus e reflexos"),
        longo("controle_motor", "Controle motor e coordenação"),
        longo("equilibrio_marcha", "Equilíbrio e marcha"),
        longo("transferencias", "Transferências e mobilidade"),
        longo("diagnostico_cinetico", "Diagnóstico cinético-funcional", obrig),
        longo("objetivos", "Objetivos", obrig),
        longo("plano", "Condutas e frequência", obrig),
      ],
      [longo("condutas", "Condutas realizadas", obrig), longo("resposta", "Resposta do paciente"), longo("evolucao_funcional", "Evolução funcional")],
    ),
  },
  {
    key: "fisio_respiratoria",
    label: "Fisioterapia respiratória",
    area: "fisioterapia",
    aliases: ["fisioterapia respiratoria", "fisioterapia cardiorrespiratoria", "fisioterapia pulmonar"],
    templates: par(
      [
        curto("diagnostico_medico", "Diagnóstico clínico", obrig),
        escolha("padrao", "Padrão respiratório", ["Diafragmático", "Costal", "Misto", "Paradoxal"]),
        longo("ausculta", "Ausculta pulmonar"),
        escolha("tosse", "Tosse", ["Eficaz", "Ineficaz", "Ausente"]),
        escolha("mmrc", "Falta de ar (escala mMRC)", ["0", "1", "2", "3", "4"]),
        longo("teste_caminhada", "Teste de caminhada (distância e saturação)"),
        longo("diagnostico_cinetico", "Diagnóstico cinético-funcional", obrig),
        longo("plano", "Condutas e frequência", obrig),
      ],
      [longo("condutas", "Condutas realizadas", obrig), longo("ausculta", "Ausculta pulmonar após a sessão"), longo("resposta", "Resposta do paciente")],
    ),
  },
  {
    key: "fisio_pelvica",
    label: "Fisioterapia pélvica",
    area: "fisioterapia",
    aliases: ["fisioterapia pelvica", "fisioterapia uroginecologica", "fisioterapia da mulher", "uroginecologia"],
    templates: par(
      [
        curto("queixa", "Queixa principal", obrig),
        varias("sintomas", "Sintomas", ["Perda de urina ao esforço", "Urgência urinária", "Perda de fezes ou gases", "Dor pélvica", "Constipação", "Sensação de peso vaginal"]),
        num("gestacoes", "Gestações"),
        longo("diario_miccional", "Diário miccional (resumo)"),
        longo("avaliacao_assoalho", "Avaliação do assoalho pélvico (força e resistência)"),
        longo("diagnostico_cinetico", "Diagnóstico cinético-funcional", obrig),
        longo("plano", "Condutas e frequência", obrig),
      ],
      [longo("condutas", "Condutas realizadas", obrig), longo("evolucao_sintomas", "Evolução dos sintomas"), longo("orientacoes", "Exercícios para casa")],
    ),
  },

  /* ============================ Terapia ocupacional ============================ */
  {
    key: "to_geral",
    label: "Terapia ocupacional",
    area: "terapia_ocupacional",
    general: true,
    aliases: ["terapia ocupacional", "terapeuta ocupacional", "integracao sensorial"],
    templates: par(
      [
        longo("demanda", "Demanda e quem encaminhou", obrig),
        curto("diagnostico_medico", "Diagnóstico clínico"),
        escolha("avd", "Atividades de vida diária", ["Independente", "Ajuda parcial", "Dependente"]),
        escolha("aivd", "Atividades instrumentais", ["Independente", "Ajuda parcial", "Dependente"]),
        longo("contextos", "Contextos (casa, escola, trabalho, lazer)"),
        longo("sensorial_motor", "Avaliação sensorial e motora"),
        longo("cognicao", "Cognição e comportamento"),
        longo("diagnostico_ocupacional", "Diagnóstico terapêutico ocupacional", obrig),
        longo("objetivos", "Objetivos", obrig),
        longo("plano", "Plano e frequência", obrig),
      ],
      [longo("atividades", "Atividades realizadas", obrig), longo("resposta", "Resposta e desempenho"), longo("orientacoes", "Orientações à família ou cuidador")],
    ),
  },

  /* ================================= Nutrição ================================= */
  {
    key: "nutri_clinica",
    label: "Nutrição clínica",
    area: "nutricao",
    general: true,
    aliases: ["nutricao", "nutricionista", "nutricao clinica", "nutrologia nutricional"],
    templates: par(
      [
        escolha("objetivo", "Objetivo principal", ["Emagrecimento", "Ganho de massa", "Controle de doença", "Gestação ou lactação", "Desempenho esportivo", "Reeducação alimentar"], obrig),
        longo("patologias", "Doenças e condições"),
        longo("medicamentos_suplementos", "Medicamentos e suplementos"),
        longo("exames", "Exames bioquímicos recentes"),
        titulo("sec_consumo", "Consumo alimentar"),
        longo("recordatorio", "Recordatório de 24 horas", obrig),
        longo("frequencia_alimentar", "Frequência alimentar (o que come na semana)"),
        num("agua", "Ingestão de água", "litros/dia"),
        longo("intolerancias", "Intolerâncias e aversões"),
        escolha("intestino", "Funcionamento intestinal", ["Normal", "Constipado", "Diarreia frequente", "Alterna"]),
        curto("atividade_fisica", "Atividade física (tipo e frequência)"),
        titulo("sec_antropometria", "Antropometria"),
        num("peso_habitual", "Peso habitual", "kg"),
        num("cintura", "Circunferência da cintura", "cm"),
        num("quadril", "Circunferência do quadril", "cm"),
        num("gordura", "Percentual de gordura", "%"),
        titulo("sec_conduta", "Diagnóstico e conduta"),
        longo("diagnostico_nutricional", "Diagnóstico nutricional", obrig),
        longo("plano_alimentar", "Plano alimentar e orientações", obrig),
        longo("metas", "Metas até o retorno"),
      ],
      [
        escolha("adesao", "Adesão ao plano", ["Boa", "Parcial", "Baixa"], obrig),
        longo("dificuldades", "Dificuldades relatadas"),
        num("cintura", "Circunferência da cintura", "cm"),
        num("gordura", "Percentual de gordura", "%"),
        longo("ajustes", "Ajustes no plano alimentar", obrig),
        longo("metas", "Metas até o próximo retorno"),
      ],
    ),
  },
  {
    key: "nutri_esportiva",
    label: "Nutrição esportiva",
    area: "nutricao",
    aliases: ["nutricao esportiva", "nutricionista esportivo", "nutricionista esportiva"],
    templates: par(
      [
        curto("modalidade", "Modalidade esportiva e nível", obrig),
        longo("rotina_treino", "Rotina de treinos (horários e volume)"),
        escolha("objetivo", "Objetivo", ["Hipertrofia", "Redução de gordura", "Desempenho", "Recuperação", "Competição"], obrig),
        longo("recordatorio", "Recordatório de 24 horas", obrig),
        longo("suplementos", "Suplementos em uso"),
        num("gordura", "Percentual de gordura", "%"),
        num("massa_magra", "Massa magra", "kg"),
        longo("plano_alimentar", "Plano alimentar (pré, intra e pós-treino)", obrig),
      ],
      [escolha("adesao", "Adesão ao plano", ["Boa", "Parcial", "Baixa"], obrig), longo("desempenho", "Desempenho nos treinos"), num("gordura", "Percentual de gordura", "%"), longo("ajustes", "Ajustes no plano", obrig)],
    ),
  },

  /* ============================== Fonoaudiologia ============================== */
  {
    key: "fono_geral",
    label: "Fonoaudiologia",
    area: "fonoaudiologia",
    general: true,
    aliases: ["fonoaudiologia", "fonoaudiologo", "fonoaudiologa", "fono"],
    templates: par(
      [
        longo("demanda", "Queixa e quem encaminhou", obrig),
        varias("areas", "Áreas da queixa", ["Linguagem", "Fala", "Voz", "Audição", "Motricidade orofacial", "Deglutição", "Fluência (gagueira)", "Leitura e escrita"]),
        longo("desenvolvimento", "Desenvolvimento (para crianças: marcos de fala)"),
        longo("avaliacao_linguagem", "Avaliação de linguagem e fala"),
        longo("avaliacao_voz", "Avaliação vocal"),
        longo("motricidade", "Motricidade orofacial e deglutição"),
        longo("audicao", "Audição (exames trazidos)"),
        longo("diagnostico_fono", "Diagnóstico fonoaudiológico", obrig),
        longo("plano", "Plano terapêutico e frequência", obrig),
      ],
      [longo("atividades", "Atividades e técnicas da sessão", obrig), longo("resposta", "Resposta do paciente"), longo("orientacoes", "Orientações para casa")],
    ),
  },

  /* ================================ Enfermagem ================================ */
  {
    key: "enfermagem",
    label: "Consulta de enfermagem",
    area: "enfermagem",
    general: true,
    aliases: ["enfermagem", "enfermeiro", "enfermeira", "consulta de enfermagem", "estomaterapia"],
    templates: [
      {
        kind: "primeira",
        name: "Consulta de enfermagem",
        fields: [
          longo("historico", "Histórico de enfermagem (queixas e necessidades)", obrig),
          longo("exame_fisico", "Exame físico"),
          longo("diagnosticos", "Diagnósticos de enfermagem", obrig),
          longo("planejamento", "Planejamento (resultados esperados)"),
          longo("intervencoes", "Intervenções realizadas", obrig),
          longo("avaliacao", "Avaliação"),
        ],
      },
      {
        kind: "retorno",
        name: "Evolução de enfermagem",
        fields: [longo("evolucao", "Evolução", obrig), longo("intervencoes", "Intervenções realizadas", obrig), longo("avaliacao", "Avaliação e próximos passos")],
      },
      {
        kind: "outro",
        slug: "curativo",
        name: "Curativo",
        fields: [
          curto("localizacao", "Localização da ferida", obrig),
          curto("dimensoes", "Dimensões (comprimento x largura x profundidade, em cm)"),
          varias("leito", "Leito da ferida", ["Granulação", "Esfacelo", "Necrose", "Epitelização"]),
          escolha("exsudato", "Exsudato", ["Ausente", "Pouco", "Moderado", "Abundante"]),
          simNao("sinais_infeccao", "Sinais de infecção"),
          longo("cobertura", "Limpeza e cobertura utilizada", obrig),
          curto("proxima_troca", "Próxima troca"),
        ],
      },
    ],
  },

  /* ============================ Estética e biomedicina ============================ */
  {
    key: "estetica",
    label: "Estética e biomedicina estética",
    area: "estetica",
    general: true,
    aliases: ["estetica", "biomedicina", "biomedicina estetica", "biomedico", "biomedica", "esteticista", "harmonizacao facial", "harmonizacao orofacial", "cosmetologia"],
    templates: par(
      [
        longo("queixa", "Queixa estética e expectativa", obrig),
        escolha("fototipo", "Fototipo (Fitzpatrick)", ["I", "II", "III", "IV", "V", "VI"]),
        longo("procedimentos_anteriores", "Procedimentos estéticos anteriores (produto e data)"),
        varias("contraindicacoes", "Contraindicações e cuidados", ["Gestante ou amamentando", "Usa isotretinoína", "Usa anticoagulante", "Doença autoimune", "Herpes recorrente", "Tendência a queloide", "Infecção ativa na região"]),
        longo("avaliacao", "Avaliação facial ou corporal", obrig),
        longo("plano", "Plano de procedimentos e sessões", obrig),
        simNao("termo_consentimento", "Termo de consentimento assinado", obrig),
      ],
      [
        longo("procedimento", "Procedimento realizado", obrig),
        curto("produto_lote", "Produto, lote e validade", { hint: "Obrigatório para injetáveis" }),
        curto("quantidade_regiao", "Quantidade e regiões"),
        longo("intercorrencias", "Intercorrências"),
        longo("orientacoes", "Orientações pós-procedimento"),
      ],
    ),
  },
];

/* ------------------------------ Modelos prontos ------------------------------ */

export interface BuiltInTemplate {
  /** Chave estável: "<especialidade>_<primeira|retorno|slug>" */
  key: string;
  specialty: string;
  specialtyKey: string;
  kind: TemplateKind;
  name: string;
  fields: TemplateField[];
}

/** Todos os formulários prontos do Tropi (a clínica recebe os que usa e pode editar a cópia) */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = SPECIALTIES.flatMap((s) =>
  s.templates.map((t) => ({ key: `${s.key}_${t.kind === "outro" ? t.slug : t.kind}`, specialty: s.label, specialtyKey: s.key, kind: t.kind, name: t.name, fields: t.fields })),
);

/* ------------------------- Reconhecer a especialidade ------------------------- */

/** Texto para comparar: sem acento, minúsculas, só letras e espaço */
function plain(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Especialidade do catálogo a partir do texto livre do cadastro do profissional.
 * Compara com o nome e os apelidos; aceita o nome dentro de um texto maior
 * ("Dermatologia clínica e estética" -> Dermatologia). O mais específico (mais longo) ganha.
 */
export function matchSpecialty(text: string | null | undefined): Specialty | null {
  if (!text) return null;
  const t = plain(text);
  if (!t) return null;
  let best: { s: Specialty; len: number } | null = null;
  for (const s of SPECIALTIES) {
    for (const name of [plain(s.label), ...s.aliases]) {
      if (!name) continue;
      const hit = t === name || ` ${t} `.includes(` ${name} `);
      if (hit && (!best || name.length > best.len)) best = { s, len: name.length };
    }
  }
  return best?.s ?? null;
}

export function specialtyByKey(key: string | null | undefined): Specialty | null {
  return SPECIALTIES.find((s) => s.key === key) ?? null;
}

/** Área do profissional: pela especialidade; senão pelo conselho; senão a única área da clínica; senão medicina */
export function areaOf(input: { specialty?: string | null; council?: string | null; clinicAreas?: readonly ClinicArea[] }): ClinicArea {
  const s = matchSpecialty(input.specialty);
  if (s) return s.area;
  const byCouncil = input.council ? COUNCIL_AREA[input.council.toUpperCase()] : undefined;
  if (byCouncil) return byCouncil;
  if (input.clinicAreas?.length === 1) return input.clinicAreas[0]!;
  return "medicina";
}

/** Especialidade "geral" de cada área (formulário de reserva) */
export function generalSpecialty(area: ClinicArea): Specialty {
  return SPECIALTIES.find((s) => s.area === area && s.general) ?? SPECIALTIES[0]!;
}

/**
 * Quais formulários prontos a clínica precisa ter: os das especialidades dos profissionais
 * ativos + o geral de cada área marcada (e de cada área dos profissionais).
 */
export function templatesToInstall(input: { areas: readonly ClinicArea[]; professionals: { specialty?: string | null; council?: string | null }[] }): BuiltInTemplate[] {
  const keys = new Set<string>();
  const areas = new Set<ClinicArea>(input.areas);
  for (const p of input.professionals) {
    const s = matchSpecialty(p.specialty);
    if (s) keys.add(s.key);
    areas.add(areaOf({ ...p, clinicAreas: input.areas }));
  }
  if (!areas.size) areas.add("medicina");
  for (const a of areas) keys.add(generalSpecialty(a).key);
  return BUILT_IN_TEMPLATES.filter((t) => keys.has(t.specialtyKey));
}

/* ----------------------------- Escolher o modelo ----------------------------- */

export interface TemplateOption {
  id: string;
  /** Especialidade do catálogo (null nos modelos criados pela clínica sem ligar a uma) */
  specialtyKey: string | null;
  /** Nome da especialidade (texto) */
  specialty: string;
  kind: TemplateKind | null;
  active: boolean;
}

/**
 * Formulário do atendimento, nesta ordem:
 *  1. o escolhido na hora (se ativo);
 *  2. o definido pela gestão para o profissional (primeira consulta ou retorno);
 *  3. o da especialidade do profissional, do tipo certo (primeira ou retorno);
 *  4. qualquer um da especialidade;
 *  5. o geral da área do profissional (do tipo certo);
 *  6. o primeiro ativo.
 */
export function pickTemplate<T extends TemplateOption>(input: {
  templates: T[];
  chosenId?: string | null;
  professional: { specialty?: string | null; council?: string | null; firstTemplateId?: string | null; returnTemplateId?: string | null };
  clinicAreas?: readonly ClinicArea[];
  isReturn: boolean;
}): T | undefined {
  const active = input.templates.filter((t) => t.active);
  const byId = (id?: string | null) => (id ? active.find((t) => t.id === id) : undefined);
  const kind: TemplateKind = input.isReturn ? "retorno" : "primeira";
  const spec = matchSpecialty(input.professional.specialty);
  const area = areaOf({ ...input.professional, clinicAreas: input.clinicAreas });
  const general = generalSpecialty(area);
  const sameSpec = (t: T, key: string) => t.specialtyKey === key || (!t.specialtyKey && matchSpecialty(t.specialty)?.key === key);
  return (
    byId(input.chosenId) ??
    byId(input.isReturn ? input.professional.returnTemplateId : input.professional.firstTemplateId) ??
    (spec ? (active.find((t) => sameSpec(t, spec.key) && t.kind === kind) ?? active.find((t) => sameSpec(t, spec.key) && t.kind !== "outro")) : undefined) ??
    active.find((t) => sameSpec(t, general.key) && t.kind === kind) ??
    active.find((t) => sameSpec(t, general.key)) ??
    active[0]
  );
}
