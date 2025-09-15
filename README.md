# 🤖 Telegram Subscription Bot com IA

Bot Telegram avançado com sistema de assinaturas, postagens automáticas com IA, DMs automáticas e integração com gateway de pagamento.

## ✨ Funcionalidades

### 🎯 Core Features
- **Sistema de Assinaturas**: Pagamentos via InfinitePay (PIX/Cartão)
- **Auto-Post com IA**: Postagens automáticas em grupos usando Gemini AI
- **DMs Automáticas**: Mensagens privadas para usuários que interagiram
- **Scraping de Membros**: Captura e gerenciamento de membros de grupos
- **Backup & Replicação**: Sistema completo de backup e replicação de dados

### 🤖 IA & Automação
- **Gemini AI Integration**: Geração de conteúdo criativo e personalizado
- **Postagens Inteligentes**: Conteúdo único a cada 3 horas
- **DMs Personalizadas**: Mensagens adaptadas para cada usuário
- **Sistema de Consentimento**: Controle de privacidade para DMs

### 👥 Gerenciamento
- **Painel Administrativo**: Interface completa via Telegram
- **Monitoramento**: Logs, estatísticas e métricas em tempo real
- **Controle de Usuários**: Ban/unban, listagem e gerenciamento
- **Configurações Dinâmicas**: Ajustes via comandos

## 🚀 Funcionalidades Originais

### 👤 Para Usuários
- **Comando `/start`** - Apresentação do produto com botão de assinatura
- **Geração automática de Pix** - QR Code + Copia e Cola via InfinitePay
- **Confirmação automática** - Assinatura ativada após pagamento
- **Cobranças mensais** - Renovação automática todo mês
- **Avisos de vencimento** - Notificações 7, 3 e 1 dia antes
- **Status da assinatura** - Consulta de validade e histórico

### 🔧 Para Administradores
- **`/assinantes`** - Lista usuários ativos e inativos
- **`/reenviar @username`** - Reenvia cobrança manual
- **`/stats`** - Estatísticas completas do bot
- **Relatórios diários** - Enviados automaticamente
- **API REST** - Endpoints para gestão via web

### 💳 Pagamentos
- **InfinitePay** - Geração de Pix com QR Code
- **Webhooks** - Confirmação automática de pagamentos
- **Cobrança recorrente** - Agendamento mensal via cron
- **Controle de expiração** - Marca assinaturas vencidas

## 📋 Pré-requisitos

- **Node.js** 18+ (LTS recomendado)
- **Conta InfinitePay** com API Key
- **Bot Telegram** criado via @BotFather
- **Servidor** com IP público (para webhooks)

## 🛠️ Instalação

### 1. Clone o repositório
```bash
git clone <seu-repositorio>
cd telegram-subscription-bot
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
# Bot Telegram
TELEGRAM_BOT_TOKEN=seu_token_aqui
TELEGRAM_WEBHOOK_URL=https://seudominio.com

# InfinitePay
INFINITEPAY_API_KEY=sua_api_key
INFINITEPAY_SECRET_KEY=sua_secret_key
INFINITEPAY_WEBHOOK_SECRET=seu_webhook_secret

# Assinatura
SUBSCRIPTION_PRICE=4990  # R$ 49,90 em centavos
PRODUCT_NAME=Produto Premium
PRODUCT_DESCRIPTION=Acesso exclusivo ao conteúdo VIP

# Administradores
ADMIN_IDS=123456789,987654321
```

### 4. Inicialize o banco de dados
```bash
npm run migrate
```

### 5. Inicie o servidor
```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 🔧 Configuração Detalhada

### Telegram Bot

1. **Crie o bot** via @BotFather:
   ```
   /newbot
   Nome do Bot: Seu Bot Premium
   Username: @seubotpremium_bot
   ```

2. **Configure comandos**:
   ```
   /setcommands
   start - Iniciar assinatura
   ```

3. **Obtenha o token** e adicione no `.env`

### InfinitePay

1. **Crie conta** em [InfinitePay](https://infinitepay.io)
2. **Gere API Keys** no painel
3. **Configure webhook** para: `https://seudominio.com/webhook/infinitepay`
4. **Adicione credenciais** no `.env`

### Webhook Configuration

Para receber confirmações de pagamento, configure:

```bash
# URL do webhook InfinitePay
https://seudominio.com/webhook/infinitepay

# Eventos para escutar
- charge.paid
- charge.expired
- charge.cancelled
```

## 🐳 Deploy com Docker

### 1. Build da imagem
```bash
docker build -t telegram-subscription-bot .
```

### 2. Execute com docker-compose
```bash
docker-compose up -d
```

### 3. Verifique logs
```bash
docker-compose logs -f
```

## 🌐 Deploy em Produção

### VPS/Servidor Dedicado

