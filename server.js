const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const TelegramSubscriptionBot = require('./bot');
const database = require('./db');
const infinitePayService = require('./services/infinitepay');
require('dotenv').config();

class Server {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.bot = null;
    
    this.setupMiddlewares();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  // Configura middlewares
  setupMiddlewares() {
    // Segurança
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
      credentials: true
    }));
    
    // Parse JSON com limite maior para webhooks
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Log de requisições
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
    
    console.log('✅ Middlewares configurados');
  }

  // Configura rotas
  setupRoutes() {
    // Rota de health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // Rota principal
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Telegram Subscription Bot API',
        version: '1.0.0',
        status: 'running'
      });
    });

    // Webhook da InfinitePay
    this.app.post('/webhook/infinitepay', async (req, res) => {
      try {
        await this.handleInfinitePayWebhook(req, res);
      } catch (error) {
        console.error('❌ Erro no webhook InfinitePay:', error.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Webhook do Telegram (opcional, para usar webhook ao invés de polling)
    this.app.post('/webhook/telegram', async (req, res) => {
      try {
        await this.handleTelegramWebhook(req, res);
      } catch (error) {
        console.error('❌ Erro no webhook Telegram:', error.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Rotas de administração (protegidas)
    this.app.get('/admin/users', this.authenticateAdmin, async (req, res) => {
      try {
        const users = await database.getAllUsers();
        res.json({
          total: users.length,
          active: users.filter(u => u.status === 'active').length,
          inactive: users.filter(u => u.status !== 'active').length,
          users: users.map(u => ({
            id: u.id,
            telegram_id: u.telegram_id,
            username: u.username,
            first_name: u.first_name,
            status: u.status,
            subscription_end: u.subscription_end,
            created_at: u.created_at
          }))
        });
      } catch (error) {
        console.error('❌ Erro ao buscar usuários:', error.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Rota para estatísticas
    this.app.get('/admin/stats', this.authenticateAdmin, async (req, res) => {
      try {
        const users = await database.getAllUsers();
        const activeUsers = users.filter(u => u.status === 'active');
        const subscriptionPrice = parseInt(process.env.SUBSCRIPTION_PRICE) || 4990;
        
        res.json({
          total_users: users.length,
          active_users: activeUsers.length,
          inactive_users: users.length - activeUsers.length,
          monthly_revenue: activeUsers.length * subscriptionPrice,
          conversion_rate: users.length > 0 ? Math.round((activeUsers.length / users.length) * 100) : 0,
          subscription_price: subscriptionPrice
        });
      } catch (error) {
        console.error('❌ Erro ao gerar estatísticas:', error.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Rota para forçar cobrança manual (admin)
    this.app.post('/admin/charge/:telegramId', this.authenticateAdmin, async (req, res) => {
      try {
        const { telegramId } = req.params;
        
        if (!this.bot) {
          return res.status(503).json({ error: 'Bot not initialized' });
        }
        
        await this.bot.sendRenewalCharge(telegramId);
        
        res.json({
          success: true,
          message: `Cobrança enviada para usuário ${telegramId}`
        });
      } catch (error) {
        console.error('❌ Erro ao enviar cobrança manual:', error.message);
        res.status(500).json({ error: error.message });
      }
    });

    console.log('✅ Rotas configuradas');
  }

  // Middleware de autenticação para rotas admin
  authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    const adminToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken) {
      return res.status(503).json({ error: 'Admin token not configured' });
    }
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    const token = authHeader.substring(7);
    
    if (token !== adminToken) {
      return res.status(403).json({ error: 'Invalid admin token' });
    }
    
    next();
  }

  // Processa webhook da InfinitePay
  async handleInfinitePayWebhook(req, res) {
    try {
      const signature = req.headers['x-infinitepay-signature'] || req.headers['signature'];
      const payload = JSON.stringify(req.body);
      
      console.log('📥 Webhook InfinitePay recebido:', {
        event: req.body.event,
        charge_id: req.body.data?.id
      });
      
      // Verifica assinatura do webhook (se configurada)
      if (process.env.INFINITEPAY_WEBHOOK_SECRET && signature) {
        const isValid = infinitePayService.verifyWebhookSignature(payload, signature);
        
        if (!isValid) {
          console.error('❌ Assinatura do webhook inválida');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
      
      // Processa webhook
      const webhookData = infinitePayService.processWebhook(req.body);
      
      if (!webhookData) {
        console.log('ℹ️ Evento não processado');
        return res.status(200).json({ message: 'Event not processed' });
      }
      
      // Processa confirmação de pagamento no bot
      if (this.bot && webhookData.event === 'charge.paid') {
        await this.bot.processPaymentConfirmation(webhookData);
      }
      
      // Processa expiração de pagamento
      if (webhookData.event === 'charge.expired') {
        await database.updatePaymentStatus(webhookData.charge_id, 'expired');
        console.log(`⏰ Pagamento ${webhookData.charge_id} expirado`);
      }
      
      res.status(200).json({ message: 'Webhook processed successfully' });
      
    } catch (error) {
      console.error('❌ Erro ao processar webhook InfinitePay:', error.message);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // Processa webhook do Telegram (se usar webhook ao invés de polling)
  async handleTelegramWebhook(req, res) {
    try {
      if (!this.bot || !this.bot.bot) {
        return res.status(503).json({ error: 'Bot not initialized' });
      }
      
      // Processa update do Telegram
      this.bot.bot.processUpdate(req.body);
      
      res.status(200).json({ message: 'Update processed' });
      
    } catch (error) {
      console.error('❌ Erro ao processar webhook Telegram:', error.message);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // Configura tratamento de erros
  setupErrorHandling() {
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
      });
    });

    // Error handler global
    this.app.use((error, req, res, next) => {
      console.error('❌ Erro não tratado:', error.message);
      
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });

    // Tratamento de erros não capturados
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error.message);
      console.error(error.stack);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });

    console.log('✅ Error handling configurado');
  }

  // Inicializa o servidor
  async start() {
    try {
      console.log('🚀 Iniciando servidor...');
      
      // Conecta ao banco de dados
      await database.connect();
      await database.migrate();
      
      // Testa conexão com InfinitePay
      const infinitePayOk = await infinitePayService.testConnection();
      if (!infinitePayOk) {
        console.warn('⚠️ Problema na conexão com InfinitePay');
      }
      
      // Inicializa bot do Telegram
      this.bot = new TelegramSubscriptionBot();
      
      // Inicia servidor HTTP
      this.server = this.app.listen(this.port, () => {
        console.log(`🌐 Servidor rodando na porta ${this.port}`);
        console.log(`📱 Bot Telegram ativo`);
        console.log(`💳 InfinitePay ${infinitePayOk ? 'conectado' : 'com problemas'}`);
        console.log(`🗄️ Banco de dados conectado`);
        console.log('');
        console.log('✅ Sistema inicializado com sucesso!');
        console.log('');
        console.log('📋 URLs importantes:');
        console.log(`   Health Check: http://localhost:${this.port}/health`);
        console.log(`   Webhook InfinitePay: http://localhost:${this.port}/webhook/infinitepay`);
        console.log(`   Admin Users: http://localhost:${this.port}/admin/users`);
      });
      
    } catch (error) {
      console.error('❌ Erro ao iniciar servidor:', error.message);
      process.exit(1);
    }
  }

  // Para o servidor
  async stop() {
    try {
      console.log('🛑 Parando servidor...');
      
      // Para o bot
      if (this.bot) {
        this.bot.stop();
      }
      
      // Fecha conexão com banco
      await database.close();
      
      // Para servidor HTTP
      if (this.server) {
        this.server.close();
      }
      
      console.log('✅ Servidor parado com sucesso');
    } catch (error) {
      console.error('❌ Erro ao parar servidor:', error.message);
    }
  }
}

// Inicializa servidor se executado diretamente
if (require.main === module) {
  const server = new Server();
  
  // Inicia servidor
  server.start();
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('📨 SIGTERM recebido');
    await server.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('📨 SIGINT recebido');
    await server.stop();
    process.exit(0);
  });
}

module.exports = Server;