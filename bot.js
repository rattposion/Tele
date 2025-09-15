const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const database = require('./db');
const infinitePayService = require('./services/infinitepay');
const GroupManager = require('./services/groupManager');
const BackupManager = require('./services/backupManager');
const AutoPostManager = require('./services/autoPostManager');
const GeminiAIService = require('./services/geminiAI');
require('dotenv').config();

// Configuração do momento para português
moment.locale('pt-br');

class TelegramSubscriptionBot {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
    
    if (!this.token) {
      throw new Error('❌ Token do bot Telegram não configurado');
    }
    
    this.bot = new TelegramBot(this.token, { polling: true });
    
    // Inicializa serviços após criar o bot
    this.groupManager = new GroupManager(this.bot, database);
    this.backupManager = new BackupManager();
    this.autoPostManager = new AutoPostManager(this.bot);
    this.geminiAI = new GeminiAIService();
    
    this.setupHandlers();
    
    console.log('🤖 Bot Telegram inicializado');
  }

  // Configura todos os handlers do bot
  setupHandlers() {
    // Comando /start
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    
    // Comandos admin
    this.bot.onText(/\/assinantes/, (msg) => this.handleAssinantes(msg));
    this.bot.onText(/\/reenviar (.+)/, (msg, match) => this.handleReenviar(msg, match));
    this.bot.onText(/\/stats/, (msg) => this.handleStats(msg));
    
    // Novos comandos administrativos
    this.bot.onText(/\/grupos/, (msg) => this.handleGroups(msg));
    this.bot.onText(/\/scrape (.+)/, (msg, match) => this.handleStartScraping(msg, match));
    this.bot.onText(/\/addgrupo/, (msg) => this.handleAddGroup(msg));
    this.bot.onText(/\/membros (.+)/, (msg, match) => this.handleGroupMembers(msg, match));
    this.bot.onText(/\/replicar (.+) (.+)/, (msg, match) => this.handleReplicateMembers(msg, match));
    this.bot.onText(/\/autoadd (.+) (.+)/, (msg, match) => this.handleAutoAdd(msg, match));
    this.bot.onText(/\/bulkadd (.+)/, (msg, match) => this.handleBulkAdd(msg, match));
    this.bot.onText(/\/jobs/, (msg) => this.handleScrapingJobs(msg));
    this.bot.onText(/\/logs/, (msg) => this.handleLogs(msg));
    this.bot.onText(/\/painel/, (msg) => this.handleAdminPanel(msg));
    this.bot.onText(/\/backup/, (msg) => this.handleBackup(msg));
    this.bot.onText(/\/replicar (.+) (.+)/, (msg, match) => this.handleReplicate(msg, match));
    this.bot.onText(/\/restaurar/, (msg) => this.handleRestore(msg));
    this.bot.onText(/\/limpar/, (msg) => this.handleCleanup(msg));
    this.bot.onText(/\/config/, (msg) => this.handleConfig(msg));
    this.bot.onText(/\/set (.+) (.+)/, (msg, match) => this.handleSetConfig(msg, match));
    this.bot.onText(/\/estatisticas/, (msg) => this.handleAdvancedStats(msg));
    this.bot.onText(/\/sistema/, (msg) => this.handleSystemInfo(msg));
    this.bot.onText(/\/usuarios/, (msg) => this.handleUsers(msg));
    this.bot.onText(/\/ban (.+)/, (msg, match) => this.handleBanUser(msg, match));
    this.bot.onText(/\/unban (.+)/, (msg, match) => this.handleUnbanUser(msg, match));
    this.bot.onText(/\/autopost/, (msg) => this.handleAutoPost(msg));
    this.bot.onText(/\/startauto/, (msg) => this.handleStartAuto(msg));
    this.bot.onText(/\/stopauto/, (msg) => this.handleStopAuto(msg));
    this.bot.onText(/\/togglepost (.+)/, (msg, match) => this.handleTogglePost(msg, match));
    this.bot.onText(/\/dmstats/, (msg) => this.handleDMStats(msg));
    this.bot.onText(/\/testai/, (msg) => this.handleTestAI(msg));
    
    // Callback queries (botões)
    this.bot.on('callback_query', (callbackQuery) => this.handleCallbackQuery(callbackQuery));
    
    // Eventos de grupo para capturar membros
    this.bot.on('new_chat_members', (msg) => this.handleNewChatMembers(msg));
    this.bot.on('left_chat_member', (msg) => this.handleLeftChatMember(msg));
    this.bot.on('message', (msg) => this.handleMessage(msg));
    
    // Inicia sistema de auto-post
    this.initializeAutoPost();
    
    // Tratamento de erros
    this.bot.on('polling_error', (error) => {
      console.error('❌ Erro no polling:', error.message);
    });
    
    console.log('✅ Handlers do bot configurados');
  }

  // Verifica se usuário é admin
  isAdmin(userId) {
    return this.adminIds.includes(userId.toString());
  }

  // Handler do comando /start
  async handleStart(msg) {
    try {
      const chatId = msg.chat.id;
      const user = msg.from;
      
      console.log(`👤 Usuário ${user.first_name} (${user.id}) iniciou conversa`);
      
      // Busca ou cria usuário no banco
      const dbUser = await database.findOrCreateUser(user);
      
      // Monta mensagem de apresentação
      const productName = process.env.PRODUCT_NAME || 'Produto Premium';
      const productDescription = process.env.PRODUCT_DESCRIPTION || 'Acesso exclusivo ao conteúdo VIP';
      const subscriptionPrice = parseInt(process.env.SUBSCRIPTION_PRICE) || 4990;
      const priceFormatted = infinitePayService.formatCurrency(subscriptionPrice);
      
      const welcomeMessage = `
🎯 *${productName}*

${productDescription}

💰 *${priceFormatted} / mês*

${this.getSubscriptionStatusMessage(dbUser)}

📱 Clique no botão abaixo para assinar:`;
      
      const keyboard = this.getMainKeyboard(dbUser);
      
      // Envia imagem se configurada
      const productImageUrl = process.env.PRODUCT_IMAGE_URL;
      
      if (productImageUrl) {
        await this.bot.sendPhoto(chatId, productImageUrl, {
          caption: welcomeMessage,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } else {
        await this.bot.sendMessage(chatId, welcomeMessage, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error('❌ Erro no comando /start:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro interno. Tente novamente.');
    }
  }

  // Retorna mensagem de status da assinatura
  getSubscriptionStatusMessage(user) {
    if (user.status === 'active') {
      const endDate = moment(user.subscription_end).format('DD/MM/YYYY');
      return `✅ *Assinatura Ativa*\nVálida até: ${endDate}`;
    } else if (user.status === 'expired') {
      return '⏰ *Assinatura Expirada*\nRenove para continuar acessando';
    } else {
      return '🔓 *Sem Assinatura Ativa*\nAssine para ter acesso completo';
    }
  }

  // Retorna teclado principal baseado no status do usuário
  getMainKeyboard(user) {
    const buttons = [];
    
    if (user.status === 'active') {
      buttons.push([{ text: '✅ Assinatura Ativa', callback_data: 'subscription_status' }]);
      buttons.push([{ text: '🔄 Renovar Assinatura', callback_data: 'renew_subscription' }]);
    } else {
      buttons.push([{ text: '👉 Assinar Agora', callback_data: 'subscribe_now' }]);
    }
    
    buttons.push([{ text: '📞 Suporte', callback_data: 'support' }]);
    
    return { inline_keyboard: buttons };
  }

  // Handler de callback queries (botões)
  async handleCallbackQuery(callbackQuery) {
    try {
      const chatId = callbackQuery.message.chat.id;
      const userId = callbackQuery.from.id;
      const data = callbackQuery.data;
      
      // Registra interação para DM
      if (userId && !callbackQuery.from.is_bot) {
        await this.autoPostManager.registerUserInteraction(
          userId, 
          'callback_query', 
          chatId
        );
      }
      
      // Responde ao callback para remover loading
      await this.bot.answerCallbackQuery(callbackQuery.id);
      
      console.log(`🔘 Callback recebido: ${data} de ${userId}`);
      
      switch (data) {
        case 'subscribe_now':
        case 'renew_subscription':
          await this.handleSubscription(chatId, userId);
          break;
          
        case 'subscription_status':
          await this.handleSubscriptionStatus(chatId, userId);
          break;
          
        case 'support':
          await this.handleSupport(chatId);
          break;
          
        case 'unsubscribe_dm':
          await this.handleUnsubscribeDM(callbackQuery);
          break;
          
        // Novos botões para conteúdo adulto +18
        case 'acesso_exclusivo':
          await this.handleAcessoExclusivo(chatId, userId);
          break;
          
        case 'assinar_premium':
          await this.handleAssinarPremium(chatId, userId);
          break;
          
        case 'acesso_18':
          await this.handleAcesso18(chatId, userId);
          break;
          
        case 'comprar_assinatura':
          await this.handleComprarAssinatura(chatId, userId);
          break;
          
        case 'cancelar_dms':
          await this.handleCancelarDMs(callbackQuery);
          break;
          
        default:
          await this.bot.sendMessage(chatId, '❌ Ação não reconhecida.');
      }
    } catch (error) {
      console.error('❌ Erro no callback query:', error.message);
      await this.bot.sendMessage(callbackQuery.message.chat.id, '❌ Erro interno. Tente novamente.');
    }
  }

  // Processa assinatura/renovação
  async handleSubscription(chatId, userId) {
    try {
      const user = await database.getUserByTelegramId(userId);
      
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Usuário não encontrado. Use /start primeiro.');
        return;
      }
      
      // Gera dados da cobrança
      const chargeData = infinitePayService.generateSubscriptionCharge(user, process.env.SUBSCRIPTION_PRICE);
      
      await this.bot.sendMessage(chatId, '⏳ Gerando cobrança Pix...');
      
      // Cria cobrança na InfinitePay
      const charge = await infinitePayService.createPixCharge(chargeData);
      
      // Salva pagamento no banco
      const dueDate = moment().add(parseInt(process.env.DAYS_TO_EXPIRE) || 7, 'days').format('YYYY-MM-DD');
      
      await database.createPayment({
        user_id: user.id,
        telegram_id: userId,
        infinitepay_id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        pix_code: charge.pix_code,
        qr_code_url: charge.qr_code_url,
        due_date: dueDate
      });
      
      // Envia cobrança para o usuário
      await this.sendPixCharge(chatId, charge, dueDate);
      
    } catch (error) {
      console.error('❌ Erro ao processar assinatura:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro ao gerar cobrança. Tente novamente ou entre em contato com o suporte.');
    }
  }

  // Envia cobrança Pix para o usuário
  async sendPixCharge(chatId, charge, dueDate) {
    const priceFormatted = infinitePayService.formatCurrency(charge.amount);
    const dueDateFormatted = moment(dueDate).format('DD/MM/YYYY');
    
    const message = `
💳 *Cobrança Gerada*

💰 Valor: *${priceFormatted}*
📅 Vencimento: *${dueDateFormatted}*

📱 *Pix Copia e Cola:*
\`${charge.pix_code}\`

⚡ Após o pagamento, sua assinatura será ativada automaticamente!

⏰ Você tem até ${dueDateFormatted} para efetuar o pagamento.`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Verificar Pagamento', callback_data: `check_payment_${charge.id}` }],
        [{ text: '📞 Suporte', callback_data: 'support' }]
      ]
    };
    
    // Envia QR Code se disponível
    if (charge.qr_code_url) {
      try {
        await this.bot.sendPhoto(chatId, charge.qr_code_url, {
          caption: message,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (error) {
        // Se falhar ao enviar imagem, envia só texto
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    } else {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  }

  // Mostra status da assinatura
  async handleSubscriptionStatus(chatId, userId) {
    try {
      const user = await database.getUserByTelegramId(userId);
      
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Usuário não encontrado.');
        return;
      }
      
      let message = `📊 *Status da Assinatura*\n\n`;
      
      if (user.status === 'active') {
        const endDate = moment(user.subscription_end).format('DD/MM/YYYY HH:mm');
        const daysLeft = moment(user.subscription_end).diff(moment(), 'days');
        
        message += `✅ *Status:* Ativa\n`;
        message += `📅 *Válida até:* ${endDate}\n`;
        message += `⏰ *Dias restantes:* ${daysLeft} dias\n`;
        
        if (user.last_payment_date) {
          const lastPayment = moment(user.last_payment_date).format('DD/MM/YYYY');
          message += `💳 *Último pagamento:* ${lastPayment}`;
        }
      } else {
        message += `❌ *Status:* ${user.status === 'expired' ? 'Expirada' : 'Inativa'}\n`;
        message += `📝 *Ação:* Assine para ter acesso completo`;
      }
      
      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('❌ Erro ao consultar status:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro ao consultar status.');
    }
  }

  // Handler de suporte
  async handleSupport(chatId) {
    const supportMessage = `
📞 *Suporte ao Cliente*

Precisa de ajuda? Entre em contato:

• 💬 Chat: @seususuario
• 📧 Email: suporte@seudominio.com
• 📱 WhatsApp: (11) 99999-9999

⏰ Horário de atendimento:
Segunda a Sexta: 9h às 18h`;
    
    await this.bot.sendMessage(chatId, supportMessage, { parse_mode: 'Markdown' });
  }

  // Handler para cancelar DMs automáticas
  async handleUnsubscribeDM(callbackQuery) {
    try {
      const userId = callbackQuery.from.id;
      const chatId = callbackQuery.message.chat.id;
      
      // Atualiza o consentimento do usuário
      await database.query(
        'UPDATE users SET dm_consent = false WHERE telegram_id = ?',
        [userId.toString()]
      );
      
      const message = `✅ **DMs Canceladas**\n\nVocê não receberá mais mensagens automáticas.\n\nPara reativar, use o comando /start e interaja novamente.`;
      
      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown'
      });
      
      console.log(`🚫 Usuário ${userId} cancelou DMs automáticas`);
      
    } catch (error) {
      console.error('❌ Erro ao cancelar DMs:', error.message);
      await this.bot.sendMessage(callbackQuery.message.chat.id, '❌ Erro ao processar cancelamento.');
    }
  }

  // Novos handlers para botões de conteúdo adulto +18
  async handleAcessoExclusivo(chatId, userId) {
    try {
      // Verifica se o usuário tem assinatura ativa
      const user = await database.get(
        'SELECT * FROM users WHERE telegram_id = ?',
        [userId]
      );
      
      if (!user) {
        await this.bot.sendMessage(chatId, 
          '🔞 Para acessar conteúdo exclusivo +18, você precisa se registrar primeiro!\n\n' +
          '👆 Use /start para começar.'
        );
        return;
      }
      
      const now = new Date();
      const subscriptionEnd = user.subscription_end ? new Date(user.subscription_end) : null;
      
      if (!subscriptionEnd || subscriptionEnd <= now) {
        await this.bot.sendMessage(chatId, 
          '🔞💎 **ACESSO EXCLUSIVO +18**\n\n' +
          '🔥 Conteúdo adulto premium disponível apenas para assinantes VIP!\n\n' +
          '💋 O que você encontrará:\n' +
          '• Fotos e vídeos exclusivos\n' +
          '• Conteúdo íntimo e provocante\n' +
          '• Atualizações diárias\n' +
          '• Acesso prioritário\n\n' +
          '💎 **Assine agora e tenha acesso imediato!**',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '💎 Assinar Premium', callback_data: 'subscribe_now' },
                { text: '📞 Suporte', callback_data: 'support' }
              ]]
            }
          }
        );
      } else {
        await this.bot.sendMessage(chatId, 
          '🔥💎 **BEM-VINDO AO ACESSO EXCLUSIVO +18!**\n\n' +
          '💋 Você tem acesso total ao conteúdo premium!\n\n' +
          `⏰ Sua assinatura expira em: ${moment(subscriptionEnd).format('DD/MM/YYYY HH:mm')}\n\n` +
          '🔞 Aproveite todo o conteúdo exclusivo disponível!',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '📱 Ver Conteúdo', url: `https://t.me/${process.env.BOT_USERNAME}` },
                { text: '🔄 Renovar', callback_data: 'renew_subscription' }
              ]]
            }
          }
        );
      }
      
      console.log(`🔞 Usuário ${userId} acessou conteúdo exclusivo`);
      
    } catch (error) {
      console.error('❌ Erro no acesso exclusivo:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
    }
  }

  async handleAssinarPremium(chatId, userId) {
    try {
      await this.handleSubscription(chatId, userId);
      console.log(`💎 Usuário ${userId} clicou em assinar premium`);
    } catch (error) {
      console.error('❌ Erro na assinatura premium:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
    }
  }

  async handleAcesso18(chatId, userId) {
    try {
      await this.handleAcessoExclusivo(chatId, userId);
      console.log(`🔞 Usuário ${userId} clicou em acesso +18`);
    } catch (error) {
      console.error('❌ Erro no acesso +18:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
    }
  }

  async handleComprarAssinatura(chatId, userId) {
    try {
      await this.handleSubscription(chatId, userId);
      console.log(`💰 Usuário ${userId} clicou em comprar assinatura`);
    } catch (error) {
      console.error('❌ Erro na compra de assinatura:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
    }
  }

  async handleCancelarDMs(callbackQuery) {
    try {
      const userId = callbackQuery.from.id;
      const chatId = callbackQuery.message.chat.id;
      
      // Atualiza o consentimento do usuário
      await database.query(
        'UPDATE users SET dm_consent = false WHERE telegram_id = ?',
        [userId.toString()]
      );
      
      const message = `✅ **DMs Cancelados com Sucesso!**\n\n📵 Você não receberá mais mensagens automáticas.\n\n💡 **Para reativar:**\n• Use o comando /start\n• Ou clique em qualquer botão de acesso\n\n🔞 Mas lembre-se: você pode estar perdendo conteúdo exclusivo!`;
      
      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 Reativar DMs', callback_data: 'subscribe_now' },
            { text: '📞 Suporte', callback_data: 'support' }
          ]]
        }
      });
      
      console.log(`📵 Usuário ${userId} cancelou DMs via botão`);
      
    } catch (error) {
      console.error('❌ Erro ao cancelar DMs:', error.message);
      await this.bot.sendMessage(callbackQuery.message.chat.id, 
        '❌ Erro ao processar cancelamento. Tente novamente.'
      );
    }
  }

  // Comando admin: listar assinantes
  async handleAssinantes(msg) {
    try {
      const userId = msg.from.id;
      
      if (!this.isAdmin(userId)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado. Comando apenas para administradores.');
        return;
      }
      
      const users = await database.getAllUsers();
      
      if (users.length === 0) {
        await this.bot.sendMessage(msg.chat.id, '📝 Nenhum usuário cadastrado.');
        return;
      }
      
      const activeUsers = users.filter(u => u.status === 'active');
      const inactiveUsers = users.filter(u => u.status !== 'active');
      
      let message = `👥 *Relatório de Assinantes*\n\n`;
      message += `📊 *Resumo:*\n`;
      message += `• Total: ${users.length}\n`;
      message += `• Ativos: ${activeUsers.length}\n`;
      message += `• Inativos: ${inactiveUsers.length}\n\n`;
      
      if (activeUsers.length > 0) {
        message += `✅ *Assinantes Ativos:*\n`;
        activeUsers.slice(0, 10).forEach(user => {
          const endDate = moment(user.subscription_end).format('DD/MM');
          message += `• ${user.first_name} (@${user.username || 'sem_username'}) - até ${endDate}\n`;
        });
        
        if (activeUsers.length > 10) {
          message += `... e mais ${activeUsers.length - 10} usuários\n`;
        }
      }
      
      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('❌ Erro no comando /assinantes:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao buscar assinantes.');
    }
  }

  // Comando admin: reenviar cobrança
  async handleReenviar(msg, match) {
    try {
      const userId = msg.from.id;
      
      if (!this.isAdmin(userId)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
        return;
      }
      
      const username = match[1].replace('@', '');
      
      // Busca usuário por username (implementação simplificada)
      const users = await database.getAllUsers();
      const targetUser = users.find(u => u.username === username);
      
      if (!targetUser) {
        await this.bot.sendMessage(msg.chat.id, `❌ Usuário @${username} não encontrado.`);
        return;
      }
      
      // Gera nova cobrança
      await this.handleSubscription(targetUser.telegram_id, targetUser.telegram_id);
      
      await this.bot.sendMessage(msg.chat.id, `✅ Cobrança reenviada para @${username}`);
      
    } catch (error) {
      console.error('❌ Erro no comando /reenviar:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao reenviar cobrança.');
    }
  }

  // Comando admin: estatísticas
  async handleStats(msg) {
    try {
      const userId = msg.from.id;
      
      if (!this.isAdmin(userId)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
        return;
      }
      
      const users = await database.getAllUsers();
      const activeUsers = users.filter(u => u.status === 'active');
      const expiredUsers = users.filter(u => u.status === 'expired');
      const inactiveUsers = users.filter(u => u.status === 'inactive');
      
      // Calcula receita mensal estimada
      const monthlyRevenue = activeUsers.length * (parseInt(process.env.SUBSCRIPTION_PRICE) || 4990);
      const revenueFormatted = infinitePayService.formatCurrency(monthlyRevenue);
      
      const message = `
📈 *Estatísticas do Bot*

👥 *Usuários:*
• Total: ${users.length}
• Ativos: ${activeUsers.length}
• Expirados: ${expiredUsers.length}
• Inativos: ${inactiveUsers.length}

💰 *Financeiro:*
• Receita mensal: ${revenueFormatted}
• Taxa de conversão: ${users.length > 0 ? Math.round((activeUsers.length / users.length) * 100) : 0}%

📅 *Período:* ${moment().format('DD/MM/YYYY HH:mm')}`;
      
      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('❌ Erro no comando /stats:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao gerar estatísticas.');
    }
  }

  // Processa confirmação de pagamento via webhook
  async processPaymentConfirmation(webhookData) {
    try {
      const { charge_id, status, paid_at } = webhookData;
      
      console.log(`💳 Processando pagamento: ${charge_id} - ${status}`);
      
      // Atualiza status do pagamento no banco
      await database.updatePaymentStatus(charge_id, status, paid_at);
      
      if (status === 'paid') {
        // Busca dados do pagamento
        const payment = await this.getPaymentByInfinitePayId(charge_id);
        
        if (payment) {
          // Ativa assinatura do usuário
          const subscriptionEnd = moment().add(1, 'month').format('YYYY-MM-DD HH:mm:ss');
          await database.updateUserSubscription(payment.telegram_id, 'active', subscriptionEnd);
          
          // Notifica usuário
          await this.notifyPaymentConfirmed(payment.telegram_id, subscriptionEnd);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao processar confirmação de pagamento:', error.message);
    }
  }

  // Busca pagamento por ID da InfinitePay (método auxiliar)
  async getPaymentByInfinitePayId(infinitepayId) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM payments WHERE infinitepay_id = ?';
      database.db.get(sql, [infinitepayId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Notifica usuário sobre pagamento confirmado
  async notifyPaymentConfirmed(telegramId, subscriptionEnd) {
    try {
      const endDate = moment(subscriptionEnd).format('DD/MM/YYYY');
      
      const message = `
✅ *Pagamento Confirmado!*

🎉 Sua assinatura foi ativada com sucesso!

📅 *Válida até:* ${endDate}

🚀 Agora você tem acesso completo ao conteúdo premium!

💡 Use /start para ver suas opções.`;
      
      await this.bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
      
      console.log(`✅ Usuário ${telegramId} notificado sobre pagamento confirmado`);
    } catch (error) {
      console.error('❌ Erro ao notificar usuário:', error.message);
    }
  }

  // Envia cobrança de renovação
  async sendRenewalCharge(telegramId) {
    try {
      const user = await database.getUserByTelegramId(telegramId);
      
      if (!user) {
        console.error(`❌ Usuário ${telegramId} não encontrado para renovação`);
        return;
      }
      
      await this.handleSubscription(telegramId, telegramId);
      
      const message = `
🔔 *Renovação da Assinatura*

⏰ Sua assinatura está próxima do vencimento.

💳 Uma nova cobrança foi gerada para renovação automática.

📱 Efetue o pagamento para manter seu acesso ativo.`;
      
      await this.bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('❌ Erro ao enviar cobrança de renovação:', error.message);
    }
  }

  // Novos métodos administrativos
  async handleGroups(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const groups = await this.groupManager.getGroups();
      let message = '📋 *Grupos Cadastrados:*\n\n';
      
      if (groups.length === 0) {
        message += 'Nenhum grupo cadastrado.';
      } else {
        groups.forEach(group => {
          message += `• ${group.name} (${group.telegram_id})\n`;
          message += `  Membros: ${group.member_count || 0}\n\n`;
        });
      }
      
      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ Erro ao listar grupos:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao listar grupos.');
    }
  }

  async handleStartScraping(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const groupId = match[1];
      await this.bot.sendMessage(msg.chat.id, '🔄 Iniciando scraping...');
      
      const result = await this.groupManager.startScraping(groupId);
      
      if (result.success) {
        await this.bot.sendMessage(msg.chat.id, `✅ Scraping iniciado para o grupo ${groupId}`);
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Erro ao iniciar scraping:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao iniciar scraping.');
    }
  }

  async handleAddGroup(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    await this.bot.sendMessage(msg.chat.id, 'Para adicionar um grupo, use:\n`/addgrupo <telegram_id> <nome>`', { parse_mode: 'Markdown' });
  }

  async handleGroupMembers(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const groupId = match[1];
      const members = await this.groupManager.getGroupMembers(groupId);
      
      let message = `👥 *Membros do Grupo ${groupId}:*\n\n`;
      message += `Total: ${members.length} membros\n\n`;
      
      members.slice(0, 20).forEach(member => {
        message += `• ${member.first_name || 'N/A'} (@${member.username || 'sem_username'})\n`;
      });
      
      if (members.length > 20) {
        message += `\n... e mais ${members.length - 20} membros`;
      }
      
      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ Erro ao listar membros:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao listar membros.');
    }
  }

  async handleReplicateMembers(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const sourceGroupId = match[1];
      const targetGroupId = match[2];
      
      await this.bot.sendMessage(msg.chat.id, '🔄 Iniciando replicação de membros...');
      
      const result = await this.groupManager.replicateMembers(sourceGroupId, targetGroupId);
      
      if (result.success) {
        await this.bot.sendMessage(msg.chat.id, `✅ Replicação concluída: ${result.added} membros adicionados`);
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Erro na replicação:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro na replicação.');
    }
  }

  async handleScrapingJobs(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const jobs = await this.groupManager.getScrapingJobs();
      
      let message = '⚙️ *Jobs de Scraping:*\n\n';
      
      if (jobs.length === 0) {
        message += 'Nenhum job ativo.';
      } else {
        jobs.forEach(job => {
          message += `• Grupo: ${job.group_id}\n`;
          message += `  Status: ${job.status}\n`;
          message += `  Progresso: ${job.progress || 0}%\n\n`;
        });
      }
      
      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ Erro ao listar jobs:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao listar jobs.');
    }
  }

  async handleLogs(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const logs = await this.groupManager.getLogs();
      
      let message = '📋 *Logs Recentes:*\n\n';
      
      if (logs.length === 0) {
        message += 'Nenhum log encontrado.';
      } else {
        logs.slice(0, 10).forEach(log => {
          const date = moment(log.created_at).format('DD/MM HH:mm');
          message += `[${date}] ${log.action}: ${log.details}\n`;
        });
      }
      
      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ Erro ao buscar logs:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro ao buscar logs.');
    }
  }

  async handleAutoAdd(msg, match) {
     if (!this.isAdmin(msg.from.id)) {
       await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
       return;
     }
     
     try {
       const userId = match[1];
       const groupId = match[2];
       
       await this.bot.sendMessage(msg.chat.id, '🔄 Adicionando usuário ao grupo...');
       
       const result = await this.groupManager.addMemberToGroup(userId, groupId);
       
       if (result.success) {
         await this.bot.sendMessage(msg.chat.id, `✅ Usuário ${userId} adicionado ao grupo ${groupId}`);
       } else {
         await this.bot.sendMessage(msg.chat.id, `❌ Erro: ${result.error}`);
       }
     } catch (error) {
       console.error('❌ Erro no auto-add:', error.message);
       await this.bot.sendMessage(msg.chat.id, '❌ Erro no auto-add.');
     }
   }
   
   async handleBulkAdd(msg, match) {
     if (!this.isAdmin(msg.from.id)) {
       await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
       return;
     }
     
     try {
       const groupId = match[1];
       
       // Obter membros ativos de todos os grupos para adicionar
       const allMembers = await this.groupManager.getAllActiveMembers();
       
       if (allMembers.length === 0) {
         await this.bot.sendMessage(msg.chat.id, '❌ Nenhum membro encontrado para adicionar.');
         return;
       }
       
       await this.bot.sendMessage(msg.chat.id, `🔄 Iniciando adição em massa de ${allMembers.length} membros...`);
       
       const userIds = allMembers.map(member => member.user_id);
       const result = await this.groupManager.bulkAddMembers(userIds, groupId, {
         maxConcurrent: 3,
         delayBetweenBatches: 15000,
         useInviteLink: true
       });
       
       const message = `
 📊 *Resultado da Adição em Massa:*
 
 ✅ Sucessos: ${result.success}
 ❌ Falhas: ${result.failed}
 📈 Total: ${result.success + result.failed}
 
 ${result.errors.length > 0 ? `⚠️ Primeiros erros:\n${result.errors.slice(0, 5).join('\n')}` : ''}`;
       
       await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
     } catch (error) {
       console.error('❌ Erro no bulk add:', error.message);
       await this.bot.sendMessage(msg.chat.id, '❌ Erro no bulk add.');
     }
   }
   
   async handleAdminPanel(msg) {
     if (!this.isAdmin(msg.from.id)) {
       await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
       return;
     }
     
     const message = `
 🔧 *Painel Administrativo*
 
 📋 *Comandos Disponíveis:*
 
 **👥 Gerenciamento de Grupos:**
 • \`/grupos\` - Listar grupos
 • \`/scrape <grupo_id>\` - Iniciar scraping
 • \`/membros <grupo_id>\` - Ver membros
 • \`/autoadd <user_id> <group_id>\` - Adicionar usuário
 • \`/bulkadd <group_id>\` - Adição em massa
 
 **💾 Backup & Replicação:**
 • \`/backup\` - Criar backup completo
 • \`/replicar <origem> <destino>\` - Replicar membros
 • \`/restaurar\` - Listar backups disponíveis
 • \`/limpar [dias]\` - Limpar backups antigos
 
 **📊 Monitoramento:**
 • \`/jobs\` - Ver jobs ativos
 • \`/logs\` - Ver logs recentes
 • \`/assinantes\` - Ver assinantes
 • \`/stats\` - Estatísticas básicas
 • \`/estatisticas\` - Estatísticas avançadas
 • \`/sistema\` - Informações do sistema
 
 **👥 Gerenciamento de Usuários:**
 • \`/usuarios\` - Listar usuários
 • \`/ban <user_id>\` - Banir usuário
 • \`/unban <user_id>\` - Desbanir usuário
 
 **⚙️ Configurações:**
 • \`/config\` - Ver configurações
 • \`/set <chave> <valor>\` - Alterar configuração
 
 **🤖 Auto-Post & IA:**
 • \`/autopost\` - Status do sistema
 • \`/startauto\` - Iniciar auto-post
 • \`/stopauto\` - Parar auto-post
 • \`/togglepost <id>\` - Ativar/desativar grupo
 • \`/dmstats\` - Estatísticas de DM
 • \`/testai\` - Testar geração de conteúdo
 
 💡 *Dica:* Sistema completo com IA, auto-post, DMs automáticas e monitoramento avançado.`;
     
     await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
   }

  // === MÉTODOS DE BACKUP E REPLICAÇÃO ===
  
  async handleBackup(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const loadingMsg = await this.bot.sendMessage(msg.chat.id, '🔄 Criando backup completo...');
      
      const backupFile = await this.backupManager.createFullBackup();
      const backups = await this.backupManager.listBackups();
      
      let response = `✅ **Backup criado com sucesso!**\n\n`;
      response += `📁 Arquivo: \`${require('path').basename(backupFile)}\`\n`;
      response += `📊 Total de backups: ${backups.length}\n\n`;
      response += `**Backups recentes:**\n`;
      
      backups.slice(0, 5).forEach(backup => {
        response += `• ${backup.filename} (${backup.age_days} dias)\n`;
      });
      
      await this.bot.editMessageText(response, {
        chat_id: msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      console.error('Erro no backup:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao criar backup: ${error.message}`);
    }
  }
  
  async handleReplicate(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    const sourceGroupId = match[1];
    const targetGroupId = match[2];
    const maxMembers = 100;
    
    try {
      const loadingMsg = await this.bot.sendMessage(msg.chat.id, '🔄 Iniciando replicação de membros...');
      
      const result = await this.backupManager.replicateMembers(sourceGroupId, targetGroupId, {
        maxMembers,
        onlyActive: true,
        excludeAdmins: true,
        delayBetweenAdds: 3000,
        onProgress: async (progress) => {
          if (progress.current % 10 === 0) {
            const progressText = `🔄 **Replicando membros...**\n\n` +
              `📊 Progresso: ${progress.current}/${progress.total} (${progress.progress}%)\n` +
              `✅ Sucessos: ${progress.success}\n` +
              `❌ Falhas: ${progress.failed}`;
            
            try {
              await this.bot.editMessageText(progressText, {
                chat_id: msg.chat.id,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
              });
            } catch (e) {
              // Ignora erros de edição
            }
          }
        }
      });
      
      let response = `✅ **Replicação concluída!**\n\n`;
      response += `📊 **Resultados:**\n`;
      response += `• Total processados: ${result.total}\n`;
      response += `• Sucessos: ${result.success}\n`;
      response += `• Falhas: ${result.failed}\n`;
      response += `• Taxa de sucesso: ${((result.success / result.total) * 100).toFixed(1)}%\n\n`;
      response += `🆔 Job ID: ${result.job_id}`;
      
      await this.bot.editMessageText(response, {
        chat_id: msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      console.error('Erro na replicação:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro na replicação: ${error.message}`);
    }
  }
  
  async handleRestore(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const backups = await this.backupManager.listBackups();
      
      if (backups.length === 0) {
        return await this.bot.sendMessage(msg.chat.id, '❌ Nenhum backup encontrado.');
      }
      
      let response = `📋 **Backups disponíveis:**\n\n`;
      
      backups.slice(0, 10).forEach((backup, index) => {
        const sizeKB = (backup.size / 1024).toFixed(1);
        response += `${index + 1}. \`${backup.filename}\`\n`;
        response += `   📅 ${backup.created.toLocaleDateString('pt-BR')}\n`;
        response += `   📦 ${sizeKB} KB (${backup.age_days} dias)\n\n`;
      });
      
      response += `⚠️ **Atenção:** Restauração ainda em desenvolvimento.\n`;
      response += `Use \`/backup\` para criar novos backups.`;
      
      await this.bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao listar backups:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao listar backups: ${error.message}`);
    }
  }
  
  async handleCleanup(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    const args = msg.text.split(' ');
    const daysToKeep = parseInt(args[1]) || 30;
    
    try {
      const loadingMsg = await this.bot.sendMessage(msg.chat.id, `🧹 Limpando backups com mais de ${daysToKeep} dias...`);
      
      const removedCount = await this.backupManager.cleanOldBackups(daysToKeep);
      const remainingBackups = await this.backupManager.listBackups();
      
      let response = `✅ **Limpeza concluída!**\n\n`;
      response += `🗑️ Backups removidos: ${removedCount}\n`;
      response += `📁 Backups restantes: ${remainingBackups.length}\n\n`;
      
      if (remainingBackups.length > 0) {
        response += `**Backups mais recentes:**\n`;
        remainingBackups.slice(0, 3).forEach(backup => {
          response += `• ${backup.filename} (${backup.age_days} dias)\n`;
        });
      }
      
      await this.bot.editMessageText(response, {
        chat_id: msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
       console.error('Erro na limpeza:', error);
       await this.bot.sendMessage(msg.chat.id, `❌ Erro na limpeza: ${error.message}`);
     }
   }

  // === COMANDOS ADMINISTRATIVOS AVANÇADOS ===
  
  async handleConfig(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const settings = await database.getAllSettings();
      
      let response = `⚙️ **Configurações do Sistema**\n\n`;
      
      if (settings.length === 0) {
        response += `ℹ️ Nenhuma configuração encontrada.\n\n`;
        response += `**Configurações padrão:**\n`;
        response += `• Rate limit: 30 segundos\n`;
        response += `• Max membros por job: 100\n`;
        response += `• Backup automático: 24h\n`;
      } else {
        settings.forEach(setting => {
          response += `• **${setting.key}**: \`${setting.value}\`\n`;
          if (setting.description) {
            response += `  _${setting.description}_\n`;
          }
          response += `\n`;
        });
      }
      
      response += `**Comandos:**\n`;
      response += `• \`/set <chave> <valor>\` - Alterar configuração\n`;
      response += `• \`/config\` - Ver configurações atuais`;
      
      await this.bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao buscar configurações:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao buscar configurações: ${error.message}`);
    }
  }
  
  async handleSetConfig(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    const key = match[1];
    const value = match[2];
    
    try {
      // Validações básicas
      const allowedKeys = [
        'rate_limit_seconds',
        'max_members_per_job',
        'backup_interval_hours',
        'auto_backup_enabled',
        'scraping_delay_ms',
        'max_concurrent_jobs'
      ];
      
      if (!allowedKeys.includes(key)) {
        return await this.bot.sendMessage(msg.chat.id, 
          `❌ Chave inválida. Chaves permitidas:\n${allowedKeys.map(k => `• ${k}`).join('\n')}`);
      }
      
      // Determina o tipo baseado na chave
      let type = 'string';
      if (key.includes('_seconds') || key.includes('_hours') || key.includes('_ms') || key.includes('max_')) {
        type = 'number';
      } else if (key.includes('_enabled')) {
        type = 'boolean';
      }
      
      await database.saveSetting(key, value, type, `Configurado via bot em ${new Date().toLocaleString('pt-BR')}`);
      
      await this.bot.sendMessage(msg.chat.id, 
        `✅ **Configuração atualizada!**\n\n• **${key}**: \`${value}\`\n\nUse \`/config\` para ver todas as configurações.`, 
        { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao salvar configuração: ${error.message}`);
    }
  }
  
  async handleAdvancedStats(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const loadingMsg = await this.bot.sendMessage(msg.chat.id, '📊 Gerando estatísticas avançadas...');
      
      // Gera estatísticas do dia
      const todayStats = await database.generateTodayStats();
      
      // Busca estatísticas dos últimos 7 dias
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekStats = await database.getDailyStats(weekAgo.toISOString().split('T')[0]);
      
      let response = `📊 **Estatísticas Avançadas**\n\n`;
      
      response += `**📅 Hoje (${new Date().toLocaleDateString('pt-BR')}):**\n`;
      response += `• 👥 Usuários totais: ${todayStats.total_users}\n`;
      response += `• ✅ Usuários ativos: ${todayStats.active_users}\n`;
      response += `• 📱 Grupos totais: ${todayStats.total_groups}\n`;
      response += `• 🔄 Jobs de scraping: ${todayStats.scraping_jobs}\n`;
      response += `• 💰 Receita: R$ ${(todayStats.revenue / 100).toFixed(2)}\n\n`;
      
      if (weekStats.length > 1) {
        const totalRevenue = weekStats.reduce((sum, day) => sum + (day.revenue || 0), 0);
        const totalNewMembers = weekStats.reduce((sum, day) => sum + (day.new_members || 0), 0);
        const totalJobs = weekStats.reduce((sum, day) => sum + (day.scraping_jobs || 0), 0);
        
        response += `**📈 Últimos 7 dias:**\n`;
        response += `• 💰 Receita total: R$ ${(totalRevenue / 100).toFixed(2)}\n`;
        response += `• 👥 Novos membros: ${totalNewMembers}\n`;
        response += `• 🔄 Jobs executados: ${totalJobs}\n`;
        response += `• 📊 Média diária: R$ ${(totalRevenue / 7 / 100).toFixed(2)}\n\n`;
      }
      
      response += `**🔧 Sistema:**\n`;
      response += `• ⏰ Uptime: ${process.uptime().toFixed(0)}s\n`;
      response += `• 💾 Memória: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB\n`;
      response += `• 🤖 Versão Node: ${process.version}`;
      
      await this.bot.editMessageText(response, {
        chat_id: msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      console.error('Erro ao gerar estatísticas:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao gerar estatísticas: ${error.message}`);
    }
  }
  
  async handleSystemInfo(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const uptime = process.uptime();
      const memory = process.memoryUsage();
      
      let response = `🖥️ **Informações do Sistema**\n\n`;
      
      response += `**⚡ Performance:**\n`;
      response += `• Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n`;
      response += `• Memória usada: ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MB\n`;
      response += `• Memória total: ${(memory.heapTotal / 1024 / 1024).toFixed(1)} MB\n`;
      response += `• CPU: ${process.cpuUsage().user}μs\n\n`;
      
      response += `**🔧 Ambiente:**\n`;
      response += `• Node.js: ${process.version}\n`;
      response += `• Plataforma: ${process.platform}\n`;
      response += `• Arquitetura: ${process.arch}\n\n`;
      
      response += `**📊 Bot:**\n`;
      response += `• Admins configurados: ${this.adminIds.length}\n`;
      response += `• Polling ativo: ✅\n`;
      response += `• Backup automático: ⏰`;
      
      await this.bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao buscar info do sistema:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao buscar informações: ${error.message}`);
    }
  }
  
  async handleUsers(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const users = await database.all(`
        SELECT telegram_id, username, first_name, status, 
               subscription_end, created_at, is_active
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 20
      `);
      
      let response = `👥 **Usuários Recentes (${users.length})**\n\n`;
      
      users.forEach((user, index) => {
        const status = user.status === 'active' ? '✅' : user.status === 'expired' ? '⏰' : '❌';
        const name = user.first_name || user.username || 'Sem nome';
        const created = new Date(user.created_at).toLocaleDateString('pt-BR');
        
        response += `${index + 1}. ${status} **${name}**\n`;
        response += `   ID: \`${user.telegram_id}\`\n`;
        response += `   Status: ${user.status}\n`;
        response += `   Criado: ${created}\n\n`;
      });
      
      response += `**Comandos:**\n`;
      response += `• \`/ban <user_id>\` - Banir usuário\n`;
      response += `• \`/unban <user_id>\` - Desbanir usuário`;
      
      await this.bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao listar usuários:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao listar usuários: ${error.message}`);
    }
  }
  
  async handleBanUser(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    const userId = match[1];
    
    try {
      await database.run('UPDATE users SET is_active = 0, status = "banned" WHERE telegram_id = ?', [userId]);
      
      await database.saveActionLog('user_banned', userId, null, {
        banned_by: msg.from.id,
        reason: 'Banido via comando admin'
      });
      
      await this.bot.sendMessage(msg.chat.id, 
        `✅ **Usuário banido!**\n\n• ID: \`${userId}\`\n• Ação: Banimento\n• Admin: ${msg.from.first_name}`, 
        { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao banir usuário:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao banir usuário: ${error.message}`);
    }
  }
  
  async handleUnbanUser(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    const userId = match[1];
    
    try {
      await database.run('UPDATE users SET is_active = 1, status = "inactive" WHERE telegram_id = ?', [userId]);
      
      await database.saveActionLog('user_unbanned', userId, null, {
        unbanned_by: msg.from.id,
        reason: 'Desbanido via comando admin'
      });
      
      await this.bot.sendMessage(msg.chat.id, 
        `✅ **Usuário desbanido!**\n\n• ID: \`${userId}\`\n• Ação: Desbloqueio\n• Admin: ${msg.from.first_name}`, 
        { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao desbanir usuário:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao desbanir usuário: ${error.message}`);
    }
  }

  // Capturar novos membros automaticamente
  async handleNewChatMembers(msg) {
    try {
      const groupId = msg.chat.id.toString();
      const groupName = msg.chat.title || 'Grupo sem nome';
      
      // Salvar informações do grupo
      await this.groupManager.saveGroup({
        telegram_id: groupId,
        name: groupName,
        type: msg.chat.type,
        member_count: await this.getChatMemberCount(groupId)
      });
      
      // Salvar cada novo membro
      for (const member of msg.new_chat_members) {
        if (!member.is_bot) {
          await this.groupManager.saveMember({
            user_id: member.id.toString(),
            group_id: groupId,
            username: member.username,
            first_name: member.first_name,
            last_name: member.last_name,
            is_active: true
          });
          
          console.log(`✅ Novo membro capturado: ${member.first_name} (${member.id}) no grupo ${groupName}`);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao capturar novos membros:', error.message);
    }
  }
  
  async handleLeftChatMember(msg) {
    try {
      const groupId = msg.chat.id.toString();
      const userId = msg.left_chat_member.id.toString();
      
      // Marcar membro como inativo
      await this.groupManager.updateMemberStatus(userId, groupId, false);
      
      console.log(`👋 Membro saiu: ${msg.left_chat_member.first_name} (${userId}) do grupo ${msg.chat.title}`);
    } catch (error) {
      console.error('❌ Erro ao processar saída de membro:', error.message);
    }
  }
  
  async handleMessage(msg) {
    try {
      // Registra interação do usuário para sistema de DM
      if (msg.from && msg.from.id && !msg.from.is_bot) {
        await this.autoPostManager.registerUserInteraction(
          msg.from.id, 
          'message', 
          msg.chat.id
        );
      }
      
      // Capturar mensagens de grupos para identificar membros ativos
      if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        const groupId = msg.chat.id.toString();
        const userId = msg.from.id.toString();
        const groupName = msg.chat.title || 'Grupo sem nome';
        
        // Salvar/atualizar informações do grupo
        await this.groupManager.saveGroup({
          telegram_id: groupId,
          name: groupName,
          type: msg.chat.type,
          member_count: await this.getChatMemberCount(groupId)
        });
        
        // Salvar/atualizar membro se não for bot
        if (!msg.from.is_bot) {
          await this.groupManager.saveMember({
            user_id: userId,
            group_id: groupId,
            username: msg.from.username,
            first_name: msg.from.first_name,
            last_name: msg.from.last_name,
            is_active: true
          });
        }
      }
    } catch (error) {
      console.error('❌ Erro ao processar mensagem:', error.message);
    }
  }
  
  async getChatMemberCount(chatId) {
    try {
      const count = await this.bot.getChatMemberCount(chatId);
      return count;
    } catch (error) {
      console.error('❌ Erro ao obter contagem de membros:', error.message);
      return 0;
    }
  }
  
  // === MÉTODOS DE AUTO-POST ===
  
  initializeAutoPost() {
    try {
      this.autoPostManager.startScheduler();
      console.log('✅ Sistema de auto-post inicializado');
    } catch (error) {
      console.error('❌ Erro ao inicializar auto-post:', error.message);
    }
  }
  
  async handleAutoPost(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const status = await this.autoPostManager.getStatus();
      const stats = await this.autoPostManager.getStats();
      
      let response = `🤖 **Sistema de Auto-Post**\n\n`;
      response += `**📊 Status:**\n`;
      response += `• Sistema: ${status.isActive ? '✅ Ativo' : '❌ Inativo'}\n`;
      response += `• Grupos ativos: ${status.activeGroups}\n`;
      response += `• Próximo post: ${status.nextPost || 'N/A'}\n\n`;
      
      response += `**📈 Estatísticas:**\n`;
      response += `• Posts hoje: ${stats.postsToday}\n`;
      response += `• Posts esta semana: ${stats.postsThisWeek}\n`;
      response += `• Total de posts: ${stats.totalPosts}\n`;
      response += `• Taxa de sucesso: ${stats.successRate}%\n\n`;
      
      response += `**🎯 Comandos:**\n`;
      response += `• \`/startauto\` - Iniciar sistema\n`;
      response += `• \`/stopauto\` - Parar sistema\n`;
      response += `• \`/togglepost <grupo_id>\` - Ativar/desativar grupo\n`;
      response += `• \`/dmstats\` - Estatísticas de DM\n`;
      response += `• \`/testai\` - Testar geração de conteúdo`;
      
      await this.bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro no comando autopost:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao buscar status: ${error.message}`);
    }
  }
  
  async handleStartAuto(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const result = await this.autoPostManager.start();
      
      if (result.success) {
        await this.bot.sendMessage(msg.chat.id, 
          `✅ **Sistema de auto-post iniciado!**\n\n• Grupos ativos: ${result.activeGroups}\n• Próximo post: ${result.nextPost}`);
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro ao iniciar: ${result.error}`);
      }
    } catch (error) {
      console.error('Erro ao iniciar auto-post:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao iniciar sistema: ${error.message}`);
    }
  }
  
  async handleStopAuto(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const result = await this.autoPostManager.stop();
      
      if (result.success) {
        await this.bot.sendMessage(msg.chat.id, 
          `🛑 **Sistema de auto-post parado!**\n\n• Posts realizados hoje: ${result.postsToday}\n• Sistema estava ativo por: ${result.uptime}`);
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro ao parar: ${result.error}`);
      }
    } catch (error) {
      console.error('Erro ao parar auto-post:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao parar sistema: ${error.message}`);
    }
  }
  
  async handleTogglePost(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    const groupId = match[1];
    
    try {
      const result = await this.autoPostManager.toggleGroup(groupId);
      
      if (result.success) {
        const status = result.enabled ? 'ativado' : 'desativado';
        await this.bot.sendMessage(msg.chat.id, 
          `✅ **Auto-post ${status} para o grupo!**\n\n• Grupo: ${groupId}\n• Status: ${result.enabled ? '✅ Ativo' : '❌ Inativo'}`);
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro: ${result.error}`);
      }
    } catch (error) {
      console.error('Erro ao alternar grupo:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao alternar grupo: ${error.message}`);
    }
  }
  
  async handleDMStats(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const stats = await this.autoPostManager.getDMStats();
      
      let response = `📱 **Estatísticas de DM**\n\n`;
      response += `**📊 Hoje:**\n`;
      response += `• DMs enviadas: ${stats.today.sent}\n`;
      response += `• Sucessos: ${stats.today.success}\n`;
      response += `• Falhas: ${stats.today.failed}\n`;
      response += `• Taxa de sucesso: ${stats.today.successRate}%\n\n`;
      
      response += `**📈 Esta semana:**\n`;
      response += `• Total de DMs: ${stats.week.total}\n`;
      response += `• Média diária: ${stats.week.dailyAverage}\n`;
      response += `• Conversões: ${stats.week.conversions}\n\n`;
      
      response += `**🎯 Performance:**\n`;
      response += `• Melhor dia: ${stats.performance.bestDay}\n`;
      response += `• Melhor horário: ${stats.performance.bestHour}h\n`;
      response += `• Taxa geral: ${stats.performance.overallRate}%`;
      
      await this.bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Erro ao buscar stats de DM:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao buscar estatísticas: ${error.message}`);
    }
  }
  
  async handleTestAI(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const loadingMsg = await this.bot.sendMessage(msg.chat.id, '🤖 Testando geração de conteúdo com IA...');
      
      const testContent = await this.geminiAI.generateContent({
        type: 'promotional',
        topic: 'teste do sistema',
        style: 'engaging'
      });
      
      let response = `🤖 **Teste de Geração de Conteúdo**\n\n`;
      response += `**📝 Conteúdo gerado:**\n${testContent.text}\n\n`;
      response += `**📊 Detalhes:**\n`;
      response += `• Tipo: ${testContent.type}\n`;
      response += `• Palavras: ${testContent.wordCount}\n`;
      response += `• Tempo: ${testContent.generationTime}ms\n`;
      response += `• Qualidade: ${testContent.quality}/10`;
      
      await this.bot.editMessageText(response, {
        chat_id: msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      console.error('Erro no teste de IA:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro no teste: ${error.message}`);
    }
  }

  // Para o bot
  stop() {
    if (this.autoPostManager) {
      this.autoPostManager.stop();
    }
    if (this.bot) {
      this.bot.stopPolling();
      console.log('🛑 Bot Telegram parado');
    }
  }
}

module.exports = TelegramSubscriptionBot;