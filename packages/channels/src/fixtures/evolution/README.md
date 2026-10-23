# Webhooks da Evolution usados nos testes

Cada arquivo é o corpo de um webhook da Evolution API v2.3.7, sem dados pessoais.

- `fonte-*.json`: montados a partir do código-fonte da Evolution v2.3.7
  (`whatsapp.baileys.service.ts`, `whatsapp.business.service.ts`, `webhook.controller.ts`).
  O campo `_espera` diz o que o Tropi deve entender de cada um.
- `piloto-*.json`: gravados no piloto com servidor e celular reais (modo gravação,
  `EVOLUTION_CAPTURE_DIR`) e trazidos com
  `pnpm --filter @ecosaude/channels fixtures:evolution <pasta-das-capturas>`.

Os testes (`src/evolution-fixtures.test.ts`) leem TODOS os arquivos daqui e conferem:
nenhum dado pessoal, leitura sem erro e o tipo certo de cada mensagem, status e conexão.
