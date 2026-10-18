# EcoSaúde: monorepo

Site público, backoffice interno e ambiente da clínica (CRM hoje; ERP, Prontuário e BI nas
próximas etapas) do ecossistema EcoSaúde.

```
ecosaude/
├── apps/
│   ├── site/          Landing page pública (Next.js)                  -> porta 3000
│   ├── backoffice/    Gestão interna da equipe EcoSaúde (Next.js)     -> porta 3001
│   └── app/           Ambiente da clínica: CRM e, depois, os demais   -> porta 3002
├── packages/
│   ├── core/          Regras do negócio: status, perfis, permissões, validações (zod), regras do CRM
│   ├── db/            PostgreSQL: esquema (Drizzle), migrações, seed, isolamento por clínica (RLS)
│   ├── channels/      WhatsApp, Telegram, Instagram e Messenger: leitura de webhook, envio e simulação
│   ├── auth/          Criptografia e 2FA compartilhadas pelos apps
│   └── tokens/        Cores e fontes compartilhadas (Tailwind v4)
├── docker-compose.yml PostgreSQL local
├── .env.example       Modelo das variáveis de ambiente
└── turbo.json         Orquestra build/lint/typecheck de todos os pacotes
```

**Por que monorepo:** site e backoffice são apps separados (deploy, domínio e acesso isolados),
mas compartilham o mesmo vocabulário de negócio, as mesmas validações e a mesma identidade visual.
Mudou um status em `packages/core`? Os dois apps e o banco acompanham.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Como conferir |
|---|---|---|
| Node.js | 22 ou superior | `node -v` |
| pnpm | 10 | `pnpm -v` (instalar: `npm i -g pnpm`) |
| Docker Desktop | qualquer recente | `docker -v` (só para o banco local) |

## 2. Primeira execução, passo a passo

```bash
# 1. Instale as dependências de todos os pacotes de uma vez
pnpm install

# 2. Crie o arquivo de variáveis a partir do modelo
cp .env.example .env
```

Abra o `.env` e preencha:

- `TOTP_ENCRYPTION_KEY`: gere com o comando abaixo e cole o resultado.
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- `SEED_ADMIN_PASSWORD`: senha temporária do primeiro administrador (você troca no 1º acesso).

```bash
# 3. Suba o PostgreSQL local (Docker). Ele usa a porta 54320, e não a 5432,
#    para não colidir com um PostgreSQL que já esteja instalado no computador.
pnpm db:up

#    Confira se o projeto está falando com o banco certo:
pnpm db:check

# 4. Crie as tabelas
pnpm db:migrate

# 5. Carregue o catálogo (módulos, funcionalidades, planos) e o administrador
pnpm db:seed
#    Opcional, para testar com dados fictícios (leads, clínica, equipe):
pnpm db:seed -- --demo

# 6. Rode os apps (o "pnpm dev" aplica antes as migrações pendentes, sozinho)
pnpm dev
#    Site:        http://localhost:3000
#    Backoffice:  http://localhost:3001
#    Clínica/CRM: http://localhost:3002
```

> **Atualizou os arquivos do projeto?** Rode `pnpm install` e depois `pnpm dev`: as migrações
> novas são aplicadas automaticamente antes de subir os apps. Se o banco estiver desatualizado
> mesmo assim (ex.: subiu com `turbo` direto), o backoffice e o ambiente da clínica mostram uma
> página "Banco de dados desatualizado" com o passo a passo, em vez de um erro técnico.

### Primeiro acesso ao backoffice

1. Entre com `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`.
2. Crie a sua senha definitiva (mínimo de 12 caracteres, com maiúscula, minúscula e número).
3. Opcional e recomendado: em **Minha conta**, ative a **verificação em duas etapas**
   lendo o QR code com um aplicativo autenticador (Google Authenticator, Microsoft Authenticator...).
   Depois de ativa, o login pede o código do celular após a senha.

Com `--demo`, as contas `comercial@`, `suporte@` e `financeiro@ecosaude.local` usam a senha
`Demo-EcoSaude-2026` e também passam pelo primeiro acesso.

### Primeiro acesso ao CRM (ambiente da clínica, porta 3002)

**Clínica nova:** antes de tudo, em **Ajustes > Clínica**, cadastre os profissionais com os dias,
o expediente e a duração da consulta. É isso que gera os horários livres da agenda.

Com `--demo` existem duas clínicas, para você ver o isolamento entre elas:

| Clínica | Login | Perfil |
|---|---|---|
| Clínica Exemplo | `gestor@clinicaexemplo.com.br` | Gestão (tudo) |
| Clínica Exemplo | `recepcao@clinicaexemplo.com.br` | Recepção |
| Clínica Exemplo | `beatriz@clinicaexemplo.com.br` | Profissional de saúde |
| Clínica Olhar | `gestor@olhar.exemplo.com.br` | Gestão |

Senha de todos: `Demo-EcoSaude-2026` (troca obrigatória no primeiro acesso).

Para uma clínica **real**: no backoffice, abra a clínica, contrate o módulo CRM e, no quadro
**Acessos da clínica**, crie o acesso do gestor. A senha temporária aparece uma vez; o gestor
entra no ambiente da clínica e cadastra a própria equipe em **Ajustes > Equipe** (e, se quiser, ajuste os cargos em **Ajustes > Perfis e permissões**).

