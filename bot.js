const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const fetch = require('node-fetch');
const database = require('./db');
const infinitePayService = require('./services/infinitepay');
const GroupManager = require('./services/groupManager');
const BackupManager = require('./services/backupManager');
const AutoPostManager = require('./services/autoPostManager');
const GeminiAIService = require('./services/geminiAI');
const IdentifierResolver = require('./utils/identifierResolver');
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
    
    // Usar polling em desenvolvimento local para evitar conflito com Railway
    const isLocal = process.env.NODE_ENV === 'development';
    
    if (isLocal) {
      // Modo polling para desenvolvimento local
      this.bot = new TelegramBot(this.token, { polling: true });
      console.log('🔄 Bot configurado em modo polling (local)');
    } else {
      // Modo webhook para produção (Railway)
      this.bot = new TelegramBot(this.token, { webHook: true });
      console.log('🔄 Bot configurado em modo webhook (produção)');
      
      // Configura webhook do Telegram
      this.setupWebhook();
    }
    
    // Inicializa serviços após criar o bot
    this.groupManager = new GroupManager(this.bot, database);
    this.backupManager = new BackupManager();
    this.autoPostManager = new AutoPostManager(this.bot);
    this.geminiAI = new GeminiAIService();
    this.identifierResolver = new IdentifierResolver(this.bot);
    
    this.setupHandlers();
    
    console.log('🤖 Bot Telegram inicializado');
  }

  // Configura webhook do Telegram para produção
  async setupWebhook() {
    try {
      const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
      
      if (!webhookUrl) {
        console.error('❌ TELEGRAM_WEBHOOK_URL não configurada');
        return;
      }
      
      // Remove webhook existente
      await this.bot.deleteWebHook();
      console.log('🗑️ Webhook anterior removido');
      
      // Configura novo webhook
      await this.bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook configurado: ${webhookUrl}`);
      
      // Verifica se webhook foi configurado corretamente
      const webhookInfo = await this.bot.getWebHookInfo();
      console.log('📋 Info do webhook:', {
        url: webhookInfo.url,
        has_custom_certificate: webhookInfo.has_custom_certificate,
        pending_update_count: webhookInfo.pending_update_count,
        last_error_date: webhookInfo.last_error_date,
        last_error_message: webhookInfo.last_error_message
      });
      
    } catch (error) {
      console.error('❌ Erro ao configurar webhook:', error.message);
    }
  }

  // Configura todos os handlers do bot
  setupHandlers() {
    // Comando /start
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    
    // Comandos admin
    this.bot.onText(/\/assinantes/, (msg) => this.handleAssinantes(msg));
    this.bot.onText(/\/reenviar (.+)/, (msg, match) => this.handleReenviar(msg, match));
    this.bot.onText(/\/stats/, (msg) => this.handleStats(msg));
    
    // Novos comandos administrativos com suporte a @ e links
    this.bot.onText(/\/grupos/, (msg) => this.handleGroups(msg));
    this.bot.onText(/\/scrape (.+)/, (msg, match) => this.handleStartScraping(msg, match));
    this.bot.onText(/\/addgrupo (.+) (.+)/, (msg, match) => this.handleAddGroupWithIdentifier(msg, match));
    this.bot.onText(/\/membros (.+)/, (msg, match) => this.handleGroupMembers(msg, match));
    this.bot.onText(/\/replicar (.+) (.+)/, (msg, match) => this.handleReplicateMembers(msg, match));
    this.bot.onText(/\/autoadd (.+) (.+)/, (msg, match) => this.handleAutoAdd(msg, match));
    this.bot.onText(/\/usuario (.+)/, (msg, match) => this.handleUserInfo(msg, match));
    this.bot.onText(/\/grupo (.+)/, (msg, match) => this.handleGroupInfo(msg, match));
    this.bot.onText(/\/bulkadd (.+)/, (msg, match) => this.handleBulkAdd(msg, match));
    this.bot.onText(/\/jobs/, (msg) => this.handleScrapingJobs(msg));
    this.bot.onText(/\/logs/, (msg) => this.handleLogs(msg));
    this.bot.onText(/\/admin/, (msg) => this.handleAdminPanel(msg));
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
      
      // Verifica se o comando foi executado em um grupo
      if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        const botUsername = this.bot.options.username || process.env.BOT_USERNAME;
        const privateLink = `https://t.me/${botUsername}?start=grupo`;
        
        await this.bot.sendMessage(chatId, 
          `🤖 Olá ${user.first_name}!\n\n` +
          `Para usar o bot, você precisa conversar comigo no chat privado.\n\n` +
          `👆 Clique no link abaixo para iniciar:\n${privateLink}`,
          {
            parse_mode: 'Markdown',
            reply_to_message_id: msg.message_id
          }
        );
        return;
      }
      
      console.log(`👤 Usuário ${user.first_name} (${user.id}) iniciou conversa`);
      
      // Busca ou cria usuário no banco
      const dbUser = await database.findOrCreateUser(user);
      
      // Verificação de segurança para garantir que o usuário foi criado corretamente
      if (!dbUser) {
        console.error('❌ Erro: falha ao criar/buscar usuário no banco de dados');
        await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente em alguns segundos.');
        return;
      }
      
      console.log(`✅ Usuário carregado:`, {
        id: dbUser.id,
        telegram_id: dbUser.telegram_id,
        status: dbUser.status || 'inactive'
      });
      
      // Monta mensagem de apresentação
      const productName = process.env.PRODUCT_NAME || 'Produto Premium';
      const productDescription = process.env.PRODUCT_DESCRIPTION || 'Acesso exclusivo ao conteúdo VIP';
      const subscriptionPrice = parseInt(process.env.SUBSCRIPTION_PRICE) || 4990;
      const priceFormatted = infinitePayService.formatCurrency(subscriptionPrice);
      
      const welcomeMessage = `🎯 *${productName.replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&')}*

${productDescription.replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&')}

💰 *${priceFormatted.replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&')} / mês*

${this.getSubscriptionStatusMessage(dbUser)}

📱 Clique no botão abaixo para assinar:`;
      
      const keyboard = this.getMainKeyboard(dbUser);
      
      // Envia imagem se configurada e válida
      const productImageUrl = process.env.PRODUCT_IMAGE_URL;
      
      if (productImageUrl && productImageUrl.trim() && productImageUrl.startsWith('http') && !productImageUrl.includes('exemplo.com')) {
        try {
          // Valida se a URL é uma imagem válida
          const response = await fetch(productImageUrl, { method: 'HEAD' });
          const contentType = response.headers.get('content-type');
          
          if (response.ok && contentType && contentType.startsWith('image/')) {
            await this.bot.sendPhoto(chatId, productImageUrl, {
              caption: welcomeMessage,
              parse_mode: 'Markdown',
              reply_markup: keyboard
            });
          } else {
            throw new Error('URL não retorna uma imagem válida');
          }
        } catch (imageError) {
          console.warn('⚠️ Erro ao enviar imagem, enviando apenas texto:', imageError.message);
          await this.bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        }
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
    // Verificação de segurança para evitar erro de propriedade undefined
    if (!user || typeof user !== 'object') {
      console.error('❌ Erro: usuário undefined ou inválido em getSubscriptionStatusMessage');
      return '🔓 *Sem Assinatura Ativa*\nAssine para ter acesso completo';
    }
    
    // Define status padrão se não existir
    const status = user.status || 'inactive';
    
    if (status === 'active' && user.subscription_end) {
      try {
        const endDate = moment(user.subscription_end).format('DD/MM/YYYY');
        return `✅ *Assinatura Ativa*\nVálida até: ${endDate}`;
      } catch (dateError) {
        console.warn('⚠️ Erro ao formatar data de expiração:', dateError.message);
        return '✅ *Assinatura Ativa*\nData de expiração indisponível';
      }
    } else if (status === 'expired') {
      return '⏰ *Assinatura Expirada*\nRenove para continuar acessando';
    } else {
      return '🔓 *Sem Assinatura Ativa*\nAssine para ter acesso completo';
    }
  }

  // Retorna teclado principal baseado no status do usuário
  getMainKeyboard(user) {
    const buttons = [];
    
    // Verificação de segurança para usuário válido
    if (!user || typeof user !== 'object') {
      console.warn('⚠️ Usuário inválido em getMainKeyboard, usando botões padrão');
      buttons.push([{ text: '👉 Assinar Agora', callback_data: 'subscribe_now' }]);
      buttons.push([{ text: '📞 Suporte', callback_data: 'support' }]);
      return { inline_keyboard: buttons };
    }
    
    const status = user.status || 'inactive';
    
    if (status === 'active') {
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
          
        case 'subscription':
          await this.handleSubscription(chatId, userId);
          break;
          
        case 'subscribe_now':
          await this.handleSubscription(chatId, userId);
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
          
        // Novos planos de assinatura
        case 'plan_week':
          await this.handlePlanWeek(chatId, userId);
          break;
          
        case 'plan_month':
          await this.handlePlanMonth(chatId, userId);
          break;
          
        case 'plan_year':
          await this.handlePlanYear(chatId, userId);
          break;
          
        case 'back_main':
          await this.handleStart({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks do painel administrativo
        case 'admin_grupos':
          await this.handleAdminGrupos(callbackQuery);
          break;
          
        case 'admin_stats':
          await this.handleAdminStats(callbackQuery);
          break;
          
        case 'admin_usuarios':
          await this.handleAdminUsuarios(callbackQuery);
          break;
          
        case 'admin_backup':
          await this.handleAdminBackup(callbackQuery);
          break;
          
        case 'admin_autopost':
          await this.handleAdminAutoPost(callbackQuery);
          break;
          
        case 'admin_sistema':
          await this.handleAdminSistema(callbackQuery);
          break;
          
        case 'admin_config':
          await this.handleAdminConfig(callbackQuery);
          break;
          
        case 'admin_jobs':
          await this.handleAdminJobs(callbackQuery);
          break;
          
        case 'admin_refresh':
          await this.handleAdminPanel({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks específicos - Grupos
        case 'grupos_listar':
          await this.handleGroups({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'grupos_membros':
          await this.bot.sendMessage(chatId, '👥 Para ver membros de um grupo, use: `/members <grupo_id>`\n\nPrimeiro liste os grupos para ver os IDs disponíveis.', { parse_mode: 'Markdown' });
          break;
          
        case 'grupos_scraping':
          await this.bot.sendMessage(chatId, '🔍 Para iniciar scraping, use: `/scrape <grupo_id>`\n\nPrimeiro liste os grupos para ver os IDs disponíveis.', { parse_mode: 'Markdown' });
          break;
          
        case 'grupos_add_user':
          await this.bot.sendMessage(chatId, '➕ Para adicionar usuário, use: `/autoadd <grupo_id> <user_id>`\n\nExemplo: `/autoadd 123456789 987654321`', { parse_mode: 'Markdown' });
          break;
          
        case 'grupos_bulk_add':
          await this.bot.sendMessage(chatId, '📦 Para adição em massa, use: `/bulkadd <grupo_origem> <grupo_destino> <quantidade>`\n\nExemplo: `/bulkadd 123456789 987654321 50`', { parse_mode: 'Markdown' });
          break;
          
        case 'grupos_replicar':
          await this.bot.sendMessage(chatId, '🔄 Para replicar membros, use: `/replicate <grupo_origem> <grupo_destino>`\n\nExemplo: `/replicate @grupo1 @grupo2`', { parse_mode: 'Markdown' });
          break;
          
        case 'grupos_jobs':
          await this.handleScrapingJobs({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'grupos_add_grupo':
          await this.handleAddGroup({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks específicos - Stats
        case 'stats_basicas':
          await this.handleStats({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'stats_avancadas':
          await this.handleAdvancedStats({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'stats_assinantes':
          await this.handleAssinantes({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'stats_dm':
          await this.handleDMStats({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'stats_logs':
          await this.handleLogs({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'stats_sistema':
        case 'sistema_info':
          await this.handleSystemInfo({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'sistema_stats':
          await this.handleAdvancedStats({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'sistema_logs':
          await this.handleLogs({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'sistema_status':
          await this.handleAutoPost({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks específicos - Usuários
        case 'users_listar':
          await this.handleUsers({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'users_ban':
          await this.bot.sendMessage(chatId, '🚫 Para banir um usuário, use: `/ban <user_id>`', { parse_mode: 'Markdown' });
          break;
          
        case 'users_unban':
          await this.bot.sendMessage(chatId, '✅ Para desbanir um usuário, use: `/unban <user_id>`', { parse_mode: 'Markdown' });
          break;
          
        case 'users_buscar':
          await this.bot.sendMessage(chatId, '🔍 Para buscar um usuário, use: `/userinfo <user_id>`\n\nExemplo: `/userinfo 123456789`', { parse_mode: 'Markdown' });
          break;
          
        // Callbacks específicos - Backup
        case 'backup_criar':
          await this.handleBackup({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'backup_listar':
          await this.bot.sendMessage(chatId, '📋 **Backups Disponíveis**\n\nUse `/backup` para ver a lista completa de backups disponíveis.', { parse_mode: 'Markdown' });
          break;
          
        case 'backup_restaurar':
          await this.handleRestore({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'backup_limpar':
          await this.handleCleanup({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks específicos - AutoPost
        case 'autopost_status':
          await this.handleAutoPost({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'autopost_start':
          await this.handleStartAuto({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'autopost_stop':
          await this.handleStopAuto({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'autopost_toggle':
          await this.bot.sendMessage(chatId, '🔄 Para alternar auto-post em um grupo, use: `/toggle <grupo_id>`\n\nExemplo: `/toggle 123456789`', { parse_mode: 'Markdown' });
          break;
          
        case 'autopost_test_ai':
          await this.handleTestAI({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'autopost_dm_stats':
          await this.handleDMStats({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks específicos - Config
        case 'config_ver':
          await this.handleConfig({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        // Callbacks específicos - Jobs
        case 'jobs_ativos':
          await this.handleScrapingJobs({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'jobs_scraping':
          await this.handleScrapingJobs({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        default:
          console.log(`❓ Callback não reconhecido: ${data}`);
          await this.bot.sendMessage(chatId, `⚠️ Função "${data}" ainda não implementada.\n\nEm breve estará disponível!`, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error('❌ Erro no callback query:', error.message);
      
      // Ignora erros específicos do Telegram que não são críticos
      if (error.message && (
        error.message.includes('message is not modified') ||
        error.message.includes('Bad Request: message is not modified') ||
        error.message.includes('can\'t parse entities') ||
        error.message.includes('Bad Request: can\'t parse entities')
      )) {
        console.log('⚠️ Erro conhecido do Telegram - ignorando:', error.message);
        return;
      }
      
      // Verifica se callbackQuery e suas propriedades existem antes de usar
      if (!callbackQuery || !callbackQuery.message || !callbackQuery.message.chat) {
        console.error('❌ CallbackQuery inválido ou incompleto');
        return;
      }
      
      // Para outros erros, notifica o usuário
      try {
        await this.bot.sendMessage(callbackQuery.message.chat.id, '❌ Erro interno. Tente novamente.');
      } catch (sendError) {
        console.error('❌ Erro ao enviar mensagem de erro:', sendError.message);
      }
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
      
      // Apresenta opções de planos
      await this.bot.sendMessage(chatId, 
        '💎 **ESCOLHA SEU PLANO PREMIUM**\n\n' +
        '🔥 Acesso total ao conteúdo exclusivo +18\n' +
        '📱 Conteúdo premium ilimitado\n' +
        '🎯 Suporte prioritário\n\n' +
        '💰 **PLANOS DISPONÍVEIS:**',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⚡ 1 Semana - R$ 20,00', callback_data: 'plan_week' }
              ],
              [
                { text: '🔥 1 Mês - R$ 35,00', callback_data: 'plan_month' }
              ],
              [
                { text: '💎 1 Ano - R$ 145,00 (MELHOR OFERTA)', callback_data: 'plan_year' }
              ],
              [
                { text: '🔙 Voltar', callback_data: 'back_main' }
              ]
            ]
          }
        }
      );
      
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

  // Métodos para planos específicos
  async handlePlanWeek(chatId, userId) {
    try {
      const user = await database.getUserByTelegramId(userId);
      
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Usuário não encontrado. Use /start primeiro.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        '⚡ **PLANO SEMANAL - R$ 20,00**\n\n' +
        '🔥 7 dias de acesso total\n' +
        '📱 Conteúdo premium ilimitado\n' +
        '🎯 Suporte prioritário\n\n' +
        '💳 **Clique no link abaixo para pagar:**',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                 { text: '💳 Pagar R$ 20,00 - 1 Semana', url: process.env.PLAN_WEEK_LINK }
               ],
              [
                { text: '🔙 Voltar aos Planos', callback_data: 'subscribe_now' }
              ]
            ]
          }
        }
      );
      
      console.log(`⚡ Usuário ${userId} selecionou plano semanal`);
      
    } catch (error) {
      console.error('❌ Erro no plano semanal:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
    }
  }

  async handlePlanMonth(chatId, userId) {
    try {
      const user = await database.getUserByTelegramId(userId);
      
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Usuário não encontrado. Use /start primeiro.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        '🔥 **PLANO MENSAL - R$ 35,00**\n\n' +
        '💎 30 dias de acesso total\n' +
        '📱 Conteúdo premium ilimitado\n' +
        '🎯 Suporte prioritário\n' +
        '💰 Economia de R$ 25,00 vs semanal\n\n' +
        '💳 **Clique no link abaixo para pagar:**',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                 { text: '💳 Pagar R$ 35,00 - 1 Mês', url: process.env.PLAN_MONTH_LINK }
               ],
              [
                { text: '🔙 Voltar aos Planos', callback_data: 'subscribe_now' }
              ]
            ]
          }
        }
      );
      
      console.log(`🔥 Usuário ${userId} selecionou plano mensal`);
      
    } catch (error) {
      console.error('❌ Erro no plano mensal:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
    }
  }

  async handlePlanYear(chatId, userId) {
    try {
      const user = await database.getUserByTelegramId(userId);
      
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Usuário não encontrado. Use /start primeiro.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        '💎 **PLANO ANUAL - R$ 145,00**\n\n' +
        '🏆 365 dias de acesso total\n' +
        '📱 Conteúdo premium ilimitado\n' +
        '🎯 Suporte prioritário VIP\n' +
        '💰 **ECONOMIA DE R$ 275,00** vs mensal\n' +
        '🎁 **MELHOR OFERTA DISPONÍVEL**\n\n' +
        '💳 **Clique no link abaixo para pagar:**',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                 { text: '💳 Pagar R$ 145,00 - 1 Ano', url: process.env.PLAN_YEAR_LINK }
               ],
              [
                { text: '🔙 Voltar aos Planos', callback_data: 'subscribe_now' }
              ]
            ]
          }
        }
      );
      
      console.log(`💎 Usuário ${userId} selecionou plano anual`);
      
    } catch (error) {
      console.error('❌ Erro no plano anual:', error.message);
      await this.bot.sendMessage(chatId, '❌ Erro interno. Tente novamente.');
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
          message += `• ${group.title} (${group.telegram_id})\n`;
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
    
    try {
      await this.bot.sendMessage(msg.chat.id, 
        '➕ **Adicionar Novo Grupo**\n\n' +
        'Para adicionar um grupo, use o comando:\n' +
        '`/addgrupo <identificador> <nome>`\n\n' +
        '**Exemplos:**\n' +
        '• `/addgrupo @meugrupo Meu Grupo`\n' +
        '• `/addgrupo https://t.me/meugrupo Meu Grupo`\n' +
        '• `/addgrupo -1001234567890 Meu Grupo`\n\n' +
        '**Identificadores válidos:**\n' +
        '• @nomegrupo\n' +
        '• https://t.me/nomegrupo\n' +
        '• ID numérico do grupo',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Erro ao mostrar instruções de adicionar grupo:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro interno.');
    }
  }

  async handleAddGroupWithIdentifier(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const identifier = match[1];
      const groupName = match[2];
      
      // Valida o identificador
      if (!this.identifierResolver.isValidIdentifier(identifier, 'group')) {
        await this.bot.sendMessage(msg.chat.id, '❌ Identificador inválido. Use:\n• @nomegrupo\n• https://t.me/nomegrupo\n• ID numérico');
        return;
      }
      
      await this.bot.sendMessage(msg.chat.id, '🔄 Resolvendo identificador do grupo...');
      
      const groupInfo = await this.identifierResolver.resolveGroup(identifier);
      
      if (!groupInfo) {
        await this.bot.sendMessage(msg.chat.id, '❌ Grupo não encontrado ou não acessível.');
        return;
      }
      
      // Adiciona o grupo ao banco de dados
      const result = await this.groupManager.addGroup(groupInfo.id, groupName, groupInfo.username);
      
      if (result.success) {
        const formattedInfo = this.identifierResolver.formatIdentifier(groupInfo);
        await this.bot.sendMessage(msg.chat.id, 
          `✅ Grupo adicionado com sucesso!\n\n` +
          `📋 **Informações:**\n` +
          `• Nome: ${groupName}\n` +
          `• Grupo: ${formattedInfo}\n` +
          `• Membros: ${groupInfo.member_count}\n` +
          `• Tipo: ${groupInfo.type}`, 
          { parse_mode: 'Markdown' }
        );
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro ao adicionar grupo: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Erro ao adicionar grupo:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro interno ao adicionar grupo.');
    }
  }

  async handleUserInfo(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const identifier = match[1];
      
      if (!this.identifierResolver.isValidIdentifier(identifier, 'user')) {
        await this.bot.sendMessage(msg.chat.id, '❌ Identificador de usuário inválido. Use:\n• @username\n• ID numérico');
        return;
      }
      
      await this.bot.sendMessage(msg.chat.id, '🔄 Buscando informações do usuário...');
      
      const userInfo = await this.identifierResolver.resolveUser(identifier);
      
      if (!userInfo) {
        await this.bot.sendMessage(msg.chat.id, '❌ Usuário não encontrado ou não acessível.');
        return;
      }
      
      const formattedInfo = this.identifierResolver.formatIdentifier(userInfo);
      
      await this.bot.sendMessage(msg.chat.id, 
        `👤 **Informações do Usuário:**\n\n` +
        `• ${formattedInfo}\n` +
        `• ID: \`${userInfo.id}\`\n` +
        `• Username: ${userInfo.username ? `@${userInfo.username}` : 'Não definido'}\n` +
        `• Nome: ${userInfo.first_name || 'Não definido'}\n` +
        `• Sobrenome: ${userInfo.last_name || 'Não definido'}`, 
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Erro ao buscar usuário:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro interno ao buscar usuário.');
    }
  }

  async handleGroupInfo(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const identifier = match[1];
      
      if (!this.identifierResolver.isValidIdentifier(identifier, 'group')) {
        await this.bot.sendMessage(msg.chat.id, '❌ Identificador de grupo inválido. Use:\n• @nomegrupo\n• https://t.me/nomegrupo\n• ID numérico');
        return;
      }
      
      await this.bot.sendMessage(msg.chat.id, '🔄 Buscando informações do grupo...');
      
      const groupInfo = await this.identifierResolver.resolveGroup(identifier);
      
      if (!groupInfo) {
        await this.bot.sendMessage(msg.chat.id, '❌ Grupo não encontrado ou não acessível.');
        return;
      }
      
      const formattedInfo = this.identifierResolver.formatIdentifier(groupInfo);
      
      await this.bot.sendMessage(msg.chat.id, 
        `👥 **Informações do Grupo:**\n\n` +
        `• ${formattedInfo}\n` +
        `• ID: \`${groupInfo.id}\`\n` +
        `• Username: ${groupInfo.username ? `@${groupInfo.username}` : 'Não definido'}\n` +
        `• Título: ${groupInfo.title}\n` +
        `• Tipo: ${groupInfo.type}\n` +
        `• Membros: ${groupInfo.member_count}`, 
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Erro ao buscar grupo:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro interno ao buscar grupo.');
    }
  }

  async handleGroupMembers(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
      return;
    }
    
    try {
      const identifier = match[1];
      
      if (!this.identifierResolver.isValidIdentifier(identifier, 'group')) {
        await this.bot.sendMessage(msg.chat.id, '❌ Identificador de grupo inválido. Use:\n• @nomegrupo\n• https://t.me/nomegrupo\n• ID numérico');
        return;
      }
      
      await this.bot.sendMessage(msg.chat.id, '🔄 Resolvendo grupo e buscando membros...');
      
      const groupInfo = await this.identifierResolver.resolveGroup(identifier);
      
      if (!groupInfo) {
        await this.bot.sendMessage(msg.chat.id, '❌ Grupo não encontrado ou não acessível.');
        return;
      }
      
      const members = await this.groupManager.getGroupMembers(groupInfo.id);
      const formattedInfo = this.identifierResolver.formatIdentifier(groupInfo);
      
      let message = `👥 **Membros do Grupo:**\n${formattedInfo}\n\n`;
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
      const sourceIdentifier = match[1];
      const targetIdentifier = match[2];
      
      // Valida identificadores
      if (!this.identifierResolver.isValidIdentifier(sourceIdentifier, 'group') || 
          !this.identifierResolver.isValidIdentifier(targetIdentifier, 'group')) {
        await this.bot.sendMessage(msg.chat.id, '❌ Identificadores inválidos. Use:\n• @nomegrupo\n• https://t.me/nomegrupo\n• ID numérico');
        return;
      }
      
      await this.bot.sendMessage(msg.chat.id, '🔄 Resolvendo grupos...');
      
      const [sourceGroup, targetGroup] = await Promise.all([
        this.identifierResolver.resolveGroup(sourceIdentifier),
        this.identifierResolver.resolveGroup(targetIdentifier)
      ]);
      
      if (!sourceGroup || !targetGroup) {
        await this.bot.sendMessage(msg.chat.id, '❌ Um ou ambos os grupos não foram encontrados.');
        return;
      }
      
      const sourceFormatted = this.identifierResolver.formatIdentifier(sourceGroup);
      const targetFormatted = this.identifierResolver.formatIdentifier(targetGroup);
      
      await this.bot.sendMessage(msg.chat.id, 
        `🔄 Iniciando replicação de membros...\n\n` +
        `📤 **Origem:** ${sourceFormatted}\n` +
        `📥 **Destino:** ${targetFormatted}`,
        { parse_mode: 'Markdown' }
      );
      
      const result = await this.groupManager.replicateMembers(sourceGroup.id, targetGroup.id);
      
      if (result.success) {
        await this.bot.sendMessage(msg.chat.id, 
          `✅ **Replicação concluída!**\n\n` +
          `📊 **Resultado:**\n` +
          `• Membros adicionados: ${result.added}\n` +
          `• Origem: ${sourceFormatted}\n` +
          `• Destino: ${targetFormatted}`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await this.bot.sendMessage(msg.chat.id, `❌ Erro na replicação: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Erro na replicação:', error.message);
      await this.bot.sendMessage(msg.chat.id, '❌ Erro interno na replicação.');
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
     
     const message = `🔧 *Painel Administrativo*\n\n📋 Selecione uma categoria para gerenciar:`;
     
     const keyboard = {
       inline_keyboard: [
         [
           { text: '👥 Grupos', callback_data: 'admin_grupos' },
           { text: '📊 Estatísticas', callback_data: 'admin_stats' }
         ],
         [
           { text: '👤 Usuários', callback_data: 'admin_usuarios' },
           { text: '💾 Backup', callback_data: 'admin_backup' }
         ],
         [
           { text: '🤖 Auto-Post', callback_data: 'admin_autopost' },
           { text: '⚙️ Sistema', callback_data: 'admin_sistema' }
         ],
         [
           { text: '🔧 Configurações', callback_data: 'admin_config' },
           { text: '📋 Jobs', callback_data: 'admin_jobs' }
         ],
         [
           { text: '🔄 Atualizar', callback_data: 'admin_refresh' }
         ]
       ]
     };
     
     await this.bot.sendMessage(msg.chat.id, message, {
       parse_mode: 'Markdown',
       reply_markup: keyboard
     });
   }

  // === MÉTODOS DO PAINEL ADMINISTRATIVO INTERATIVO ===
  
  async handleAdminGrupos(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `👥 *Gerenciamento de Grupos*\n\nEscolha uma ação:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📋 Listar Grupos', callback_data: 'grupos_listar' },
          { text: '👥 Ver Membros', callback_data: 'grupos_membros' }
        ],
        [
          { text: '🔍 Iniciar Scraping', callback_data: 'grupos_scraping' },
          { text: '➕ Adicionar Usuário', callback_data: 'grupos_add_user' }
        ],
        [
          { text: '📦 Adição em Massa', callback_data: 'grupos_bulk_add' },
          { text: '🔄 Replicar Membros', callback_data: 'grupos_replicar' }
        ],
        [
          { text: '📊 Jobs de Scraping', callback_data: 'grupos_jobs' },
          { text: '➕ Adicionar Grupo', callback_data: 'grupos_add_grupo' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminStats(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `📊 *Estatísticas e Monitoramento*\n\nEscolha uma opção:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📈 Stats Básicas', callback_data: 'stats_basicas' },
          { text: '📊 Stats Avançadas', callback_data: 'stats_avancadas' }
        ],
        [
          { text: '👥 Assinantes', callback_data: 'stats_assinantes' },
          { text: '💬 DM Stats', callback_data: 'stats_dm' }
        ],
        [
          { text: '📋 Logs Recentes', callback_data: 'stats_logs' },
          { text: '⚙️ Info Sistema', callback_data: 'stats_sistema' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminUsuarios(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `👤 *Gerenciamento de Usuários*\n\nEscolha uma ação:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📋 Listar Usuários', callback_data: 'users_listar' },
          { text: '🚫 Banir Usuário', callback_data: 'users_ban' }
        ],
        [
          { text: '✅ Desbanir Usuário', callback_data: 'users_unban' },
          { text: '🔍 Buscar Usuário', callback_data: 'users_buscar' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminBackup(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `💾 *Backup e Replicação*\n\nEscolha uma ação:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '💾 Criar Backup', callback_data: 'backup_criar' },
          { text: '📋 Listar Backups', callback_data: 'backup_listar' }
        ],
        [
          { text: '🔄 Restaurar Backup', callback_data: 'backup_restaurar' },
          { text: '🗑️ Limpar Backups', callback_data: 'backup_limpar' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminAutoPost(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `🤖 *Auto-Post e IA*\n\nEscolha uma ação:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 Status Auto-Post', callback_data: 'autopost_status' },
          { text: '▶️ Iniciar Auto-Post', callback_data: 'autopost_start' }
        ],
        [
          { text: '⏹️ Parar Auto-Post', callback_data: 'autopost_stop' },
          { text: '🔄 Toggle Grupo', callback_data: 'autopost_toggle' }
        ],
        [
          { text: '🤖 Testar IA', callback_data: 'autopost_test_ai' },
          { text: '💬 Stats DM', callback_data: 'autopost_dm_stats' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminSistema(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `⚙️ *Informações do Sistema*\n\nEscolha uma opção:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '💻 Info Sistema', callback_data: 'sistema_info' },
          { text: '📊 Estatísticas', callback_data: 'sistema_stats' }
        ],
        [
          { text: '📋 Logs Sistema', callback_data: 'sistema_logs' },
          { text: '🔄 Status Serviços', callback_data: 'sistema_status' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminConfig(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `🔧 *Configurações*\n\nEscolha uma ação:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📋 Ver Configurações', callback_data: 'config_ver' },
          { text: '✏️ Alterar Config', callback_data: 'config_alterar' }
        ],
        [
          { text: '🔄 Resetar Config', callback_data: 'config_reset' },
          { text: '💾 Backup Config', callback_data: 'config_backup' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
  
  async handleAdminJobs(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    if (!this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Acesso negado.');
      return;
    }
    
    const message = `📋 *Gerenciamento de Jobs*\n\nEscolha uma ação:`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📋 Jobs Ativos', callback_data: 'jobs_ativos' },
          { text: '📊 Jobs Scraping', callback_data: 'jobs_scraping' }
        ],
        [
          { text: '⏹️ Parar Job', callback_data: 'jobs_parar' },
          { text: '🔄 Reiniciar Job', callback_data: 'jobs_reiniciar' }
        ],
        [
          { text: '🔙 Voltar', callback_data: 'admin_refresh' }
        ]
      ]
    };
    
    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
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
      
      const fileName = this.escapeMarkdown(require('path').basename(backupFile));
      
      let response = `✅ *Backup criado com sucesso!*\n\n`;
      response += `📁 Arquivo: \`${fileName}\`\n`;
      response += `📊 Total de backups: ${backups.length}\n\n`;
      response += `*Backups recentes:*\n`;
      
      backups.slice(0, 5).forEach(backup => {
        const escapedFilename = this.escapeMarkdown(backup.filename);
        response += `• ${escapedFilename} (${backup.age_days} dias)\n`;
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
        title: groupName,
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
          title: groupName,
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
      this.autoPostManager.start();
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
      const status = this.autoPostManager.getStatus();
      const stats = await this.autoPostManager.getStats();
      
      let response = `🤖 **Sistema de Auto-Post**\n\n`;
      response += `**📊 Status:**\n`;
      response += `• Sistema: ${status.isRunning ? '✅ Ativo' : '❌ Inativo'}\n`;
      response += `• Grupos ativos: ${status.activeGroups}\n`;
      response += `• Interações: ${status.userInteractions}\n`;
      response += `• Última atualização: ${moment(status.lastUpdate).format('DD/MM HH:mm')}\n\n`;
      
      response += `**📈 Estatísticas:**\n`;
      response += `• Total de posts: ${stats.totalPosts || 0}\n`;
      response += `• Total de DMs: ${stats.totalDMs || 0}\n`;
      response += `• Último post: ${stats.lastPost ? moment(stats.lastPost).format('DD/MM HH:mm') : 'Nunca'}\n`;
      response += `• Último DM: ${stats.lastDM ? moment(stats.lastDM).format('DD/MM HH:mm') : 'Nunca'}\n\n`;
      
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

  // Função utilitária para escapar caracteres especiais do Markdown
  escapeMarkdown(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    // Escapa caracteres especiais do Markdown V2
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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
