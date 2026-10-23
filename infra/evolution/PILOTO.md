# Roteiro do piloto do WhatsApp (Evolution real + celular real)

Este roteiro valida, com o WhatsApp de verdade, o que até agora foi testado só com a Evolution
de mentira dos testes (`apps/app/e2e/evolution-piloto.spec.ts`, que ensaia este mesmo roteiro).
O objetivo é achar o que o WhatsApp real faz **diferente** e transformar os webhooks reais em
fixtures dos testes (sem dados pessoais).

Tempo estimado: 1h30.

## Antes de começar (leia)

- **Use um chip de teste, não o número da clínica.** A conexão por QR code não é oficial.
  Um número novo mandando mensagens pode ser bloqueado pelo WhatsApp, e um bloqueio no número
  real da clínica é difícil de reverter.
- **São dois celulares:**
  - **Celular A** é o "WhatsApp da clínica", com o chip de teste;
  - **Celular B** é o "paciente de teste" (pode ser o seu).
- **Nada de paciente real.** As mensagens do piloto devem ser inventadas. O modo gravação tira
  telefones, nomes e textos, mas o piloto não precisa de dado real nenhum.
- **O celular sem internet não derruba a conexão.** O WhatsApp funciona com vários aparelhos:
  depois de pareado, a Evolution conversa direto com o WhatsApp, mesmo com o celular A desligado
  (por até 14 dias). Por isso a "queda" que importa é a do **servidor da Evolution**, no passo 15.
  O passo 14 só confirma esse comportamento.

## 1. Preparação

### 1.1 Evolution no seu computador (Docker)

```bash
cd infra/evolution
cp .env.example .env
# Edite o .env:
#   AUTHENTICATION_API_KEY=<openssl rand -hex 32>
#   POSTGRES_PASSWORD=<openssl rand -hex 24>
#   EVOLUTION_DOMAIN=localhost          (não é usado no piloto)
#   QRCODE_LIMIT=3                      (só para o passo 18; tire depois)
docker compose -f docker-compose.yml -f docker-compose.piloto.yml up -d evolution postgres redis
docker compose logs -f evolution        # espere "HTTP - ON: 8080"
```

A Evolution fica em `http://localhost:8080`, sem acesso pela internet.

### 1.2 Tropi apontando para ela

Em `apps/app/.env.local`, acrescente:

```bash
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<a mesma AUTHENTICATION_API_KEY>
EVOLUTION_WEBHOOK_SECRET=<openssl rand -hex 32>
# A Evolution (dentro do Docker) chama o Tropi por aqui:
EVOLUTION_WEBHOOK_BASE_URL=http://host.docker.internal:3002
# Modo gravação: cada webhook real vai para esta pasta, SEM dados pessoais
EVOLUTION_CAPTURE_DIR=./.capturas-piloto
```

Depois rode `pnpm dev:app` e entre como gestor em `http://localhost:3002`.

### 1.3 Paciente de teste

Em Atendimento > Contatos, cadastre **"Paciente Teste"** com o número do **celular B**.
Cadastre também um contato **"Sem WhatsApp"** com um número **fixo** (ex.: (51) 3333-0000).

## 2. Roteiro

Em cada passo, marque **OK** ou anote o que aconteceu de diferente. As consultas SQL do fim
ajudam a conferir no banco.