## 3. Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `pnpm dev` | Roda site e backoffice juntos |
| `pnpm dev:site` / `pnpm dev:backoffice` / `pnpm dev:app` | Roda só um deles |
| `pnpm --filter @ecosaude/core test` / `pnpm --filter @ecosaude/channels test` | Testes das regras do CRM e da leitura dos canais |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Verificações em todos os pacotes |
| `pnpm db:generate` | Gera migração SQL depois de alterar `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Aplica migrações pendentes |
| `pnpm db:studio` | Abre o Drizzle Studio para ver as tabelas no navegador |
| `pnpm db:down` | Para o PostgreSQL local |
| `pnpm db:check` | Testa a conexão e mostra se é o PostgreSQL do Docker ou outro |
| `pnpm db:reset-local` | **Apaga** o banco local e cria de novo (use se a senha do volume não confere) |

### Alterando o banco

1. Edite `packages/db/src/schema.ts` (backoffice/site) ou `packages/db/src/schema-crm.ts` (CRM).
   **Tabela nova do CRM?** Ela precisa de `GRANT` e da política `tenant_isolation` numa migração
   (siga o modelo de `migrations/0005_crm_isolamento.sql`), senão o app da clínica não a enxerga.
2. `pnpm db:generate` (cria um arquivo em `packages/db/migrations`; revise o SQL).
3. `pnpm db:migrate`.
4. Envie o arquivo de migração para o Git junto com o código.

## 4. O que o backoffice faz

| Área | Funções | Quem acessa |
|---|---|---|
| Painel | Leads da semana, funil, clínicas ativas, receita mensal recorrente, testes vencendo | Todos (cada bloco conforme permissão) |
| Leads | Pedidos do site em quadro por etapa (desktop) ou lista (celular), responsável, anotações, motivo de perda, conversão em cliente | Comercial, Admin (Suporte só vê) |
| Clínicas | Cadastro com validação de CNPJ, acesso do gestor ao ambiente da clínica, contratações por módulo, teste gratuito, ativar/suspender/cancelar com motivo, liberar ou bloquear funcionalidades como exceção, acesso efetivo calculado | Comercial, Financeiro, Admin |
| Catálogo | Planos por módulo, preço, limite de usuários, funcionalidades incluídas | Financeiro e Admin editam |
| Equipe | Criar contas (senha temporária exibida uma vez), perfil, desativar conta, redefinir senha, desativar a 2FA de quem perdeu o celular | Admin |
| Minha conta | Ativar/desativar a verificação em duas etapas, trocar senha, ver sessões abertas | Todos |
| Auditoria | Registro permanente de todas as ações, com filtros | Admin, Financeiro |

### Regras garantidas pelo banco (não só pela tela)

- **Uma contratação em aberto por módulo e clínica** (índice único parcial).
- **Auditoria imutável:** um gatilho bloqueia `UPDATE`, `DELETE` e `TRUNCATE` em `audit_log`.
  Por isso membros da equipe são **desativados**, nunca apagados.
- **Preço congelado:** a contratação guarda o preço do momento; mudar o catálogo não altera clientes atuais.
- **Teste sempre com prazo:** contratação em teste exige data de término.
- **Ficha anonimizada é definitiva (LGPD):** gatilhos impedem regravar dado pessoal numa ficha
  anonimizada e criar para ela consulta, tarefa, mensagem, lista de espera ou identificador de canal
  (erro `EC001`, migração 0024). Vale para qualquer caminho: tela, rotina, automação ou importação.

### Segurança

- Senhas com bcrypt (custo 12); comparação em tempo constante mesmo para e-mail inexistente.
- 2FA opcional por usuário (TOTP), ativada em Minha conta; segredo criptografado com AES-256-GCM;
  código não pode ser reutilizado; tolerância de 60 segundos de diferença de relógio.
  Desativar exige a senha; um administrador pode desativar a de quem perdeu o celular.
- Bloqueio de 15 minutos após 5 tentativas erradas (senha ou código).
- Sessões no banco: desativar um usuário ou trocar senha derruba as sessões na hora.
- Cookie `httpOnly`, `sameSite=lax` e `secure` em produção.
- Permissão conferida **em cada ação no servidor**, não só escondendo botões.
- Formulário do site: validação, campo-armadilha, limite de 5 envios por IP por hora e
  deduplicação por e-mail em 24 horas.

## 5. O CRM (ambiente da clínica)

Pensado para a rotina da recepção: tudo o que precisa de ação aparece primeiro, e o máximo
possível acontece sozinho.

| Tela | O que faz | Diferenciais |
|---|---|---|
| **Hoje** | Painel do dia personalizável: régua do dia, recepção ao vivo (Chegou/Faltou em um toque), fila de ações com filtros, amanhã, horários livres, aniversariantes e pulso da semana | Relógio ao vivo: "atrasado", "em consulta" e "próximos" mudam sozinhos; modelos Recepção e Gestão; cada pessoa escolhe, ordena e recolhe os quadros. Detalhes em "Hoje" abaixo |
| **Conversas** | Caixa única de WhatsApp, Telegram, Instagram e Messenger: fila por tempo de espera com medidor da meta de 15 min, filtros (esperando, abertas, minhas, sem responsável, adiadas, resolvidas), ações em lote, busca dentro da conversa, rascunhos, painel com abas e atalhos de teclado | Detecta a intenção e sugere respostas; detecta **sinais de urgência** e mostra orientação (SAMU 192, CVV 188) sem responder sozinho; respeita a **janela de 24h da Meta** (contagem regressiva; fora dela só modelos aprovados); `/atalho` para respostas rápidas. Detalhes em "Conversas" abaixo |
| **Agenda** | Quadro interativo com visões **Dia** (coluna por profissional), **Semana** e **Lista**; horas à esquerda; clique no horário livre para agendar; **arraste a consulta para remarcar**; personalização salva no navegador | Impossível marcar dois pacientes no mesmo horário (garantido pelo banco); remarcar mantém o histórico, pede nova confirmação, avisa o paciente e oferece o horário antigo à lista de espera; ao cancelar, idem. Detalhes em "Agenda" abaixo |
| **Lista de espera** | Fila com filtros e visão por profissional, **encaixes possíveis** (horários livres dos próximos 7 dias que já combinam com alguém), ofertas com contagem regressiva e números do mês | Vaga liberada é oferecida a até 3 pessoas compatíveis; **o primeiro "SIM" fica com ela**, sem a recepção ligar para ninguém. Detalhes em "Lista de espera" abaixo |
| **Jornada** | Quadro (ou lista) Novo, Em conversa, Agendado, Paciente, Para reativar, Perdido, com funil de 90 dias, filtros, ações em lote e personalização | A etapa **muda sozinha** (respondeu, agendou, compareceu, 6 meses sem voltar); cartão "esquenta" quando fica parado; motivo obrigatório ao perder, com ranking dos motivos. Detalhes em "Jornada" abaixo |
| **Contatos** | Leads e pacientes num lugar só (paciente = já foi atendido). Busca ao digitar **sem diferenciar acentos**, filtros por tipo, etapa, canal, origem, etiqueta e responsável, **segmentos prontos**, tabela com colunas à escolha ou cartões, ações em lote e exportação em planilha; **possíveis duplicados** e unificação | Ficha 360 com **linha do tempo unificada** (todas as conversas, consultas, anotações e automações), **melhor horário para falar** e tempo de resposta aprendidos das conversas, **exportação LGPD** em um clique. Detalhes em "Contatos" abaixo |
| **Tarefas** | Lembretes da equipe com prazo e **responsável**: tarefa rápida que entende datas e @nome, visões Lista, Semana e Equipe (arrastar muda data ou responsável), carga da equipe, ações em lote | Falta gera tarefa "Remarcar" sozinha; satisfação baixa gera tarefa para a gestão. Detalhes em "Tarefas" abaixo |
| **Retornos** | Radar de quem está na hora de voltar (janela de 7 a 60 dias), faixa de vencimentos, prévia da mensagem, envio em lote, aba **Acompanhar** e resultado por protocolo | Envio em lote só para quem autorizou (LGPD) e **mede o resultado**: quantos voltaram a agendar, no geral e por protocolo. Detalhes em "Retornos" abaixo |
| **Ajustes** | Visão geral com checklist “Deixe a clínica pronta” e busca; Minha conta (senha, 2FA, aparelhos conectados); Preferências (tamanho do texto, telas personalizadas, rascunhos); Clínica e profissionais (horários por dia, ausências, capacidade, dados da clínica); Automações (do sistema, regras Quando/Se/Então, histórico); Mensagens automáticas; Canais; Respostas rápidas; Protocolos de retorno; Equipe (acesso individual); Perfis e permissões (cargos personalizáveis); Segurança e atividade; Plano e módulos | Cada área aparece só para quem tem a permissão; validação do expediente; não deixa desativar profissional com consultas futuras; razão social e CNPJ só pelo suporte; toda mudança fica na atividade da clínica |

Automações que respondem sozinhas (todas registradas na linha do tempo):

- **Confirmação automática:** todos os dias, a partir do horário escolhido em Ajustes > Automações (padrão 10h, até as 20h),
  o CRM pede confirmação das consultas de amanhã (ou de 2/3 dias à frente) que ainda não receberam o pedido.
  Quem pediu SAIR não recebe; ninguém recebe duas vezes.
- **Resposta à confirmação:** "1" confirma; "2" avisa o paciente que a equipe vai ajudar a remarcar e deixa a conversa marcada para a recepção (cancelar continua sendo decisão de uma pessoa, e ao cancelar a vaga é oferecida à lista de espera).
- **Lista de espera:** "SIM" agenda; quem responde depois que a vaga foi preenchida recebe aviso educado.
- **Pesquisa de satisfação (0 a 10):** enviada após a consulta; nota 6 ou menos cria tarefa para a gestão.
- **SAIR / VOLTAR:** o paciente deixa de receber mensagens automáticas (LGPD) e pode voltar com VOLTAR.

Falar com quem ainda não escreveu: na ficha (ou no trilho) do paciente, **Enviar mensagem** abre a
conversa pelo canal disponível (WhatsApp pelo celular do cadastro). Como o paciente ainda não escreveu,
a primeira mensagem precisa ser um modelo aprovado (ex.: `/retomar`).

Atalhos: `Ctrl + K` busca qualquer paciente ou tela; clicar num nome abre o **trilho do paciente**
ao lado (pode fixar), sem sair da tela em que você está.

### Ajustes

Tudo o que se configura no sistema, num lugar só. Cada pessoa vê apenas as áreas que o perfil dela pode mudar. **Tudo vale na hora para a clínica inteira**, exceto Preferências (só no navegador de quem ajustou). Formulários salvam no botão **Salvar**; ligar/desligar uma automação e as Preferências salvam ao clicar.

- **Visão geral:** checklist “Deixe a clínica pronta” com “Resolver” em cada item e um cartão por área com o resumo atual. Busca no menu lateral (ignora acentos; procura por nome, descrição e palavras-chave).
- **Minha conta:** senha, verificação em 2 etapas e aparelhos conectados (desconectar um ou todos os outros; a sessão atual nunca cai).
- **Preferências (por navegador):** tamanho do texto, telas personalizadas com “Restaurar”, limpeza de rascunhos.
- **Clínica e profissionais:**
  - **Horários por dia**: cada dia da semana tem os próprios períodos (até 4; o vão entre eles é o intervalo) e, se quiser, a própria duração de consulta. Modelos prontos e “copiar para os outros dias”.
  - **Ausências** (férias, congresso, folga, licença): nesses dias o profissional some dos horários livres da agenda, da lista de espera e das sugestões da conversa. Consultas já marcadas não são canceladas: a tela avisa quantas existem.
  - Grade da semana com capacidade (horas e consultas) e faixa dos próximos 14 dias (quem atende, quem está fora).
  - Dados da clínica (razão social e CNPJ só pelo suporte).
- **Automações** (três abas):
  - *Do sistema*: liga/desliga e parâmetros de cada automação pronta: confirmação automática, resposta à confirmação (opcional: tarefa de remarcar), **lembrete no dia** (N horas antes), falta vira tarefa (opcional: mensagem), **avisar cancelamento**, **pós-consulta**, lista de espera, pesquisa de satisfação (nota de alerta, tarefa, link de avaliação no Google para quem dá 9 ou 10), **boas-vindas**, **fora do horário** (dias e horário de atendimento), **aniversário**, jornada automática (dias para “Para reativar”). Sinais de urgência e SAIR/VOLTAR nunca desligam.
  - *Regras da clínica*: construtor **Quando → Esperar → Se → Então**. Gatilhos: contato novo, mensagem recebida (com palavras), mudou de etapa, consulta marcada, status da consulta, pesquisa respondida (faixa de nota), tarefa concluída, SAIR, urgência. Condições conferidas no fim da espera (etapa, etiqueta, tem/não tem consulta, paciente ou equipe não respondeu). Ações: mandar mensagem (só dentro da janela de 24h, ou como modelo aprovado), criar tarefa, mover etapa, colocar/tirar etiqueta, definir responsável, devolver a conversa para a equipe, nota interna. “Uma vez por contato” opcional. 8 receitas prontas.
  - *Histórico*: cada execução (feita, na espera, não rodou com o motivo, falhou).
- **Mensagens automáticas:** os 21 textos que o CRM envia sozinho, com variáveis clicáveis, prévia como no celular, aviso de variável que a mensagem não preenche, “restaurar padrão” e desligar (as que fazem sentido). Mensagens que costumam sair depois de 24h avisam que precisam ser modelo aprovado no WhatsApp oficial.
- **Respostas rápidas:** busca, filtro de modelos aprovados e prévia. Aparecem na conversa ao digitar “/” (fora da janela de 24h, só as marcadas como modelo aprovado).
- **Protocolos de retorno:** cada protocolo com a mensagem do lembrete e o atalho para o radar.
- **Equipe:** contagem por perfil, busca, filtros e, por pessoa, **Acesso**: perfil + liberar ou bloquear permissões só para ela.
- **Perfis e permissões:** 31 permissões em 6 categorias (Conversas, Agenda e lista de espera, Contatos e jornada, Tarefas, Retornos, Ajustes), perfis do sistema editáveis (Gestão, Recepção, Profissional de saúde) e **novos cargos** a partir de modelos (Coordenação clínica, Atendimento/call center, Comercial/marketing, Financeiro/faturamento, Enfermagem/técnico, Assistente/estagiário, Auditoria/somente leitura), copiando um perfil ou em branco. Tabela para comparar perfis.
  - O servidor confere a permissão em toda página e ação; a mudança vale na próxima tela que a pessoa abrir.
  - Proteções: ninguém tira de si mesmo o próprio perfil; a clínica nunca fica sem alguém com “Acessos da equipe” e “Perfis e permissões”; quem não administra permissões só dá a outra pessoa um perfil com poderes iguais ou menores que os seus.
- **Segurança e atividade:** pendências, números de 30 dias e as últimas 200 ações (inclui mudanças de perfil, permissões, automações e mensagens).
- **Plano e módulos:** módulos contratados e funcionalidades liberadas.
- **Inteligência artificial** (permissão própria `config.ia`, migração 0015 dá ao perfil Gestão): um lugar só para **todas** as funcionalidades com IA. Tudo começa desligado; a clínica liga o que quiser, com os ajustes de cada uma e os números dos últimos 7 dias. Ao lado: se a chave está configurada, os modelos, se a IA está instável agora (disjuntor), o botão **Testar a IA agora**, o que é enviado para a IA e as proteções que valem sempre.
  - Nova funcionalidade de IA = novo item com `group: "ia"` em `packages/core/src/crm/automations.ts`: aparece sozinha nessa área (e fora de Automações). Os números da semana ficam em `apps/app/src/modules/crm/ai/stats.ts`.

### Rascunho de resposta com IA (Gemini)

Na conversa, **Sugerir resposta** escreve um rascunho para o atendente revisar. **Nada é enviado sozinho**: o texto vai para o campo só se a pessoa clicar em "Usar no campo", e o envio continua no botão Enviar.

**Como ligar**
1. Crie a chave num projeto do Google **com faturamento ativo** (nível pago) e coloque em `GEMINI_API_KEY`. Coloque também `GEMINI_PAID_TIER=sim`: é a confirmação de que a conta é paga (a API não informa isso). **Sem `GEMINI_PAID_TIER=sim`, a IA fica desligada** (só plano B), mesmo com a chave: no nível gratuito o Google pode usar os dados para melhorar os produtos. Veja "Gemini com dados reais" abaixo.
2. Em **Ajustes > Inteligência artificial**, ligue "Rascunho de resposta com IA", escolha o tom e clique em **Testar a IA agora** (usa uma conversa fictícia).

**O que vai para a IA (LGPD: só o necessário)**
- Últimas 20 mensagens, com CPF, cartão, e-mail e telefone trocados por marcadores **antes** de sair do servidor.
- Primeiro nome, etapa, etiquetas, próxima consulta, até 6 horários livres reais e as respostas rápidas comuns (fonte oficial de valores e endereço).
- Nunca: sobrenome, documentos, prontuário.

**Proteções**
- Instruções fixas: sem orientação de saúde, sem inventar horário, preço ou endereço, mensagens do paciente tratadas como dados (contra "ignore as regras").
- Conferência do que volta: orientação de saúde ou dado ocultado repetido = rascunho recusado. Horário fora da agenda e valor citado geram aviso.
- Conversa com sinal de urgência: a IA não é chamada; aparece o texto fixo de SAMU 192 / CVV 188.
- Limite de 30 rascunhos com IA por pessoa a cada 10 minutos; o mesmo pedido em 30 minutos reaproveita o rascunho (sem novo custo).

**Plano B (instabilidade)**
| Situação | O que acontece |
| --- | --- |
| IA lenta | Tempo limite por tentativa (`AI_TIMEOUT_MS`, padrão 9 s) |
| Modelo principal falha ou sem cota | Tenta o modelo reserva (`GEMINI_FALLBACK_MODEL`) |
| Os dois falham | Sugestão **por regras** (intenção + horários livres + resposta rápida que combina), com o motivo visível |
| 3 falhas seguidas | Disjuntor: 2 minutos direto nas regras, sem fazer ninguém esperar |
| IA desligada ou sem chave | Sempre regras; nenhum dado sai do servidor |

A chamada à IA acontece **fora** da transação do banco (IA lenta não segura o PostgreSQL). Cada rascunho fica em `ai_drafts` (quem pediu, origem, modelo, tempo, motivo do plano B e se foi usado, editado ou descartado). O resumo da semana aparece no cartão da automação.

**Testar sem internet:** `AI_PROVIDER=mock` e `AI_MOCK_MODE=ok|fail|slow|clinical|bad`.

### Intenção com IA (Gemini)

A intenção da conversa ("Quer agendar", "Quer remarcar", "Pergunta valores"...) agora é decidida em duas camadas:

1. **Na hora, palavras-chave** (como antes): rápidas, gratuitas, nunca falham. A conversa já aparece marcada.
2. **Logo depois, a IA** lê as últimas 8 mensagens e confirma ou corrige: "dá pra passar pra semana que vem?" vira **Quer remarcar**. A tela mostra "entendido pela IA (92% de certeza)" e o trecho que decidiu.

Ligue em **Ajustes > Inteligência artificial > Entender a intenção com IA** e ajuste a **certeza mínima** (padrão 70%). Abaixo dela, ficam as palavras-chave.

**Plano B**
| Situação | O que acontece |
| --- | --- |
| IA desligada ou sem chave | Só palavras-chave (nenhum dado sai do servidor) |
| IA lenta ou instável | Fica a marcação das palavras-chave; a rotina de 10 min tenta de novo, até 3 vezes |
| IA com pouca certeza | Ficam as palavras-chave (registrado para medir) |
| 3 falhas seguidas | Disjuntor compartilhado com o rascunho: 2 minutos sem chamar a IA |
| Chegou mensagem nova durante a análise | O resultado antigo é descartado; vale a análise da mensagem nova |

**Como funciona por dentro:** a entrada da mensagem (webhook) marca a conversa na fila e responde na hora; a IA roda **depois** da resposta (`after()` do Next.js), fora da transação do banco, usando um modelo leve (`GEMINI_CLASSIFY_MODEL`, padrão `gemini-3.5-flash-lite`, com o principal de reserva). A rotina agendada recolhe o que ficou na fila. Dados pessoais são ocultados como no rascunho.

**Corrigir:** no painel da conversa, "O que o paciente quer > Corrigir". A correção vale na hora e entra na medição. O cartão da automação mostra, nos últimos 7 dias, quantas a IA decidiu, quantas vezes corrigiu as palavras-chave e quantas vezes a equipe corrigiu a IA.

A intenção entendida pela IA também melhora as **respostas sugeridas** e o **rascunho por regras** (plano B do rascunho).

### Resumo da conversa com IA (Gemini)

Botão **Resumir** no topo da conversa (atalho **S**), para quem assume no meio. Mostra uma linha com o essencial, por exemplo "quer clareamento, pediu valor, prefere sábado de manhã, ainda sem resposta". Em **Ver detalhes** aparecem até 5 pontos (o que a clínica já ofereceu, preferências, o que a equipe prometeu), o **próximo passo** e os avisos.

- **Fica guardado:** quem abrir a conversa depois já vê o último resumo, com "N mensagens novas desde o resumo" e o botão **Atualizar**.
- **Sem custo repetido:** clicar de novo sem mensagem nova devolve o mesmo resumo, sem chamar a IA. **Gerar de novo** força uma nova leitura.
- **Quem está esperando quem** ("ainda sem resposta" ou "aguardando o paciente") é calculado pelo sistema, nunca pela IA, porque é o dado que não pode estar errado.
- **"Ajudou?"** (curti/não curti) mede a utilidade. Os números aparecem no cartão em Ajustes > Inteligência artificial.
- **Permissão:** basta poder ver conversas (`conversas.ver`), porque o resumo não envia nada ao paciente.

Ligue em **Ajustes > Inteligência artificial > Resumo da conversa com IA** e escolha **quantas mensagens a IA lê** (10 a 80, padrão 40).

**O que vai para a IA:** as últimas N mensagens (com CPF, cartão, e-mail e telefone ocultados), notas internas, o primeiro nome, a etapa, as etiquetas e a próxima consulta. A IA é proibida de interpretar sintomas. Se o paciente citou uma queixa, o resumo diz só "relatou queixa de saúde (ver conversa)".

**Conferência antes de mostrar:** o resumo é recusado (e vale o plano B) se vier fora do formato ou vazio, com orientação de saúde, ou repetindo um dado ocultado. Um valor (R$) ou horário que não aparece nas mensagens lidas gera um aviso "Confira na conversa".

**Plano B (resumo por regras, sem enviar nada para fora):**
| Situação | O que acontece |
| --- | --- |
| IA desligada ou sem chave | Resumo pelas regras, com o aviso "Resumo automático" |
| Conversa com sinal de urgência | Não vai para a IA (fica no CRM); o resumo mostra o alerta |
| IA lenta, instável, resposta inválida ou bloqueada | Resumo pelas regras, com o motivo visível |
| Mais de 30 resumos com IA em 10 min pela mesma pessoa | Resumo pelas regras até o limite liberar |

O resumo por regras junta as intenções de cada frase do paciente (pediu valor, quer remarcar...), o assunto ("quero fazer clareamento", "quanto custa a limpeza"), a preferência de dia e período ("prefere sábado de manhã", "depois das 18h"), a próxima consulta, as últimas mensagens de cada lado e a última nota da equipe.

**Arquivos:** regras puras em `packages/core/src/crm/ai-summary.ts` (com testes); orquestração em `apps/app/src/modules/crm/ai/summary.ts`; tela em `components/crm/inbox/SummaryBar.tsx`; tabela `ai_summaries` (migração 0016, com isolamento por clínica).

### Modelos aprendidos com os dados da clínica (risco, encaixe, duração) e resumo da manhã

**Escolha de projeto:** só o **resumo da manhã** usa o Gemini, porque é trabalho de linguagem. As outras três são **previsão e estatística** sobre os dados da clínica. Para elas, um modelo de linguagem seria a ferramenta errada:
- não dá probabilidade calibrada;
- não é reproduzível;
- pode inventar números;
- exigiria mandar o histórico de pacientes para fora.

Por isso essas três rodam **no servidor**, com regressão logística (`packages/core/src/crm/ml.ts`) e estatística. Nada sai do sistema, e cada fator tem um peso legível, de onde vem a explicação em português.

#### Risco de falta aprendido (Ajustes > Inteligência artificial)
- **Fatores:** dia da semana, horário (começo da manhã, almoço, fim do dia), antecedência da marcação, **chuva** prevista, histórico do paciente (taxa e "últimas 3"), confirmação e pedido de confirmação sem resposta.
- **Treino:** sozinho, uma vez por dia (rotina de 10 min), ou pelo botão **Treinar agora**. Usa até 18 meses de consultas com desfecho (compareceu/faltou), com o histórico calculado **como era na época** de cada consulta.
- **O modelo só assume se merecer.** São necessárias no mínimo 150 consultas com desfecho e 12 faltas. Ele treina com as consultas mais **antigas** e é medido nas mais **recentes** (que não viu). Só entra em uso se acertar **mais que a fórmula atual** nesse teste.
- **Plano B:** sem isso, vale a fórmula de sempre, e o cartão em Ajustes diz o motivo ("poucas faltas para aprender (8 de 12)", "a fórmula atual acertou mais no teste"...).
- **Explicação** em português, a partir do peso real de cada fator naquela consulta:
  - "Faltou 2 das últimas 3";
  - "Marcada há 32 dias";
  - "Pedimos confirmação e ainda não respondeu";
  - "Sexta costuma ter mais faltas nesta clínica".

  O texto segue o sinal do peso ("quarta costuma ter **menos** faltas"). Com risco baixo, a explicação mostra o que puxa o risco para baixo ("Já confirmou").
- A nota agora é uma **probabilidade real** (37% = 37 em cada 100 consultas parecidas faltaram). Alto a partir de 35%, médio a partir de 18%.
- **Chuva:** Open-Meteo, gratuito e sem chave, consultado só com a cidade da clínica. Previsão de 8 dias a cada 6 horas, mais o histórico dos dias usados no treino.
  - Plano B: sem internet ou com o serviço fora, o modelo segue sem esse fator.
  - Ele só usa chuva se houver informação para pelo menos 60% das consultas.
  - `WEATHER_PROVIDER=open-meteo|mock|off`.
- **Limite conhecido:** dia e horário entram separados (o modelo não combina "sexta **à tarde**").

#### Encaixe inteligente
Quando abre uma vaga, a lista de espera aparece ordenada pela **chance de aceitar**, com o percentual e os motivos:
- "Aceitou 1 oferta antes";
- "Conversou nas últimas 24h (vê a oferta a tempo)";
- "Pediu exatamente este período";
- "Não respondeu 2 ofertas".

Os primeiros já vêm marcados, e **quem escolhe é a recepção**. Funciona assim:
- começa com **pesos fixos** e transparentes (plano B);
- os fatores de cada paciente ficam **guardados no momento da oferta**;
- com 60 ofertas respondidas (10 aceites), o mesmo conjunto de fatores é aprendido com os dados da clínica;
- os pesos aprendidos só substituem os fixos se acertarem mais no teste.

#### Duração real das consultas
- **Na agenda:** "Chegou" registra a chegada e o novo **Finalizar atendimento** registra a saída. O diálogo mostra "Chegou às 14:05 e saiu às 14:48 (43 min de atendimento)".
- **Cálculo:** duração real = saída menos o mais tarde entre o horário marcado e a chegada. Assim, a espera de quem chega cedo não conta.
- **Página Ajustes > Duração das consultas:**
  - mostra, por profissional e procedimento, a duração marcada, a real típica e a sugerida (percentil escolhido: 50, 75 ou 90%, arredondado de 5 em 5);
  - inclui o atraso típico de chegada e avisos ("a agenda tende a atrasar" / "dá para encurtar e abrir mais horários");
  - **Usar X min nos próximos agendamentos** grava a duração por procedimento; nada muda nas consultas já marcadas.
- **Ao agendar:** com profissional e procedimento escolhidos, a **duração vem preenchida** com a aplicada (ou com a medida, se houver 5 atendimentos ou mais) e uma nota de onde ela veio.

#### Resumo da manhã no Hoje (Gemini)
"Hoje 18 consultas, 3 com alto risco de falta, 2 encaixes possíveis na tarde da Dra. Helena, 4 conversas esperando há mais de 1 hora."
- **Os números são calculados pelo sistema**; a IA só redige.
- **A frase é conferida:** todo número citado precisa estar nos dados e todo "Dr./Dra." precisa ser profissional da lista. Qualquer desvio faz o texto das regras valer.
- **O Hoje nunca espera a IA:** mostra na hora a frase das regras (sempre certa) e pede a versão da IA depois da resposta. Ela aparece na atualização seguinte (30 s).
- **Um texto da IA com números velhos nunca é mostrado.**
- **No máximo uma chamada a cada 10 minutos.** Para a IA vão só contagens e nomes de profissionais.

**Migração 0020:**
- **Colunas novas:**
  - `appointments.arrived_at` e `finished_at`;
  - `slot_offer_candidates.features` e `score`;
  - `crm_settings.geo`.
- **Tabelas novas:**
  - `learned_models` (modelos e relatórios);
  - `weather_days`;
  - `service_durations`;
  - `day_briefs`.
- Todas com isolamento por clínica.
- Quem já estava como "compareceu" ganha `arrived_at` igual ao horário marcado; a saída não é inventada.

**Arquivos:**
- núcleo: `ml.ts`, `risk-model.ts`, `waitlist-score.ts`, `durations.ts`, `day-brief.ts` (com testes);
- servidor: `apps/app/src/modules/crm/ml/` (treino, chuva, durações) e `ai/day-brief.ts`.

### Lembrar o que ficou prometido com IA (Gemini)

Quando alguém da equipe escreve uma promessa na conversa, o CRM **cria sozinho uma tarefa** para essa pessoa, com o prazo dito. Por exemplo, "vou te mandar o orçamento amanhã" vira "Prometido a Rita: enviar o orçamento do clareamento", para amanhã. Vale também para a **nota interna** ("ligar pra ela na sexta").

- **No painel Assistente**, o quadro **Prometido nesta conversa** mostra as promessas em aberto: prazo ("para amanhã" ou "atrasada"), quem vai cumprir e a origem (IA ou regras).
- **Feito** conclui a tarefa. **Não era promessa** apaga a tarefa e conta como erro da leitura, o que entra na medição.
- A tarefa aparece em **Tarefas** e em **Hoje**, e fica registrada na linha do tempo do paciente.
- **Não repete:** a mesma promessa ainda aberta não vira outra tarefa.
- **Opcional:** "lembrar também o que o PACIENTE ficou de fazer". Assim, "amanhã te mando os exames" vira "Rita ficou de mandar os exames (cobrar se não vier)", para o responsável da conversa.
- **Nada é enviado ao paciente:** são lembretes internos.

**Como lê a promessa:**
1. **Filtro barato:** só mensagens com jeito de compromisso ("vou", "te mando", "retorno", "amanhã", "até sexta"...) seguem adiante. "Bom dia, tudo bem?" não custa nada. Modelos aprovados da Meta (texto fixo) não contam.
2. **A IA lê logo depois do envio** (fora da transação), com as 4 mensagens anteriores como contexto. Ela entende a ação ("verificar com a doutora e dar retorno") e o prazo, que escolhe de um **calendário** (não faz conta de data).
3. **Conferência:** prazo fora do calendário, texto longo demais, dado ocultado ou orientação de saúde fazem a resposta ser recusada, e as regras assumem.

Ligue em **Ajustes > Inteligência artificial > Lembrar o que ficou prometido**. Ajustes disponíveis:
- **prazo quando ninguém disse quando** (0 a 7 dias, padrão 1);
- **lembrar o que o paciente ficou de fazer**;
- **certeza mínima** da IA.

**O que vai para a IA:** a mensagem e as 4 anteriores, sem nome e com CPF, cartão, e-mail e telefone ocultados, mais o calendário. A IA usa o modelo leve. Conversa com sinal de urgência não vai para a IA.

**Plano B (regras):** o verbo de compromisso vira a ação e o que vem depois dele vira o objeto ("vou te mandar **o orçamento** amanhã"). O prazo sai de "hoje", "mais tarde", "amanhã", "depois de amanhã", "em 2 dias", dia da semana, "semana que vem", "dia 20" e "20/10".
| Situação | O que acontece |
| --- | --- |
| IA sem chave | As regras leem na hora |
| IA instável, lenta ou com resposta recusada | Se as regras acharam a promessa, ela **vale na hora**. Se não acharam nada, nova tentativa (até 3) pela rotina de 10 min, porque a IA pode achar o que a regra não vê |
| IA com pouca certeza | Valem as regras |

**Medição:** cada mensagem lida fica em `ai_promises` (migração 0019, com isolamento por clínica). Essa tabela também é a **fila**: o registro "pendente" é processado pelo `after()` e pela rotina. O cartão em Ajustes mostra, nos últimos 7 dias, as mensagens lidas, as tarefas criadas e quantas foram marcadas como "não era promessa".

**Arquivos:** regras puras em `packages/core/src/crm/ai-promise.ts` (com testes); fila e tarefas em `apps/app/src/modules/crm/ai/promises.ts`; painel em `components/crm/inbox/PromisesBox.tsx`.

### Sentimento do paciente com IA (Gemini)

Percebe quem está **impaciente, irônico, irritado, insatisfeito** (reclamação, avaliação negativa) ou fazendo **ameaça** (Procon, processo, Reclame Aqui, expor nas redes, avaliação pública). Também reconhece **ansioso**, **satisfeito** e **calmo**.

**O que acontece:**
- **Sobe na fila:** a conversa fica logo abaixo das urgências, com o selo do sentimento na lista e no topo da conversa. Em caso de ameaça, aparece um aviso no topo pedindo calma e envolvimento da gestão.
- **Avisa a gestão:** uma tarefa para hoje ("Ameaça: falar com Rita (fala em Procon)"), atribuída a alguém com perfil Gestão. Ela aparece em **Hoje** logo depois das urgências e na linha do tempo do paciente. É uma tarefa por conversa; uma nova só sai se o caso piorar (ex.: de irritado para ameaça).
- **"Como o paciente está"** no painel Assistente mostra o sentimento, a origem ("entendido pela IA (95%)", "por palavras-chave e sinais" ou "corrigido pela equipe") e o trecho que decidiu. **Corrigir** vale na hora, mexe na fila e pode avisar a gestão.
- Ao **resolver** a conversa, o sentimento volta a zero.

**Em duas camadas, como a intenção:**
1. **Na hora:** palavras-chave e **sinais objetivos** (3 ou mais mensagens seguidas sem resposta, ou 2 com mais de 30 min de espera; TUDO EM MAIÚSCULAS; "!!!"). A conversa já sobe na fila.
2. **Logo depois:** a IA lê as últimas 10 mensagens e confirma ou corrige. Ela entende ironia ("parabéns pela rapidez") e contexto ("processo de clareamento" não é ameaça).

Com a IA ligada, **o aviso à gestão espera a confirmação dela**, que leva poucos segundos. Isso evita alarme falso.

Ligue em **Ajustes > Inteligência artificial > Sentimento do paciente com IA**. Desligada, a fila não muda. Ajustes disponíveis:
- **Subir na fila e avisar a partir de:** impaciente ou irônico / irritado ou insatisfeito (padrão) / só ameaça;
- **Subir a conversa na fila** (liga/desliga);
- **Avisar a gestão com uma tarefa** (liga/desliga);
- **Certeza mínima** da IA (padrão 70%). Para **rebaixar uma ameaça** vista pelas palavras-chave, a IA precisa de **85% ou mais**: perder um "vou no Procon" custa mais caro que um alerta a mais.

**O que vai para a IA:** as últimas 10 mensagens, sem nome e com CPF, cartão, e-mail e telefone ocultados, mais os sinais de espera. Mensagens curtas e tranquilas ("ok", "1") não vão, por economia. Conversa com **sinal de urgência** não vai: sofrimento emocional e risco continuam com as regras fixas de urgência (CVV/SAMU), que têm prioridade sobre tudo. Isto **não** é avaliação de saúde mental.

**Plano B:**
| Situação | O que acontece |
| --- | --- |
| IA sem chave | Palavras-chave e sinais decidem; o aviso sai na hora |
| IA lenta, instável ou com resposta inválida | **Caso grave pelas palavras-chave:** vale a regra e o aviso sai na hora. **Caso leve:** nova tentativa na rotina de 10 min, até 3 vezes |
| IA com pouca certeza | Ficam as palavras-chave (registrado para medir) |
| 3 falhas seguidas | Disjuntor compartilhado: 2 minutos sem chamar a IA |
| Chegou mensagem nova durante a análise | Vale a análise da mensagem nova |

**Medição:** cada decisão vai para `ai_sentiments` (migração 0018, com isolamento por clínica). O cartão em Ajustes mostra, nos últimos 7 dias, quantas a IA decidiu, quantas vezes corrigiu as palavras-chave, os avisos à gestão e as correções da equipe.

**Arquivos:** regras puras em `packages/core/src/crm/ai-sentiment.ts` (com testes); fila e avisos em `apps/app/src/modules/crm/ai/sentiment.ts`; filas da IA juntas em `ai/queue.ts`; painel em `components/crm/inbox/SentimentBox.tsx`.

### Agendar pelo pedido com IA (Gemini)

Na conversa, **Agendar pelo pedido** (na barra do campo de texto e no painel Assistente > Agenda) lê o que o paciente pediu, por exemplo "quinta à tarde com a Dra. Beatriz, é pro clareamento". Em seguida abre o agendamento **já preenchido**:
- profissional, período e procedimento selecionados;
- **só os horários livres que batem com o pedido**, com o horário exato pedido já marcado quando está livre;
- os chips do que foi entendido ("quinta, 15/10", "à tarde", "Dra. Beatriz Lemos", "Clareamento") e o trecho da mensagem que decidiu;
- a observação "Pedido do paciente: …" para a equipe.

**Quem faz o quê (o ponto crítico):**
- A **IA só entende o pedido**: data, período, horário, profissional e procedimento.
- Os **horários vêm da agenda real** (expediente, ausências, consultas marcadas). A IA nunca inventa horário livre.
- **Quem marca é a recepção**, no botão "Confirmar agendamento". Nada é marcado sozinho.

**Proteções contra erro da IA:**
- A IA não faz conta de data. Ela recebe um **calendário** dos próximos N dias, com o dia da semana, e escolhe datas dessa lista. Uma data fora da lista é recusada.
- Um **profissional** que não está cadastrado é recusado. O procedimento é limitado a um nome curto, e conteúdo clínico ou dado ocultado é recusado.
- **Avisos** no agendamento: o horário pedido não está livre (mostra os mais próximos), não há vaga no dia pedido (mostra os mais próximos no mesmo período), o paciente não citou profissional (usa o da última consulta), ou o paciente **já tem consulta** (possível remarcação: desmarque a anterior).

Ligue em **Ajustes > Inteligência artificial > Agendar pelo pedido com IA** e escolha **até quantos dias à frente** procurar (7 a 60, padrão 21). A permissão necessária é a de marcar consultas (`agenda.editar`).

**O que vai para a IA:** as últimas 8 mensagens (sem notas internas e **sem o nome do paciente**), com CPF, cartão, e-mail e telefone ocultados. Vão também os nomes e as especialidades dos profissionais, os serviços mais usados e o calendário. A IA usa o modelo leve (`GEMINI_CLASSIFY_MODEL`), com o principal de reserva.

**Plano B (pedido lido pelas regras, sem enviar nada para fora):**
| Situação | O que acontece |
| --- | --- |
| IA desligada ou sem chave | Regras: "hoje", "amanhã", "depois de amanhã", dia da semana, "semana que vem", "dia 23", "23/10", "de manhã", "à tarde", "à noite", "às 15h", "depois das 18h", "antes das 10h", "com a Dra. Beatriz", "doutora Helena", serviço citado |
| IA lenta, instável ou com resposta inválida | Regras, com o motivo visível no agendamento |
| IA com menos de 40% de certeza | Regras ("a IA ficou com pouca certeza") |
| Conversa com sinal de urgência | Não vai para a IA |
| Mais de 30 leituras com IA em 10 min pela mesma pessoa | Regras até o limite liberar |
| Falha geral | Abre o agendamento normal (ninguém fica travado) |

**Medição:** cada leitura fica em `ai_schedule_suggestions` (migração 0017, com isolamento por clínica). Ao confirmar, o sistema guarda se virou consulta e **se o horário escolhido era um dos sugeridos**. O cartão em Ajustes mostra esses números dos últimos 7 dias.

**Arquivos:** regras puras em `packages/core/src/crm/ai-schedule.ts` (com testes); orquestração em `apps/app/src/modules/crm/ai/schedule.ts`; botão em `components/crm/inbox/ScheduleFromChat.tsx`; diálogo em `components/shell/ScheduleDialog.tsx`.

### Relacionamento com IA (Gemini): próximo passo, perdas, cadastro, duplicados, etiquetas, retorno e melhor horário

Sete funções independentes, **cada uma ligada ou desligada** em **Ajustes > Inteligência artificial**. Todas seguem a mesma regra: **a IA sugere ou escreve; a decisão e o envio continuam com a equipe**. Exceção única: o retorno personalizado (veja abaixo).

**Onde a IA entra e onde não entra (o ponto crítico):**
| Função | Quem decide | O que a IA faz | Sem IA (plano B) |
| --- | --- | --- | --- |
| Próximo passo de cada cartão (Jornada) | Regras (esperando resposta, perguntou valor e sumiu, lead sem resposta há N dias, confirmar consulta, retorno, reativar) | Só **escreve o rascunho** | Rascunho pronto das regras |
| Motivo da perda organizado | IA lê a conversa ao mover para Perdido | Escolhe uma **categoria fixa** (preço, convênio, distância, horário, concorrente, parou de responder, desistiu, insatisfação, outro) e cita o trecho | Palavras-chave + motivo digitado pela equipe |
| Preencher o cadastro pela conversa | A equipe, clicando **Aplicar** | Lê nascimento, convênio e indicação, sempre com o trecho | Regras. **E-mail é sempre lido pelas regras no servidor** (ele é ocultado antes de ir para a IA) |
| Duplicados com IA | A equipe, na tela de comparação | Dá uma opinião (mesma pessoa, família, pessoas diferentes, incerto) | Apelidos (Bia→Beatriz, Zé→José…) + sinais iguais |
| Etiquetas sugeridas | A equipe, clicando **Aplicar** | Só o que depende do tom: "ansioso com procedimento", "decide com a família", "quer resolver rápido", "sensível a preço" | **Contagens**: "prefere áudio", "indica amigos", "sensível a preço", "prefere manhã/tarde", "falta com frequência", "prefere mensagens curtas" |
| Retorno personalizado | Os **limites aprovados pela clínica** (tamanho, tom, citar ou não o procedimento) | Reescreve o texto aprovado pelo último procedimento e pelo histórico | O texto aprovado de sempre |
| Melhor horário de envio | **Estatística**, sem IA | — | Padrão da clínica, depois o horário comercial |

**Proteções contra erro da IA:**
- Trecho citado que **não existe** na conversa é descartado (perda, cadastro, etiquetas).
- Etiquetas só de um **catálogo fechado**: nada de saúde, religião ou situação financeira.
- Data de nascimento impossível ou no futuro é recusada.
- Duplicados: **nascimentos diferentes nunca viram "mesma pessoa"** (unificar errado mistura prontuários), e opinião sem motivo explicado é recusada. A IA recebe só os **dois nomes e sinais sim/não**, nunca o e-mail ou o telefone.
- Rascunho e retorno: recusados se tiverem conteúdo clínico, preço, desconto, promoção, horário ou número que não estavam no contexto, ou link novo. O retorno também é recusado se passar do tamanho aprovado ou citar o procedimento quando a clínica não permitiu.
- Sugestões **nunca mudam a ficha sozinhas**: a ficha só muda com "Aplicar", e isso fica registrado na linha do tempo.

**WhatsApp e a janela de 24h (importante):** fora das 24h desde a última mensagem do paciente, o WhatsApp só aceita o **modelo aprovado**, exatamente como foi aprovado. Por isso:
- o retorno personalizado só troca o texto quando a janela vai estar aberta **na hora do envio**; se não, vai o modelo (o motivo fica registrado);
- **no momento do envio** o sistema confere de novo. Se a janela fechou enquanto a mensagem esperava o melhor horário, volta ao modelo aprovado;
- no "Próximo passo", com a janela fechada não há botão de enviar: o diálogo leva para a conversa, onde se usa um modelo. Texto livre agendado que encontra a janela fechada não sai (fica como "falhou", com o motivo).

**Melhor horário:** a hora em que cada paciente costuma responder, calculada das mensagens dele nos últimos 6 meses. Para quem escreveu pouco, mistura com o padrão da clínica. Fica sempre dentro da janela de envio configurada (padrão 8h às 20h, sábado opcional). Aparece no painel da conversa ("Costuma responder…"), no botão "Enviar …" do Próximo passo e, se ligado, agenda os lembretes de retorno.

**Quando roda:** perda, cadastro, etiquetas e retorno entram numa fila (`ai_jobs`) processada logo depois da ação e pela rotina `/api/cron/despachar`, com até 3 tentativas.
- **Cadastro**: só quando a mensagem tem pista (@, "nasci", convênio, "me indicou"…).
- **Etiquetas**: só com 5 mensagens novas do paciente desde a última análise, no máximo 1 por dia. O botão **Analisar conversa** força uma análise.

**Banco (migração 0021, com isolamento por clínica):**
- `contacts.insurance` e `contacts.referred_by`;
- `messages.send_after`;
- `ai_jobs`, `loss_reasons`, `contact_suggestions` e `duplicate_reviews`.

**Arquivos:**
- regras puras (com testes) em `packages/core/src/crm/`: `next-step.ts`, `loss-reason.ts`, `profile-extract.ts`, `duplicate-review.ts`, `behavior-tags.ts`, `return-message.ts` e `best-time.ts`;
- servidor em `apps/app/src/modules/crm/ai/jobs.ts`, `ai/insights.ts` e `ml/best-time.ts`;
- telas em `components/crm/journey/NextStepDialog.tsx`, `components/crm/inbox/ProfileSuggestions.tsx` e `components/crm/patients/DuplicateOpinion.tsx`.

### Regra em português, respostas sugeridas e auditoria de atendimento (Gemini)

São três funções, cada uma ligada e desligada em **Ajustes > Inteligência artificial**.

**1. Criar regra de automação escrevendo em português** (Automações > Regras da clínica > "Descreva a regra")

"Quando alguém pedir orçamento e não marcar em 2 dias, crie tarefa para a Paula" vira:
- **Quando:** o paciente mandou mensagem com "orçamento, valor, preço, quanto custa";
- **Espera:** 2 dias;
- **Se:** não tem consulta marcada;
- **Então:** criar tarefa para Paula Nogueira.

A regra abre **montada no construtor**, com "o que foi entendido" e os avisos. **Nada é salvo nem ligado** sem clicar em "Criar e ligar regra".

Proteções:
- A IA só usa códigos do catálogo do construtor. Gatilho, condição, etapa ou ação que não existem são descartados.
- Pessoa que não está na equipe vira "responsável do contato", com aviso.
- Mensagem ao paciente **nunca** sai marcada como "modelo aprovado pela Meta": quem marca é a clínica, por causa da janela de 24h.
- Mensagem com preço, desconto ou orientação de saúde é recusada.
- Condições que se contradizem ("tem" e "não tem" consulta) são recusadas.
- A espera máxima é de 90 dias.
- "Mudou de etapa" com espera ganha a condição "ainda está na etapa".
- **Motor das regras (vale para todas):** se já existe uma execução **esperando** da mesma regra para o mesmo contato, o gatilho repetido não enfileira de novo. Um paciente que perguntou "valor" três vezes recebe uma tarefa, não três.
- Para a IA vão só a frase, os nomes da equipe e as etiquetas. O limite é de 20 pedidos à IA a cada 10 minutos por pessoa.
- **Plano B:** as regras do CRM entendem os pedidos mais comuns: orçamento, falta, cancelamento, nota da pesquisa, contato novo, mudança de etapa, pedido para sair, urgência, mensagem com palavra, "não marcar/responder em N dias", tarefa para alguém, etiqueta, mover etapa e avisar.
- Faixa da nota em qualquer posição da frase: "a nota da pesquisa for menor que 7" (0 a 6), "9 ou mais", "entre 7 e 8", "nota baixa". Prazo ("em até 2 dias") não é confundido com nota. Os textos-padrão seguem a faixa: nota baixa vira "Ligar para…", nota alta vira agradecimento.

**2. Respostas rápidas sugeridas** (Ajustes > Respostas rápidas > "Sugeridas pela repetição")

A **estatística** acha o que a equipe digitou várias vezes (padrão: 5 vezes em 3 conversas diferentes, nos últimos 90 dias). O nome do paciente vira `{{primeiro_nome}}` e o nome da clínica vira `{{clinica}}`. A **IA** junta as variações num texto limpo e sugere atalho e título.

Proteções:
- Número, endereço ou valor que não estava nas variações = texto da IA recusado; vai a variação mais usada (plano B).
- Grupo com dado pessoal (CPF, telefone, e-mail) ou orientação de saúde nunca vira sugestão. Por isso o telefone da clínica escrito no texto também barra a sugestão: prefira colocar o telefone no atalho depois.
- A IA marca como "não útil" o que é específico de um paciente ("seu exame ficou pronto").
- Texto parecido com um atalho que já existe não é sugerido de novo. Descartado também não volta.
- Só vira atalho com **"Criar atalho"** (abre o formulário para editar antes).

A busca roda 1 vez por semana pela rotina, ou no botão "Procurar agora".

**3. Auditoria de atendimento por amostragem** (menu **Qualidade**)

Toda semana, algumas conversas sorteadas (padrão: 10), **divididas entre as pessoas da equipe**, recebem nota de 0 a 10:

| Critério | Quem mede | Peso |
| --- | --- | --- |
| Tempo de resposta | O sistema, contando **só os minutos úteis** (o horário de "Fora do horário"), exatos | 30% |
| Cordialidade | IA (sem IA: cumprimento, nome, agradecimento, despedida) | 30% |
| Ofereceu horário a quem quis marcar | Regras + IA (vale "sim" se qualquer um achar) | 25% (só quando se aplica) |
| Clareza | IA | 15% |

Cada avaliação traz um ponto forte, uma dica e um trecho do que a **atendente** escreveu.

**Sem expor o paciente:**
- a IA recebe só as falas, com o nome do paciente trocado por `[paciente]` e CPF, cartão, e-mail e telefone ocultados (sem datas e horários);
- a tela não mostra nome, telefone nem link para a conversa;
- mensagens automáticas não contam como atendimento;
- conversa com sinal de urgência não vai para a IA.

Quem vê o quê:
- a **Gestão** (nova permissão "Qualidade do atendimento", `qualidade.ver`) vê toda a equipe e pode clicar em "Auditar agora";
- cada pessoa vê **só as próprias** avaliações, se a opção "Cada pessoa vê as próprias avaliações" estiver ligada.

A rotina completa a amostra da semana em lotes de 8 conversas, por causa do limite de 60 s da rotina.

> **Ponto crítico (LGPD e relação de trabalho):** a pessoa avaliada também é titular de dados. Avise a equipe de que a amostragem existe e para que serve. Use as notas como conversa de treino, nunca como critério automático de punição.

**Banco (migração 0022, com isolamento por clínica):**
- `ai_rule_drafts`: pedidos e se viraram regra;
- `quick_reply_suggestions`;
- `service_audits`;
- permissão `qualidade.ver` ligada para a Gestão.

**Arquivos:**
- regras puras (com testes) em `packages/core/src/crm/`: `rule-from-text.ts`, `quick-reply-mining.ts` e `service-audit.ts`;
- servidor em `apps/app/src/modules/crm/ai/`: `rule-text.ts`, `quick-replies.ts` e `audit.ts`;
- telas: `configuracoes/automacoes/AutomationsWorkspace.tsx` ("Descreva a regra"), `configuracoes/respostas/ReplySuggestions.tsx` e `crm/qualidade/page.tsx`.

### Anexos nas conversas (foto, áudio, vídeo, PDF, documentos)

Pacientes mandam foto de exame, receita, comprovante e áudio, e a clínica manda pedido de exame e orientação em PDF. Os anexos funcionam nos dois sentidos, nos 4 canais.

**Na conversa:**
- imagem aparece em miniatura e abre inteira em outra aba;
- áudio e vídeo tocam no próprio navegador;
- PDF abre; Word, Excel e foto HEIC de iPhone são para baixar;
- enquanto o arquivo é recebido, aparece "Recebendo..."; se não deu, aparece o motivo.

**Para enviar:** clique em **Anexar** ao lado da mensagem. O texto vira a legenda.
- No WhatsApp e no Telegram vai como legenda; no Messenger e no Instagram, numa segunda mensagem.
- Fora da janela de 24h do WhatsApp, anexo não sai (só modelo aprovado), como texto livre.
- Notas internas não levam anexo.

**Simulador:** campo **Anexo (opcional)**. A mensagem pode ser só texto, só arquivo ou os dois. O arquivo entra no formato oficial de cada provedor e passa pelo mesmo caminho do canal real: leitura do webhook, fila, download e conferência do tipo.

**Segurança (o ponto crítico: é dado de saúde):**
- **Tipo pelo conteúdo, nunca pelo nome.** Os primeiros bytes do arquivo dizem o que ele é. Lista fechada: JPG, PNG, WebP, GIF, HEIC, PDF, áudio (OGG, MP3, M4A, WAV, AAC, AMR), vídeo (MP4, MOV), Word, Excel e PowerPoint.
  - SVG e HTML (podem levar script), executáveis e ZIP genérico são recusados.
  - Testado: um executável renomeado para "exame.pdf" e um SVG com script renomeado para "foto.png" foram recusados e não foram guardados.
- **Limite de 16 MB** por arquivo, conferido no navegador (antes de subir) e no servidor.
- **Armazenamento privado, sem link público.** Todo arquivo passa por `/api/anexos/<id>`, que confere login, permissão de ver conversas e clínica a cada acesso.
  - Outra clínica recebe 404; sem login, 401.
  - A resposta leva o tipo real, `nosniff`, `Cache-Control: private, no-store` e, menos no PDF, `Content-Security-Policy: sandbox`.
  - Aceita pedidos parciais (Range), que o Safari exige para tocar áudio e vídeo.
- **Nomes:** o nome original é limpo e mostrado, mas a chave no armazenamento é `clinics/<clínica>/anexos/<ano>/<mês>/<id>`, sem nome do paciente nem do arquivo.
- **Recebimento fora do webhook:** o webhook grava a mensagem e responde na hora. O arquivo é baixado depois, com até 5 tentativas (pela rotina, se o provedor falhar). A Meta não reenvia por demora.
- **Anexos nunca vão para a IA.**
- **LGPD:**
  - a exclusão de dados a pedido do paciente apaga os arquivos também;
  - a cópia de dados lista os anexos;
  - um **gatilho do banco** põe na fila de remoção o arquivo de QUALQUER ficha de anexo apagada (exclusão, cascata, unificação de cadastros), e a rotina repete se o armazenamento falhar. Nenhum arquivo fica órfão.

**Configuração do armazenamento** (`.env.example`):
- **Desenvolvimento:** `STORAGE_DRIVER=local`, que grava em `apps/app/.data/anexos`, fora do Git.
- **Produção (AWS S3):**
  - `STORAGE_DRIVER=s3` e `S3_BUCKET`;
  - `S3_REGION=sa-east-1` (São Paulo), para os dados ficarem no Brasil;
  - criptografia no servidor sempre ligada (AES-256, ou KMS com `S3_KMS_KEY_ID`).
- **Recomendações para o bucket:**
  - "Block all public access" ligado;
  - política do IAM só com `s3:PutObject`, `s3:GetObject` e `s3:DeleteObject` nesse bucket;
  - versionamento com regra de expiração curta para versões antigas (senão o arquivo "apagado" fica na versão anterior);
  - antivírus para arquivos que chegam, como o GuardDuty Malware Protection for S3.
- Sem armazenamento configurado em produção, os anexos ficam desligados com aviso (texto continua funcionando).
- Na Vercel, `local` é recusado: o disco de lá é temporário.

**Testado:**
- simulador com e sem anexo nos 4 canais;
- envio pela clínica (PDF com legenda e imagem sem texto);
- arquivos maliciosos recusados, limite de 17 MB barrado;
- bloqueio por clínica e por login;
- Range;
- exclusão LGPD apagando os arquivos;
- driver S3 contra um servidor S3 de teste: criptografia AES-256 confirmada, leitura, envio e remoção.

**Banco:**
- migração 0026: `message_attachments`, com isolamento por clínica;
- migração 0027: fila `storage_deletions` e o gatilho.

**Arquivos:**
- regras puras (com testes) em `packages/core/src/crm/attachments.ts`;
- canais em `packages/channels/src/` (`meta.ts`, `telegram.ts`, `media.ts`), com testes;
- armazenamento em `apps/app/src/modules/crm/files/storage.ts`;
- serviço em `files/attachments.ts`;
- rota `app/api/anexos/[id]/route.ts`;
- telas em `components/crm/inbox/Attachments.tsx`, `Composer.tsx` e `components/shell/Simulator.tsx`.

**Próximo passo sugerido:** levar uma foto ou PDF de exame da conversa para o prontuário (módulo PEP), em vez de deixá-lo só no CRM.

### Esqueci minha senha (recuperação por e-mail)

Na tela de login, **Esqueci minha senha** leva para `/login/esqueci`. A pessoa informa o e-mail
e recebe um link para criar a nova senha.

Regras de segurança:

- **Resposta sempre igual.** Exista a conta ou não, a mensagem e o tempo de resposta são os mesmos
  (o envio acontece depois da resposta). Ninguém descobre quais e-mails têm acesso testando o formulário.
- **Link de uso único, válido por 30 minutos.** O token tem 256 bits e o banco guarda só o hash.
  Um pedido novo cancela o anterior. Trocar a senha em Minha conta, a gestão gerar uma senha
  temporária ou desativar o acesso também cancelam o link pendente.
- **O token não vaza.** Ele vai depois do `#` no link, então não aparece em log de servidor. A página
  tira o token da barra de endereço assim que o lê e usa `no-referrer`. O endereço do link vem de
  `APP_URL`, nunca do cabeçalho da requisição, para que um cabeçalho forjado não leve o link para
  outro site.