1. **Instale dependências**:
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Instale PM2
   npm install -g pm2
   ```

2. **Clone e configure** o projeto

3. **Inicie com PM2**:
   ```bash
   pm2 start server.js --name "telegram-bot"
   pm2 startup
   pm2 save
   ```

4. **Configure Nginx** (opcional):
   ```nginx
   server {
       listen 80;
       server_name seudominio.com;
       
       location / {
           proxy_pass tele-production-8fce.up.railway.app;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

### Heroku

1. **Crie app**:
   ```bash
   heroku create seu-bot-telegram
   ```

2. **Configure variáveis**:
   ```bash
   heroku config:set TELEGRAM_BOT_TOKEN=seu_token
   heroku config:set INFINITEPAY_API_KEY=sua_key
   # ... outras variáveis
   ```

3. **Deploy**:
   ```bash
   git push heroku main
   ```

### DigitalOcean/AWS

1. **Crie droplet/instância**
2. **Configure domínio** apontando para o IP
3. **Instale certificado SSL** (Let's Encrypt)
4. **Execute instalação** conforme VPS

## 📊 Monitoramento

### Health Check
```bash
curl tele-production-8fce.up.railway.app/health
```

### Logs
```bash
# PM2
pm2 logs telegram-bot

# Docker
docker-compose logs -f

# Direto
npm start
```

### Métricas
- **Usuários ativos**: `/admin/stats`
- **Receita mensal**: Calculada automaticamente
- **Taxa de conversão**: Ativos/Total

## 🔄 Cron Jobs

O sistema executa automaticamente:

- **Cobranças mensais**: Dia 1 às 9h
- **Avisos de vencimento**: Diário às 8h
- **Marcar expirados**: Diário à meia-noite
- **Limpeza de dados**: Semanal
- **Relatório diário**: 18h para admins

## 🛡️ Segurança

### Variáveis Sensíveis
- ✅ Use `.env` para credenciais
- ✅ Nunca commite tokens/keys
- ✅ Configure webhook secrets
- ✅ Use HTTPS em produção

### Validações
- ✅ Verificação de assinatura webhook
- ✅ Autenticação admin via token
- ✅ Rate limiting (implementar se necessário)
- ✅ Sanitização de inputs

## 🧪 Testes

### Teste manual
```bash
# Inicie em modo desenvolvimento
npm run dev

# Teste comandos no Telegram
/start
```

### Teste de webhook
```bash
# Simule webhook InfinitePay
curl -X POST tele-production-8fce.up.railway.app/webhook/infinitepay \
  -H "Content-Type: application/json" \
  -d '{
    "event": "charge.paid",
    "data": {
      "id": "charge_123",
      "status": "paid",
      "paid_at": "2024-01-15T10:30:00Z"
    }
  }'
```

## 📱 Interface do Bot

### Fluxo do Usuário

1. **Comando `/start`**:
   ```
   🎯 Produto Premium
   
   Acesso exclusivo ao conteúdo VIP
   
   💰 R$ 49,90 / mês
   
   🔓 Sem Assinatura Ativa
   Assine para ter acesso completo
   
   [👉 Assinar Agora]
   ```

2. **Após clicar em "Assinar"**:
   ```
   💳 Cobrança Gerada
   
   💰 Valor: R$ 49,90
   📅 Vencimento: 22/01/2024
   
   📱 Pix Copia e Cola:
   00020126580014br.gov.bcb.pix...
   
   ⚡ Após o pagamento, sua assinatura será ativada automaticamente!
   
   [🔄 Verificar Pagamento] [📞 Suporte]
   ```

3. **Após pagamento confirmado**:
   ```
   ✅ Pagamento Confirmado!
   
   🎉 Sua assinatura foi ativada com sucesso!
   
   📅 Válida até: 15/02/2024
   
   🚀 Agora você tem acesso completo ao conteúdo premium!
   ```

### Comandos Admin

- **`/assinantes`** - Lista todos os usuários
- **`/reenviar @username`** - Reenvia cobrança
- **`/stats`** - Estatísticas completas

## 🔧 Personalização

### Alterar Preço
```env
SUBSCRIPTION_PRICE=9990  # R$ 99,90
```

### Alterar Produto
```env
PRODUCT_NAME=Curso Premium
PRODUCT_DESCRIPTION=Acesso vitalício ao curso
PRODUCT_IMAGE_URL=https://exemplo.com/imagem.jpg
```

### Alterar Periodicidade
```env
# Cobrança semanal (domingo às 9h)
CRON_MONTHLY_CHARGE=0 9 * * 0

# Cobrança quinzenal (dia 1 e 15 às 9h)
CRON_MONTHLY_CHARGE=0 9 1,15 * *
```

## 🆘 Troubleshooting

### Bot não responde
- ✅ Verifique token do Telegram
- ✅ Confirme que o bot está iniciado
- ✅ Verifique logs de erro

### Pagamentos não confirmam
- ✅ Teste webhook InfinitePay
- ✅ Verifique credenciais da API
- ✅ Confirme URL do webhook

### Cron jobs não executam
- ✅ Verifique timezone
- ✅ Confirme formato do cron
- ✅ Teste execução manual

### Banco de dados
```bash
# Recriar tabelas
rm database.sqlite
npm run migrate
```

## 📞 Suporte

- **Documentação**: Este README
- **Issues**: GitHub Issues
- **Email**: seu@email.com

## 📄 Licença

MIT License - veja [LICENSE](LICENSE) para detalhes.

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

---

**Desenvolvido com ❤️ para automatizar vendas por assinatura no Telegram**