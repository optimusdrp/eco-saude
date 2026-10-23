# Tropi: site

Landing page pública do ecossistema Tropi, para clínicas e laboratórios. Faz parte do
monorepo: veja o `README.md` da raiz para instalar, rodar e publicar (seção "5a" explica
os módulos, o Laboratório planejado e a etiqueta "Em breve").

- Textos: `src/content/` (módulos em `modules.ts`, diferenciais em `features.ts`, perguntas em `faq.ts`)
- Seções da página: `src/components/sections/` (Laboratório em `Lab.tsx`)
- Demonstrações interativas: `src/components/demos/`
- Formulário de demonstração: `src/components/sections/Contact.tsx` envia para
  `src/app/api/contato/route.ts`, que grava o lead no banco (aparece no backoffice).
- Testes: `pnpm build` e depois `pnpm test:e2e` (`e2e/landing.spec.ts`, desktop e celular).