- **Limites por hora:** até 3 envios para o mesmo e-mail (acima disso não envia mais, para não lotar
  a caixa de ninguém, e a resposta continua igual) e até 10 pedidos por aparelho. O IP e o e-mail
  ficam guardados só como hash.
- **Depois da troca:**
  - todos os aparelhos conectados são desconectados;
  - o bloqueio por tentativas erradas é limpo;
  - chega um e-mail **"Sua senha foi alterada"**, que também é enviado quando a senha muda em
    Minha conta.
- **A verificação em duas etapas continua valendo.** Quem só tem acesso ao e-mail não entra sem o
  celular, e a pessoa não fica conectada automaticamente depois da troca.
- **Conta desativada não recebe link.**
- Os e-mails não levam dado de paciente nem imagens remotas.

**Provedor de e-mail com plano B.** `EMAIL_DRIVER` define o principal e `EMAIL_FALLBACK` o reserva.
Se o principal falhar (fora do ar, cota esgotada ou credencial errada), o mesmo e-mail sai pelo
reserva. Se os dois falharem, a falha fica registrada como `auth.email_failed` na atividade da
clínica, e a tela já orienta a pessoa a pedir a senha à gestão.

| Variável | Uso |
| --- | --- |
| `EMAIL_DRIVER` | `ses` (Amazon SES, recomendado), `resend` ou `arquivo` (só desenvolvimento: grava em `apps/app/.data/emails`) |
| `EMAIL_FALLBACK` | Provedor reserva (o outro dos dois acima) |
| `EMAIL_FROM` | Remetente, ex.: `EcoSaúde <nao-responda@seudominio.com.br>` (domínio verificado no provedor) |
| `APP_URL` | Endereço público do CRM, com `https://` (obrigatório em produção) |
| `SES_REGION` | Padrão `sa-east-1` (São Paulo) |
| `RESEND_API_KEY` | Chave do Resend, se for usá-lo |