| # | O que fazer | O que deve acontecer no Tropi |
|---|---|---|
| 1 | Ajustes > Canais > WhatsApp > **WhatsApp do celular** > **QR code** > *Gerar QR code*. No celular A: WhatsApp > Aparelhos conectados > Conectar aparelho > ler o QR. | Em até 5 s: "WhatsApp conectado: +55 …". O aviso vermelho some. O QR troca sozinho a cada ~30 s enquanto ninguém lê. |
| 2 | *Desconectar*. Depois **Código no celular**, com o número do celular A, e *Gerar código*. No celular A: Aparelhos conectados > Conectar aparelho > **Conectar com número de telefone**, digite o código. | O código aparece em 8 letras. **Atenção:** ele muda sozinho a cada ~30 s (a Evolution gera um novo com cada QR); a tela mostra sempre o mais recente. Use o que estiver na tela na hora de digitar. Conecta em até 5 s. |
| 3 | Celular B manda "Oi, quero marcar consulta". | Aparece em Conversas, com o nome do contato cadastrado. |
| 4 | Celular B manda uma **foto com legenda**. | Mensagem com a legenda; a foto aparece em até 30 s (o Tropi baixa depois). |
| 5 | Celular B manda um **PDF** (com e sem legenda). | "[documento: nome.pdf]" ou a legenda; o PDF abre. |
| 6 | Celular B manda uma **nota de voz** (segure o microfone). | "[áudio]" e o áudio toca no navegador. |
| 7 | Celular B manda um **vídeo curto** e uma **figurinha**. | Vídeo toca; figurinha aparece como imagem. |
| 8 | Celular B manda **localização** e um **contato**. | "[localização]" e "[contato]". |
| 9 | Celular B **reage** a uma mensagem, **edita** uma mensagem e **apaga** outra "para todos". | Hoje o Tropi ignora reação, edição e apagada (item da checklist "wa-apagada"). Anote o que aparece. |
| 10 | No Tropi, responda o paciente com **texto**. | Chega no celular B. Em Conversas: enviada > entregue (2 tiques) > lida (azul), quando B abrir a conversa. Se B desligou a confirmação de leitura, fica em "entregue". |
| 11 | No Tropi, responda com **foto**, **PDF** e **áudio .ogg** (anexo). | Chegam no celular B; o .ogg chega como **nota de voz**. A foto chega em JPG (a Evolution converte). |
| 12 | No celular A, responda o celular B direto pelo WhatsApp. Depois mande do celular A uma mensagem para um número que **não** está no Tropi. | A primeira aparece em Conversas com "Enviada pelo celular". A segunda **não** aparece e não cria contato. |
| 13 | No Tropi, mande mensagem para o contato **"Sem WhatsApp"** (precisa da janela aberta ou de um modelo). | A mensagem falha com "Este número não tem WhatsApp. Confira o telefone do contato." |
| 14 | Celular A em **modo avião** por 2 min; o celular B manda mensagem; o Tropi responde. | **Esperado: tudo continua funcionando** (vários aparelhos). Anote se algo atrasou. |
| 15 | `docker compose restart evolution`. Durante o reinício, responda no Tropi. | A mensagem fica na **fila** ("Servidor da Evolution fora do ar"). Na volta (~20 s) a Evolution deve avisar "conectando" e depois "conectado", e a mensagem **sai sozinha**. **Anote** se ela não avisar: nesse caso a mensagem só sai na rotina de 10 min ou na próxima mensagem do paciente. |
| 16 | Pare o Tropi (`Ctrl+C` no `pnpm dev:app`) por 1 min. O celular B manda 2 mensagens. Suba o Tropi de novo. | A Evolution tenta de novo (5 s, 10 s, 20 s… até 10 vezes): as 2 mensagens chegam, **sem duplicar**. |
| 17 | No celular A: Aparelhos conectados > toque no "Tropi" > **Sair**. Responda no Tropi. | Aviso vermelho em todas as telas ("desconectado no celular"). A mensagem fica na fila. Reconecte (passo 1): a fila **sai sozinha**. |
| 18 | (opcional, com `QRCODE_LIMIT=3`) *Desconectar*, *Gerar QR code* e **não leia**. | Depois de ~2 min: "O QR code (ou o código) expirou sem ser usado" e o botão *Começar de novo*. |

## 3. Depois do piloto: capturas viram fixtures

```bash
# Leva as capturas (já sem dados pessoais) para os testes e confere de novo cada arquivo
pnpm --filter @ecosaude/channels fixtures:evolution apps/app/.capturas-piloto
pnpm --filter @ecosaude/channels test
```

- O script **recusa** qualquer arquivo em que ainda pareça haver dado pessoal e mostra o motivo.
- Os aceitos viram `packages/channels/src/fixtures/evolution/piloto-*.json`, no máximo 2 de cada
  tipo.
- Se um teste falhar, é exatamente a divergência entre o WhatsApp real e o que o Tropi espera.
  Me mande o nome do arquivo e a mensagem do teste.
- Apague a pasta `.capturas-piloto` no fim. Tire `EVOLUTION_CAPTURE_DIR` do `.env.local`; em
  produção ela fica vazia.

## 4. Consultas úteis (banco de desenvolvimento)

```sql
-- Estado da conexão
select kind, mode, connection_state, external_account_id, display_name, last_error
  from channel_connections where channel = 'whatsapp';

-- Últimas mensagens do WhatsApp (status de envio e erro)
select created_at, direction, status, left(body, 40) as texto, external_id, error, meta->>'source' as origem
  from messages where channel = 'whatsapp' order by created_at desc limit 20;

-- Anexos: baixados, recusados ou com falha
select a.created_at, a.kind, a.status, a.mime, a.size_bytes, a.error
  from message_attachments a order by a.created_at desc limit 20;

-- Fila parada (deveria esvaziar quando reconecta)
select count(*) from messages where status = 'fila' and channel = 'whatsapp';
```

## 5. O que me mandar

1. A tabela do roteiro com OK ou o que aconteceu de diferente em cada passo.
2. O resultado de `pnpm --filter @ecosaude/channels test` depois de importar as capturas.
3. Os arquivos `piloto-*.json` novos, no commit ou num zip. Já estão sem dados pessoais.
