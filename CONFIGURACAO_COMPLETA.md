# 🤖 Guia de Configuração Completa - Bot Telegram

## 📋 Pré-requisitos

### 1. Criar Bot no Telegram
1. Abra o Telegram e procure por `@BotFather`
2. Digite `/newbot` e siga as instruções
3. Escolha um nome para seu bot (ex: "Meu Bot Premium")
4. Escolha um username único (ex: "meubot_premium_bot")
5. **COPIE O TOKEN** que será fornecido (formato: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Configurar Administradores
1. Obtenha seu ID do Telegram:
   - Envie uma mensagem para `@userinfobot`
   - Copie o número do seu ID

## ⚙️ Configuração do Arquivo .env

Edite o arquivo `.env` na raiz do projeto com suas configurações:

```env
# === CONFIGURAÇÕES DO BOT TELEGRAM ===
TELEGRAM_BOT_TOKEN=SEU_TOKEN_AQUI
ADMIN_IDS=SEU_ID_AQUI,OUTRO_ID_SE_HOUVER

# === CONFIGURAÇÕES DO SERVIDOR ===
PORT=3000
NODE_ENV=production

# === CONFIGURAÇÕES INFINITEPAY ===
INFINITEPAY_CLIENT_ID=seu_client_id
INFINITEPAY_CLIENT_SECRET=seu_client_secret
INFINITEPAY_WEBHOOK_SECRET=seu_webhook_secret
INFINITEPAY_BASE_URL=https://api.infinitepay.io

# === CONFIGURAÇÕES DO BANCO DE DADOS ===
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=telegram_bot
DB_PORT=3306

# === CONFIGURAÇÕES DE ASSINATURA ===
SUBSCRIPTION_PRICE_WEEK=1500
SUBSCRIPTION_PRICE_MONTH=4500
SUBSCRIPTION_PRICE_YEAR=45000

# === CONFIGURAÇÕES DE MÍDIA ===
MEDIA_FOLDER=./media
MAX_FILE_SIZE=20971520

# === CONFIGURAÇÕES DE AUTO-POST ===
AUTO_POST_INTERVAL=3600000
AUTO_POST_ENABLED=true

# === CONFIGURAÇÕES DE GEMINI AI ===
GEMINI_API_KEY=sua_chave_gemini

# === CONFIGURAÇÕES DE CACHE ===
CACHE_TTL=3600

# === CONFIGURAÇÕES DE LOGS ===
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
```

## 🚀 Como Iniciar o Bot

### 1. Instalar Dependências
```bash
npm install
```

### 2. Configurar Banco de Dados
- Certifique-se de que o MySQL está rodando
- O bot criará as tabelas automaticamente na primeira execução

### 3. Iniciar o Servidor
```bash
node server.js
```

### 4. Verificar se Está Funcionando
- Procure seu bot no Telegram
- Digite `/start`
- Você deve receber uma mensagem de boas-vindas

## 🎯 Funcionalidades Implementadas

### ✅ Sistema de Botões Interativos Completo
- **Painel Administrativo**: `/admin` ou `/painel`
- **Gestão de Grupos**: Listar, adicionar, remover grupos
- **Gestão de Usuários**: Visualizar, banir, desbanir usuários
- **Sistema de Backup**: Backup automático e manual
- **Configurações**: Alterar parâmetros do sistema

### ✅ Sistema de Postagem Manual Avançado
- **Postagem em Grupos**: Envia conteúdo para todos os grupos
- **Postagem em DM**: Envia mensagens diretas para membros
- **Postagem Completa**: Grupos + DM simultaneamente
- **Agendamento**: Programa posts para horários específicos
- **Relatórios**: Estatísticas detalhadas de envio

### ✅ Captura de Membros
- **Captura Automática**: Coleta IDs de novos membros
- **Captura Manual**: Botão para capturar todos os membros
- **Exportação**: Relatórios de membros capturados
- **Estatísticas**: Contadores por grupo e totais

### ✅ Sistema de Mídia
- **Upload de Imagens**: Interface para envio de fotos
- **Gerenciamento**: Listar, visualizar, remover mídias
- **Auto-Post**: Postagem automática com mídias
- **Formatos Suportados**: JPG, PNG, GIF (até 20MB)

### ✅ Recursos Administrativos
- **Painel de Controle**: Interface completa via botões
- **Logs do Sistema**: Monitoramento em tempo real
- **Estatísticas**: Métricas detalhadas de uso
- **Configurações**: Ajustes via interface

## 🎮 Como Usar os Comandos

### Comandos Básicos
- `/start` - Iniciar o bot
- `/admin` ou `/painel` - Painel administrativo
- `/stats` - Estatísticas gerais
- `/help` - Ajuda

### Comandos Administrativos
- `/groups` - Gerenciar grupos
- `/users` - Gerenciar usuários
- `/backup` - Sistema de backup
- `/config` - Configurações
- `/logs` - Visualizar logs

### Comandos de Mídia
- `/media` - Painel de mídia
- `/upload` - Upload de arquivos
- `/autopost` - Configurar auto-post

### Comandos de Postagem
- `/post` - Postagem manual
- `/schedule` - Agendar posts
- `/mass` - Mensagem em massa

## 🔧 Solução de Problemas

### Erro 404 Not Found
- **Causa**: Token do bot inválido
- **Solução**: Verifique o token no arquivo `.env`

### Bot não responde
- **Causa**: Bot não foi iniciado pelo BotFather
- **Solução**: Digite `/start` no chat com o BotFather

### Erro de permissão
- **Causa**: Seu ID não está na lista de admins
- **Solução**: Adicione seu ID em `ADMIN_IDS` no `.env`

### Erro de banco de dados
- **Causa**: MySQL não está rodando ou configuração incorreta
- **Solução**: Verifique as configurações de DB no `.env`

## 📊 Estrutura do Sistema

### Arquivos Principais
- `server.js` - Servidor principal
- `bot.js` - Lógica do bot Telegram
- `db.js` - Conexão com banco de dados
- `.env` - Configurações

### Pastas
- `services/` - Serviços do sistema
- `utils/` - Utilitários
- `media/` - Arquivos de mídia
- `logs/` - Logs do sistema

## 🎯 Próximos Passos

1. **Configure o token do bot** no arquivo `.env`
2. **Adicione seu ID** como administrador
3. **Inicie o servidor** com `node server.js`
4. **Teste os comandos** começando com `/start`
5. **Explore o painel** administrativo com `/admin`

## 🆘 Suporte

Se encontrar problemas:
1. Verifique os logs em `./logs/bot.log`
2. Confirme as configurações no `.env`
3. Teste a conectividade com o banco de dados
4. Verifique se o token do bot está correto

---

**✅ Sistema Completo Implementado!**

Todas as funcionalidades solicitadas foram implementadas:
- ✅ Interação completa via botões
- ✅ Sistema de postagem manual (grupos + DM)
- ✅ Captura de IDs de membros
- ✅ Armazenamento de imagens para auto-post
- ✅ Interface administrativa completa
- ✅ Relatórios e estatísticas detalhadas

O bot está pronto para uso! Basta configurar o token e iniciar.