Sem provedor configurado em produção, o link **Esqueci minha senha** some e volta a aparecer
"peça para a gestão redefinir" (o caminho que já existia).

**Configurando o Amazon SES:**

1. Na AWS, em SES na região São Paulo, verifique o domínio e publique os registros DKIM no DNS.
   Configure também SPF e DMARC no domínio, para os e-mails não caírem no spam.
2. Peça a saída do *sandbox* (production access). Até lá, o SES só envia para endereços verificados.
3. Dê ao usuário da AWS só a permissão `ses:SendEmail`, se possível restrita à identidade do domínio.
4. Na Vercel, preencha `EMAIL_DRIVER=ses`, `EMAIL_FROM`, `APP_URL` e as credenciais da AWS. Para o
   reserva, crie uma conta no Resend e preencha `EMAIL_FALLBACK=resend` e `RESEND_API_KEY`.

Código:

- `lib/email/index.ts`: provedores e plano B;
- `lib/email/templates.ts`: os dois e-mails;
- `lib/auth/recovery.ts`: as ações;
- `lib/auth/recovery-core.ts`: limites, cancelamento e aviso;
- telas em `app/(auth)/login/esqueci` e `app/(auth)/login/nova-senha`;
- migração `0028`: tabelas `password_resets` e `auth_throttle`. Só o login acessa essas tabelas;
  o papel da clínica não as enxerga.

