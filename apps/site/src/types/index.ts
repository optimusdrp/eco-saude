/**
 * Tipos compartilhados do site.
 * Centralizar os tipos aqui evita duplicação e garante que o conteúdo
 * (pasta src/content) e os componentes falem a mesma "língua".
 */

/** Identificador de cada módulo do ecossistema. */
export type ModuleId = "crm" | "erp" | "pep" | "bi";

/** Situação de cada módulo no roadmap do produto. */
export type ModuleStatus = "em-teste" | "em-desenvolvimento" | "planejado";

export interface EcosystemModule {
  id: ModuleId;
  /** Nome curto exibido nos chips e no mapa. */
  name: string;
  /** Nome descritivo para quem não conhece a sigla. */
  fullName: string;
  /** Uma frase sobre o que o módulo resolve, na linguagem do usuário. */
  summary: string;
  /** Submódulos (variam conforme o plano contratado). */
  submodules: string[];
  status: ModuleStatus;
}

/**
 * Conexão automática que aparece quando a clínica contrata
 * dois ou mais módulos juntos.
 */
export interface ModuleConnection {
  between: [ModuleId, ModuleId];
  description: string;
}

/** Perfis usados na demonstração do herói (a interface muda por perfil). */
export type RoleId = "recepcao" | "medico" | "gestor";

export interface Role {
  id: RoleId;
  label: string;
  /** Dispositivo típico desse perfil, usado para "vestir" a demonstração. */
  device: "desktop" | "tablet" | "phone";
  headline: string;
}

/** Funcionalidade de destaque (seção "O que quase ninguém oferece"). */
export interface Feature {
  id: string;
  title: string;
  description: string;
  /** Módulos envolvidos — indica de onde vem a funcionalidade. */
  modules: ModuleId[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface NavItem {
  label: string;
  href: `#${string}`;
}
