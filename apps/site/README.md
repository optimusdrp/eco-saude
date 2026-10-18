# EcoSaúde: site

Landing page pública. Faz parte do monorepo: veja o `README.md` da raiz para instalar,
rodar e publicar.

- Textos: `src/content/`
- Seções da página: `src/components/sections/`
- Demonstrações interativas: `src/components/demos/`
- Formulário de demonstração: `src/components/sections/Contact.tsx` envia para
  `src/app/api/contato/route.ts`, que grava o lead no banco (aparece no backoffice).