### Fuso horário por clínica

Cada clínica tem o seu fuso, escolhido em **Ajustes > Clínica**. Seguem o horário local da clínica:
- agenda e horários livres;
- confirmações e lembrete "no dia";
- aniversários e radar de retornos;
- "melhor horário" de envio e horário de atendimento;
- resumo da manhã e auditoria (tempo contado só no expediente);
- relatórios "do dia".

**Como funciona:**
- A lista tem só os **fusos do Brasil**, com o nome oficial por região (`America/Manaus`, `America/Cuiaba`...), e não "UTC−4". Se o horário de verão voltar, ele volta só em alguns estados: com o nome por região, basta atualizar a base de fusos do Node e do PostgreSQL, sem mexer em código nem em cadastros. O banco recusa fuso fora da lista.
- Ao digitar a **UF**, o fuso do estado é sugerido. Clínica nova criada no backoffice já nasce com o fuso do estado.
- Clínicas já cadastradas receberam o fuso pelo estado (migração 0025). As que estão em Brasília ficaram iguais.

**Trocar o fuso (ponto crítico):** as consultas ficam gravadas como instantes (UTC). Uma clínica de Manaus que usava Brasília marcou "14:00" pensando em Manaus, mas o sistema gravou 14h de Brasília. Por isso, ao trocar, a opção **"Manter o horário das consultas já marcadas" vem ligada**: as consultas futuras continuam às 14:00, agora no novo fuso. Desligada, mantém o instante e o horário mostrado muda (14:00 de Brasília vira 13:00 em Manaus).
- Tudo numa transação.
- A troca fica na trilha da clínica: fuso antes e depois, e quantas consultas foram ajustadas.
- Lembretes já enviados não mudam.

**Por dentro (para quem mantiver o código):**
- As funções de data do núcleo (`todayIso`, `formatWhen`, horários livres...) usam o fuso da clínica sozinhas, por `clinicTimeZone()`. Nenhuma chamada precisa passar o fuso.
- O fuso é encontrado em três camadas:
  1. **Transações e rotinas:** `withTenant` e `withClinicTimeZone` abrem um contexto com começo e fim (AsyncLocalStorage `run()`). O cron, os webhooks e as filas de IA rodam o trabalho de cada clínica no fuso dela.
  2. **Telas, ações e rotas de API:** a autenticação liga o fuso ao objeto da requisição do Next.js (`apps/app/src/lib/clinic-tz.ts`).
  3. **Componentes filhos da página:** `cache()` do React.
- **SQL:** cada transação faz `SET LOCAL TimeZone` com o fuso da clínica. Assim `::date`, `to_char()` e "hoje" no banco também seguem o horário local.
- **No navegador** não há contexto de requisição: componentes que formatam horário recebem o fuso por parâmetro (ex.: "Volta às" da lista de conversas).
- **Não use `AsyncLocalStorage.enterWith`.** Testado no Next.js: além de não valer para quem chamou, deixava um contexto antigo "grudado" que outra requisição herdava. A camada 2 usa o armazenamento interno de requisição do Next; se uma versão futura mudar esse caminho, o teste de fuso acusa.
- O **backoffice** (equipe da plataforma) continua em Brasília.

**Testado:**
- duas clínicas (Manaus e Brasília) com 90 requisições simultâneas e 1.080 horários livres, nenhum no fuso errado;
- "marcar 10:00" em Manaus grava 14:00 UTC e a agenda mostra 10:00;
- trocar o fuso e voltar preserva o horário de relógio das consultas.

Arquivos:
- núcleo: `packages/core/src/crm/timezones.ts`;
- contexto: `packages/db/src/index.ts`;
- requisição: `apps/app/src/lib/clinic-tz.ts`;
- tela: `configuracoes/forms.tsx` (`ClinicProfileForm`).

### Pedidos do titular (LGPD): cópia e exclusão dos dados

**Cópia dos dados** (ficha > Dados pessoais > Exportar): baixa um arquivo com tudo o que a clínica guarda, inclusive o que o sistema **concluiu** sobre o paciente (motivo da perda, resumos e sentimento lidos pela IA, sugestões para a ficha, tarefas). Cada exportação vira um pedido de acesso **atendido**, com protocolo.

**Exclusão**, em duas etapas (ninguém apaga um paciente sozinho):
1. A **recepção** registra o pedido na ficha e informa por onde chegou. Sai um protocolo (`LGPD-2026-00001`) e o prazo de **15 dias**.
2. A **gestão** (nova permissão "Excluir dados a pedido do paciente", `pacientes.anonimizar`) confere a identidade, digita o nome completo e apaga. Ou **recusa** por um motivo de uma lista fechada: identidade não confirmada, obrigação legal de guardar, quem pediu não é o titular, pedido repetido.

Com o paciente na recepção, a gestão pode atender na hora ("Apagar agora"): o pedido é registrado junto.

**O que a exclusão faz (anonimização, numa única transação: tudo ou nada):**
| Some | Fica, sem identificar ninguém |
| --- | --- |
| Nome (vira "Paciente anonimizado"), telefone, e-mail, nascimento, convênio, indicação, etiquetas, motivo de perda digitado | Data, profissional, serviço e status das consultas (relatórios e modelos de risco) |
| Texto de todas as mensagens e os identificadores dos canais | Direção e horário das mensagens (tempo de resposta da equipe) |
| Anotações, conteúdo da linha do tempo, tarefas em aberto (concluídas ficam sem o texto) | Notas da pesquisa de satisfação |
| Resumos, sentimentos, rascunhos, promessas e sugestões da IA; trechos citados na perda e na auditoria | Categoria da perda e notas da auditoria da equipe |
| Lista de espera, automações pendentes e **mensagens que ainda estavam na fila** | O registro do pedido (protocolo, datas, quem executou), sem nome nem telefone |

Regras:
- Com **consulta marcada**, a exclusão é bloqueada até desmarcar.
- A ficha anonimizada some da lista de contatos, da busca, da jornada, do radar de retornos e da procura de duplicados, e não pode ser unificada.
- Se a pessoa escrever de novo, nasce um **contato novo**, sem ligação com o antigo.
- O registro guarda só um **código (HMAC)** do telefone ou e-mail. Ele permite conferir depois se um número já pediu exclusão, sem guardar o número. O segredo fica em `LGPD_HASH_SECRET`: gere uma vez (`openssl rand -hex 32`) e **nunca troque**.
- A lista de pedidos, com prazo e atrasos, fica em **Contatos > Pedidos LGPD**, só para quem decide.

**O que o sistema NÃO apaga (e precisa estar na política de privacidade da clínica):**
- O **prontuário**, quando existir: a Lei 13.787/2018 obriga a guardar por 20 anos, e a LGPD (art. 16, I) permite manter dado por obrigação legal.
- As mensagens no celular do paciente e nos servidores do WhatsApp/Meta.
- As **cópias de segurança** do banco: expiram no prazo de retenção configurado no provedor (defina um prazo curto, como 7 a 30 dias).
- Dados que o Google tenha registrado nos logs do projeto Gemini (desligue os logs; veja abaixo).
- Uma decisão para o jurídico da clínica: as **anotações internas** da equipe hoje ficam fora da cópia de dados. A LGPD dá acesso a todos os dados pessoais; vale avaliar se entram, com revisão de opinião de terceiros.

**Banco:**
- migração 0023: `privacy_requests`, `contacts.anonymized_at` e a permissão nova;
- migração 0024: as travas.

**Arquivos:**
- regras puras em `packages/core/src/crm/privacy.ts`, com testes;
- anonimização em `apps/app/src/modules/crm/privacy.ts`;
- ações em `modules/crm/actions/privacy.ts`;
- telas em `components/crm/patients/PrivacyPanel.tsx` e `crm/contatos/privacidade/page.tsx`.

### Gemini com dados reais (checklist)

1. **Projeto pago:** faturamento ativo no projeto do Google onde a chave foi criada. No servidor: `GEMINI_API_KEY=...` e `GEMINI_PAID_TIER=sim`.
2. **Logs desligados:** no Google AI Studio, desligue o registro de conversas do projeto, ou deixe a retenção no mínimo (7 dias). Com logs ligados, o Google guarda as conversas por até 55 dias, sem usá-las para treinar.
3. **Transferência internacional:** a API processa fora do Brasil. Para os EUA, a Resolução CD/ANPD 19/2024 exige as cláusulas-padrão contratuais da ANPD (prazo de adoção encerrado em 23/08/2025). Confira com o jurídico se o termo de tratamento de dados do Google cobre isso. Se precisar de processamento com região controlada, avalie o Vertex AI.
4. **Transparência:** a política de privacidade da clínica deve dizer que um fornecedor de IA apoia o atendimento.
5. **Teste:** em Ajustes > Inteligência artificial, clique em "Testar a IA". Chave inválida, modelo indisponível ou falta de `GEMINI_PAID_TIER` aparecem com o motivo.

Modelos (dá para trocar pelo `.env`, sem mexer no código):
- **principal:** `gemini-3.8-flash`, o Flash estável recomendado pelo Google em out/2026;
- **reserva e classificação:** `gemini-3.5-flash-lite`.

### Contatos

Endereço: `/crm/contatos` (o antigo `/crm/pacientes` redireciona para cá). Filtros na URL, por exemplo
`?tipo=lead&segmento=novos&origem=instagram&ordem=recentes`.

- **Lead x paciente:** paciente é quem já compareceu a ao menos uma consulta; lead é quem ainda não.
  A barra "Leads | Pacientes" do topo mostra a proporção e filtra com um toque.
- **Números da base:** novos em 30 dias, sem consentimento LGPD e aniversariantes do mês (clique filtra).
- **Busca ao digitar** (nome, celular ou e-mail, sem acento; tecla /).
- **Filtros:** etapa (com contagem), segmentos prontos (aniversariantes, novos, com consulta marcada,
  sem contato há 90 dias, faltaram 2+ vezes, sem consentimento, pediram SAIR), canal, origem,
  etiqueta e responsável. Cada filtro ativo vira uma pílula removível.
- **Tabela ou cartões**, densidade e **colunas à escolha** (salvo no navegador); 30, 60 ou 100 por página.
- **Ações em lote:** adicionar/remover etiqueta, definir responsável, mudar etapa (Perdido pede motivo).
- **Ações rápidas na linha:** abrir conversa, agendar, copiar celular, abrir ficha.
- **Exportar planilha (CSV):** só a gestão; até 5.000 linhas do filtro atual ou dos selecionados.
  Abre direto no Excel (separador ";" e acentos). Cada exportação fica registrada (LGPD).

### Hoje

Painel de trabalho do dia (`/hoje`), que se atualiza sozinho a cada 30 segundos.

- **Números do dia:** consultas (com anel de progresso), conversas esperando resposta, confirmações de
  amanhã, horários livres e novos contatos. Cada número leva ao quadro certo ou à tela completa.
- **Régua do dia:** uma linha do tempo por profissional com expediente, intervalo, consultas (cor da
  situação), horários livres tracejados (clique para agendar) e a linha vermelha do agora. No celular
  rola para os lados, com o nome do profissional fixo.
- **Recepção ao vivo:** placar (atendidos, faltas, a chegar), **atrasados** (10 min sem "Chegou") com
  Chegou/Faltou em um toque, quem está **em consulta** e os **próximos** com contagem regressiva e
  dicas (1ª consulta, sem confirmação, risco de falta). Clique abre a consulta completa.
- **Fila de ações:** urgências, quem espera resposta (anel de espera), risco de falta, confirmar amanhã
  em lote, tarefas (atrasadas sinalizadas, "só minhas tarefas") e retornos, com filtros por tipo.
- **Amanhã:** confirmadas, aguardando e sem pedido, com pedido de confirmação em lote.
- **Horários livres hoje:** por profissional, com quantos da lista de espera servem em cada horário.
- **Aniversariantes** e **Pulso da semana** (comparecimento, faltas, novos contatos e satisfação).
- **Personalizar** (salvo neste navegador): modelos **Recepção** e **Gestão**, mostrar/ocultar,
  ordenar, trocar de coluna, recolher quadros e modo compacto.
- Dia sem consultas (domingo, feriado): mostra o próximo dia com consultas.

### Conversas

Endereço: `/crm/conversas` (filtros na URL: `?filtro=sem_dono&canal=whatsapp&ordem=recentes&q=ana`).

- **Fila:** urgências primeiro; depois maior espera ou mais recentes (botão de ordem). No topo, o
  medidor da **meta de 1ª resposta** (15 min): quantas passaram da meta e a espera mais antiga.
- **Filtros:** Esperando, Abertas, Minhas, Sem responsável, Adiadas e Resolvidas, com contagem; canal.
- **Ações em lote:** "Selecionar" e marque várias para assumir, resolver, adiar ou transferir de uma vez.
- **Conversa:** abre já na mensagem mais nova; mensagens seguidas agrupadas; "Novas mensagens" quando
  você está lendo mais acima; copiar texto; **buscar dentro da conversa** com destaque.
- **Adiar** por 1 h, 2 h, 4 h ou 1 dia (volta para a fila sozinha). **Resolver e ir para a próxima.**
- **Rascunhos:** o texto não enviado fica guardado por conversa neste navegador; a lista mostra "Rascunho".
- **Painel com abas:** Assistente (intenção, respostas sugeridas, agenda, janela de 24h com contagem
  regressiva), Paciente (contato, etapa, etiquetas, consentimento, comparecimentos e faltas, outros
  canais) e Histórico (linha do tempo). Em telas menores abre em "Detalhes".
- **Personalizar** (salvo neste navegador): densidade, trecho da mensagem, painel ao lado, ir para a
  próxima ao resolver/adiar, Enter ou Ctrl+Enter para enviar.
- **Atalhos:** J/K (ou ↓/↑) próxima/anterior, / buscar, R responder, E resolver, A assumir, F buscar
  na conversa, P painel, ? ajuda.

### Jornada

Endereço: `/crm/jornada`.

- **Funil dos últimos 90 dias:** chegaram, conversaram, marcaram e compareceram, com o percentual de
  cada degrau sobre o anterior; a maior perda fica destacada. Ao lado, **por que perdemos** (motivos).
- **Filtros:** busca por nome ou etiqueta (sem acento), atalhos (parados, esperando resposta, com
  consulta, sem responsável, meus contatos), canal, origem, responsável e etiqueta.
- **Quadro ou lista** (tecla V): no quadro, arraste entre etapas ou use "Mover para"; cada coluna
  mostra quantos estão parados e pode ser recolhida. A lista é uma tabela ordenável.
- **Cartão:** esperando resposta, próxima consulta, dias na etapa (amarelo/vermelho quando parado),
  responsável, origem e etiquetas; ações rápidas: abrir conversa, agendar, criar tarefa, mover.
- **Desfazer** logo depois de mover um cartão.
- **Selecionar:** mover vários de etapa (Perdido pede o motivo) e definir o responsável de uma vez.
- **Personalizar** (salvo neste navegador): densidade, ordem, campos do cartão, funil e etapas visíveis.
- Carrega os 800 contatos que mudaram de etapa mais recentemente.

### Lista de espera

Endereço: `/crm/espera`.

- **Números:** quantos na fila (e com oferta pendente), espera média, % de ofertas preenchidas e
  tempo médio entre a oferta e o "SIM" (últimos 30 dias).
- **Encaixes possíveis:** horários livres dos próximos 7 dias (sem consulta e sem oferta aberta) que
  combinam com alguém da fila (profissional e período), agrupados por profissional e dia. Clique no
  horário para oferecer: a tela já marca os primeiros da fila (até 3).
- **Fila:** posição, profissional e período desejados, dias na fila (alerta a partir de 14), ofertas
  recusadas, oferta aberta com contagem regressiva e aviso de quem **já tem consulta marcada**.
  Busca, filtros (profissional, período, situação) e visão em fila única ou **por profissional**.
- **Ofertas:** abertas (expiram sozinhas; quem não respondeu volta para a fila) e histórico com o
  resultado de cada pessoa; cancelar oferta.
- **Oferecer um horário** qualquer (escolhendo profissional e horário livre) continua no topo.

### Retornos

Endereço: `/crm/retornos?janela=14` (7, 14, 30 ou 60 dias).

- **Números:** na hora de voltar, lembrados sem agendar, lembretes em 90 dias e % que voltou a agendar
  em até 30 dias.
- **Vencimentos:** atrasados há mais de 30 dias, atrasados, vencem nesta semana e depois (clique filtra).
- **No radar:** busca, ordem (mais atrasados, vencem antes, nome), protocolo (clique no cartão do
  protocolo), mostrar ou esconder quem não pode receber (sem consentimento ou SAIR, com o motivo).
  Os atrasados que podem receber já vêm marcados. **Ver mensagem** mostra a prévia de cada protocolo
  com o nome do paciente antes de enviar.
- **Acompanhar:** quem foi lembrado nos últimos 30 dias e ainda não agendou: respondeu (abre a
  conversa) ou sem resposta (cria a tarefa "ligar" em um clique).
- **Protocolos:** regra, situação, quantos estão no radar, lembretes e % que voltou a agendar.

### Tarefas

Endereço: `/crm/tarefas`.

- **Tarefa rápida** (tecla N): escreva e aperte Enter. A data e o responsável saem do texto:
  "Ligar para Ana **amanhã @paula**", "Conferir convênio **sexta**", "Enviar exame **20/10**",
  "Revisar orçamento **em 3 dias**", "**semana que vem**". A tela mostra o que entendeu antes de criar
  (regras em `packages/core/src/crm/tasks.ts`, com testes).
- **Números:** atrasadas, para hoje, próximos 7 dias e concluídas em 30 dias (clique filtra).
- **Carga da equipe:** tarefas abertas e atrasadas por pessoa (clique filtra).
- **Visões:** Lista (atrasadas, hoje, amanhã, próximos dias, depois), **Semana** (um dia por coluna;
  arraste a tarefa para mudar a data) e **Equipe** (uma pessoa por coluna; arraste para trocar o
  responsável). Escopo Minhas, Todas ou Sem responsável; busca, responsável e tipo.
- **Concluir em um toque** (círculo à esquerda) com **Desfazer**; menu **Adiar** (hoje, amanhã,
  próxima segunda, +7 dias ou outra data); editar e excluir.
- **Ações em lote:** concluir/reabrir, adiar, trocar responsável e excluir.
- Visão, escopo e densidade ficam salvos no navegador.

### Agenda

Endereço: `/crm/agenda?data=AAAA-MM-DD&visao=dia|semana|lista` (e `&consulta=<id>` abre uma consulta direto).

- **Visões:** Dia (uma coluna por profissional), Semana (segunda a domingo, uma coluna por dia; com um
  só profissional visível mostra também o expediente e os horários livres) e Lista (boa para ligar
  confirmando). No celular, a visão Dia vira lista + horários livres em botões.
- **Horas à esquerda**, fixas ao rolar; cabeçalho fixo; linha vermelha do "agora"; fora do expediente
  sombreado e intervalo hachurado; a grade abre já rolada para a hora atual (ou a primeira consulta).
- **Arrastar para remarcar:** solte a consulta em outro horário (ou na coluna de outro profissional).
  Abre a confirmação "Remarcar consulta" com de/para, opção de avisar o paciente e, se cair fora do
  expediente, "marcar mesmo assim". Horário ocupado do mesmo profissional é recusado. O horário que
  ficou livre pode ser oferecido à lista de espera ali mesmo.
- **Horários livres:** passe o mouse e clique em "+ HH:MM" para agendar; quando há gente na lista de
  espera para aquele profissional/período, o horário mostra quantos aguardam.
- **Trilho de ocupação** por profissional (percentual ocupado e horários livres) e **mini calendário**
  do mês com a intensidade de consultas por dia.
- **Destaques:** consultas com risco alto de falta, "sem resposta" à confirmação e **1ª consulta**
  (paciente que nunca compareceu). Clique no resumo para destacar; busca por paciente ou serviço
  (ignora acentos; Enter abre a primeira encontrada).
- **Personalizar** (fica salvo neste navegador): densidade (compacta, média, ampla), cor por situação
  ou por profissional, profissionais visíveis, filtro de situação, mostrar canceladas, mostrar horários
  livres e "só expediente" ou dia inteiro (6h às 22h).
- **Pedir confirmação** de todas as consultas do dia que ainda não receberam o pedido.
- **Imprimir:** sai uma lista limpa do período, sem menus.
- **Atalhos:** ← → (período anterior/próximo), T (hoje), D/S/L (dia, semana, lista), N (nova consulta),
  / (buscar).

### Cadastros duplicados

A mesma pessoa costuma chegar por caminhos diferentes (liga, depois escreve no Instagram, depois no
WhatsApp). O CRM trata isso em três pontos:

1. **Ao cadastrar** (inclusive dentro do agendamento): enquanto você digita nome, celular, e-mail e
   nascimento, aparece quem já parece ser a pessoa, com o motivo ("mesmo celular", "nome muito
   parecido"...), e o botão **Usar este**. O servidor confere de novo: só cadastra se a recepção marcar
   "é outra pessoa" (ex.: mãe e filho com o mesmo celular).
2. **Na ficha:** aviso "Este paciente pode ter outro cadastro", com **Comparar e unificar**.
3. **Contatos > Possíveis duplicados:** varre a clínica e lista os pares suspeitos.

Como a comparação funciona (`packages/core/src/crm/duplicates.ts`, com testes):
- **Suspeita forte:** mesmo celular (com ou sem DDI e 9º dígito), mesmo e-mail, ou nome parecido +
  mesma data de nascimento.
- **Suspeita média:** nome muito parecido, ignorando acentos, "de/da/dos", ordem das palavras,
  iniciais ("Ana L. Reis") e grafias ("Luiza/Luisa", "Thiago/Tiago").

**Unificar** junta tudo no cadastro escolhido como principal: conversas (mesmo canal vira uma só,
com todas as mensagens), consultas, lista de espera (fica o lugar mais antigo na fila), tarefas,
pesquisas e linha do tempo. Dados vazios são completados; etiquetas somam; se qualquer um pediu SAIR,
o unificado continua sem mensagens. Tudo numa transação; não dá para desfazer, por isso há confirmação.
"Não é a mesma pessoa" esconde o par para sempre.

### Outras regras do dia a dia

- **Consulta:** duração própria (marcar, remarcar ou editar); aviso, com "marcar mesmo assim", quando
  o horário está fora do expediente/intervalo ou o paciente já tem consulta no mesmo horário;
  "Chegou/Faltou" só a partir de 30 min antes; desfazer "Chegou" corrige última visita e etapa;
  "Faltou" tira de "Agendado" e cria a tarefa de remarcar; cancelamento pode ser desfeito se o
  horário continuar livre; editar serviço/observações/duração.
- **Troca de celular:** o número antigo deixa de receber mensagens na hora. Respostas vão para o
  número de quem escreveu por último, se ele ainda for do paciente.
- **SAIR / VOLTAR:** o paciente pode voltar a receber mensagens enviando VOLTAR, ou a equipe libera
  na ficha (fica registrado quem liberou).
- **Lista de espera:** editar a entrada sem perder o lugar; cancelar oferta; marcar ou remarcar num
  horário oferecido cancela a oferta; ofertas com menos de 20 min de antecedência são recusadas.
- **Conversas:** busca por nome ou telefone, "carregar mais" e transferência para um colega.
- **Equipe:** editar nome e perfil (a clínica nunca fica sem gestor ativo) e desligar a 2 etapas de
  quem perdeu o celular. Se o único gestor ficar sem acesso, o backoffice gera nova senha ou
  desliga a 2 etapas (na página da clínica).

### Testando os canais sem integração (simulador)

1. Entre como gestor e clique em **Simulador de canais** (canto inferior direito).
2. Escolha o canal, o paciente (ou um número novo) e escreva como se fosse ele. Experimente:
   `Quero marcar uma consulta`, `Quanto custa?`, `1` (confirmar), `SIM` (aceitar vaga), `9` (nota), `SAIR`, `VOLTAR`.
3. A mensagem é montada **no formato oficial** (o mesmo JSON que a Meta/Telegram enviam) e passa
   pelo **mesmo leitor e pelas mesmas regras** da integração real. Ligar o canal real é só trocar
   quem entrega a mensagem.

### Isolamento entre clínicas

Cada operação do app da clínica roda com o papel `ecosaude_tenant` e a clínica da sessão
(`withTenant`). O PostgreSQL só devolve e só aceita linhas daquela clínica (Row-Level Security),
mesmo que um código esqueça o filtro. O backoffice usa o dono das tabelas e enxerga tudo.

### Pronto para o modo offline (próxima etapa)

IDs gerados no aparelho (`client_id`) tornam reenvios seguros (não duplicam), e `version` nos
cadastros e consultas detecta edição simultânea ("alterado por outra pessoa"). A fila de envio
já separa gravar de enviar.

## 6. Ligando os canais de verdade

Segredos ficam **só** nas variáveis de ambiente (Vercel ou AWS Secrets Manager), nunca no banco.
Cada clínica informa em **Ajustes > Canais** o identificador da própria conta (número, página, bot):
é por ele que o webhook descobre de qual clínica é a mensagem. O modo **Real** só fica disponível
quando o servidor tem a credencial do canal.

| Canal | Variáveis | URL do webhook |
|---|---|---|
| WhatsApp (Cloud API) | `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | `https://SEU-DOMINIO/api/webhooks/whatsapp` |
| Instagram | `INSTAGRAM_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | `https://SEU-DOMINIO/api/webhooks/instagram` |
| Messenger | `MESSENGER_PAGE_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | `https://SEU-DOMINIO/api/webhooks/facebook` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | `https://SEU-DOMINIO/api/webhooks/telegram?conta=UsuarioDoBot` |

Passo a passo (Meta):

1. Crie um app tipo **Empresa** em developers.facebook.com e adicione WhatsApp, Messenger e/ou Instagram.
2. Gere um token de **usuário do sistema** (não expira) e coloque nas variáveis acima.
3. Em Webhooks, informe a URL, o `META_VERIFY_TOKEN` e assine o campo `messages`.
   O EcoSaúde confere a assinatura `X-Hub-Signature-256` de cada chamada com o `META_APP_SECRET`.
4. Cadastre e aprove na Meta os **modelos** usados fora da janela de 24h (confirmação, retorno,
   retomada de conversa) e marque as respostas correspondentes como "modelo aprovado".
5. Em Ajustes > Canais, informe o ID da conta e troque o modo para **Real**.

Telegram: crie o bot no @BotFather e registre o webhook com
`https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL acima>&secret_token=<TELEGRAM_WEBHOOK_SECRET>`.

> **Ponto de atenção para muitas clínicas:** na Meta, o caminho é a EcoSaúde virar
> **Tech Provider** e usar o *Embedded Signup*: um token do app atende os números de todas as
> clínicas (cada uma só informa o seu ID). No Telegram cada clínica tem o próprio bot, então o
> próximo passo é guardar o token **por clínica** num cofre (AWS Secrets Manager), em vez de uma
> única variável de ambiente. Os adaptadores de envio para a Graph API foram escritos conforme a
> documentação, mas ainda não foram testados contra a API real.

### Rotina agendada

`/api/cron/despachar` reenvia mensagens que ficaram na fila, expira ofertas da lista de espera,
move pacientes para "Para reativar", faz a **confirmação automática**, o **lembrete no dia**, a **mensagem pós-consulta**,
o **aniversário** e executa as **regras da clínica** cuja espera venceu (ex.: "2 dias depois"). Regras "na hora" rodam
logo após a ação da equipe ou a mensagem do paciente, sem esperar a rotina. O `apps/app/vercel.json` agenda a cada 10 minutos e a
rota exige `CRON_SECRET`. No plano Hobby da Vercel o cron roda no máximo uma vez por dia;
para a frequência de 10 minutos é preciso o plano Pro (ou um agendador externo chamando a URL
com `Authorization: Bearer <CRON_SECRET>`). No Hobby, agende a única execução diária para depois
do horário de confirmação da clínica (ex.: `0 14 * * *` = 11h em Brasília), senão a confirmação
automática nunca roda. Lembrete no dia e regras com espera dependem da rotina de 10 minutos.

Para testar localmente: `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3002/api/cron/despachar`.

## 7. Problemas comuns

| Mensagem | Causa e solução |
|---|---|
| `autenticação do tipo senha falhou para o usuário "postgres"` (ou `password authentication failed`) | Há outro PostgreSQL no computador usando a porta do `DATABASE_URL`, ou o volume do Docker foi criado com outra senha. Confira se o `.env` usa a porta **54320** e rode `pnpm db:check`. Se continuar, `pnpm db:reset-local` (apaga os dados locais). |
| `Nenhum PostgreSQL respondeu` / `ECONNREFUSED` | Docker Desktop fechado ou banco não iniciado: abra o Docker e rode `pnpm db:up`. |
| `Can't find meta/_journal.json` | Versão antiga do `migrate.ts` (caminho com acento no Windows). Atualize para a versão atual. |
| Código da 2FA "não confere" | O relógio do computador ou do celular está fora do horário: ative "Definir horário automaticamente" nos dois. Se reativou a 2FA, apague o cadastro antigo do EcoSaúde no aplicativo e use só o QR code novo. |
| `permission denied to grant role "ecosaude_tenant"` ao migrar | O papel do isolamento foi criado por outro usuário do banco. Como administrador: `GRANT ecosaude_tenant TO <seu_usuario> WITH ADMIN OPTION;` e rode a migração de novo. |
| `column ... does not exist` / página "Banco de dados desatualizado" | O código foi atualizado, mas as migrações novas não foram aplicadas. Pare o servidor, rode `pnpm db:migrate` e suba de novo (o `pnpm dev` já faz isso sozinho). |
| `DeprecationWarning: Calling client.query() when the client is already executing a query` | Várias consultas disparadas ao mesmo tempo (`Promise.all`) dentro de `withTenant`, que usa uma única conexão. Use `inSequence([() => ..., () => ...])` do `@ecosaude/db` dentro de transações; `Promise.all` só com `db` (pool). |
| Agenda vazia, sem horários livres | Nenhum profissional cadastrado ou ativo: Ajustes > Clínica. |
| Confirmação automática não envia | Confira em Ajustes > Clínica se está ligada, se já passou do horário escolhido (e antes das 20h), se o plano inclui "Confirmações" e se a rotina agendada está rodando (`CRON_SECRET` e `vercel.json`). |
| Mensagem "Fora da janela de 24h" ao responder | Regra da Meta: o paciente não escreve há mais de 24h. Use uma resposta rápida marcada como modelo aprovado (ex.: `/retomar`). |
| Caracteres estranhos no terminal (`autentica��o`) | Só a codificação do PowerShell; não afeta o projeto. Para corrigir a exibição: `chcp 65001`. |

## 8. Publicar na Vercel

São **três projetos** na Vercel apontando para o mesmo repositório.

1. **Banco:** crie um PostgreSQL gerenciado (ex.: Neon, pela aba Storage da Vercel), na região
   São Paulo quando disponível. Copie a connection string **com pooling** e `sslmode=require`.
2. **Migrações:** do seu computador, aponte para o banco novo e rode:
   ```bash
   DATABASE_URL="postgres://..." pnpm db:migrate
   DATABASE_URL="postgres://..." SEED_ADMIN_PASSWORD="..." pnpm db:seed
   ```
3. **Projeto do site:** Add New, Project, importe o repositório, Root Directory `apps/site`.
   Variáveis: `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`.
4. **Projeto do backoffice:** importe o mesmo repositório, Root Directory `apps/backoffice`.
   Variáveis: `DATABASE_URL`, `TOTP_ENCRYPTION_KEY`.
   Recomendado: ativar Deployment Protection e usar um domínio próprio (ex.: `admin.seudominio.com.br`).
5. **Projeto da clínica (CRM):** Root Directory `apps/app`.
   Variáveis: `DATABASE_URL`, `TOTP_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL` e o e-mail
   (`EMAIL_DRIVER`, `EMAIL_FROM`, ver "Esqueci minha senha") e, quando ligar canais reais,
   as variáveis da seção 6. O cron já está em `apps/app/vercel.json`.
6. Em todos, a Vercel detecta pnpm e Turborepo sozinha. Região das funções: `gru1` (São Paulo).

> Neon e outros bancos gerenciados não dão superusuário: a migração `0005` cria o papel
> `ecosaude_tenant` com o próprio usuário do banco (testado com um usuário sem superusuário).

> `TOTP_ENCRYPTION_KEY` precisa ser a MESMA em todos os ambientes que usam o mesmo banco.
> Se ela mudar, as 2FA já ativadas deixam de funcionar e precisam ser redefinidas.

## 9. Ainda não incluído (próximas etapas)

- Aviso por e-mail para a equipe comercial quando chega um lead.
- Rotina agendada para marcar como encerrados os testes vencidos (o **acesso** já é bloqueado
  automaticamente ao vencer; só o status exibido continua "Em teste" até alguém agir).
- Códigos de recuperação da 2FA (hoje, quem perde o celular pede a um administrador para redefinir).
- Integração com provedor de pagamento e emissão de cobrança.
- CRM antes de produção: teste com os canais reais (piloto).
- Recuperação de senha por e-mail também no backoffice (hoje um administrador redefine a de outro).
- CRM: modo offline (fila local no navegador e sincronização), campanhas segmentadas,
  envio de modelos com variáveis pela API da Meta.
- Testes de ponta a ponta no repositório (os fluxos foram validados com Playwright durante o
  desenvolvimento; as regras do CRM e a leitura dos canais já têm testes unitários).
