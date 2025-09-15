const database = require('../db');
const GeminiAIService = require('./geminiAI');
const moment = require('moment');

class AutoPostManager {
  constructor(bot) {
    this.bot = bot;
    this.geminiAI = new GeminiAIService();
    this.isRunning = false;
    this.postInterval = null;
    this.dmInterval = null;
    this.startTime = null;
    this.lastPostTime = new Map(); // Controla último post por grupo
    this.userInteractions = new Map(); // Rastreia interações dos usuários
  }

  /**
   * Inicia o sistema de postagens automáticas
   */
  async start() {
    try {
      if (this.isRunning) {
        console.log('⚠️ AutoPostManager já está rodando');
        return {
          success: false,
          error: 'Sistema já está rodando',
          activeGroups: 0,
          nextPost: 'N/A'
        };
      }

      this.isRunning = true;
      this.startTime = new Date();
      console.log('🚀 Iniciando AutoPostManager...');

      // Verifica conexão com Gemini AI
      const aiConnected = await this.geminiAI.testConnection();
      if (!aiConnected) {
        console.warn('⚠️ Gemini AI não conectado, usando conteúdo fallback');
      }

      // Inicia postagens automáticas a cada 3 horas
      this.startAutoPosting();
      
      // Inicia DMs automáticas a cada 3 horas (com offset de 1h)
      this.startAutoDM();
      
      // Carrega interações existentes
      await this.loadUserInteractions();
      
      // Conta grupos ativos
      const activeGroups = await database.get(`
        SELECT COUNT(*) as count FROM groups WHERE auto_post_enabled = 1
      `);
      
      const nextPost = moment().add(3, 'hours').format('HH:mm');
      
      console.log('✅ AutoPostManager iniciado com sucesso!');
      
      return {
        success: true,
        activeGroups: activeGroups?.count || 0,
        nextPost: nextPost,
        aiConnected: aiConnected
      };
    } catch (error) {
      console.error('Erro ao iniciar AutoPostManager:', error);
      return {
        success: false,
        error: error.message,
        activeGroups: 0,
        nextPost: 'N/A'
      };
    }
  }

  /**
   * Para o sistema de postagens automáticas
   */
  async stop() {
    try {
      if (!this.isRunning) {
        return {
          success: false,
          error: 'Sistema já está parado',
          postsToday: 0,
          uptime: '0 minutos'
        };
      }

      // Calcula tempo de atividade
      const startTime = this.startTime || new Date();
      const uptime = moment.duration(moment().diff(startTime)).humanize();
      
      // Obtém estatísticas do dia
      const todayStats = await database.get(`
        SELECT auto_posts_sent FROM daily_stats 
        WHERE date = ?
      `, [new Date().toISOString().split('T')[0]]);

      this.isRunning = false;
      
      if (this.postInterval) {
        clearInterval(this.postInterval);
        this.postInterval = null;
      }
      
      if (this.dmInterval) {
        clearInterval(this.dmInterval);
        this.dmInterval = null;
      }
      
      console.log('🛑 AutoPostManager parado');
      
      return {
        success: true,
        postsToday: todayStats?.auto_posts_sent || 0,
        uptime: uptime
      };
    } catch (error) {
      console.error('Erro ao parar AutoPostManager:', error);
      return {
        success: false,
        error: error.message,
        postsToday: 0,
        uptime: '0 minutos'
      };
    }
  }

  /**
   * Inicia postagens automáticas nos grupos
   */
  startAutoPosting() {
    // Executa imediatamente e depois a cada 3 horas
    this.executeGroupPosts();
    
    // 3 horas = 3 * 60 * 60 * 1000 ms
    this.postInterval = setInterval(() => {
      this.executeGroupPosts();
    }, 3 * 60 * 60 * 1000);
    
    console.log('📅 Postagens automáticas agendadas para cada 3 horas');
  }

  /**
   * Inicia DMs automáticas
   */
  startAutoDM() {
    // Aguarda 1 hora antes de começar DMs, depois a cada 3 horas
    setTimeout(() => {
      this.executeDMCampaign();
      
      this.dmInterval = setInterval(() => {
        this.executeDMCampaign();
      }, 3 * 60 * 60 * 1000);
      
    }, 60 * 60 * 1000); // 1 hora de delay
    
    console.log('💬 DMs automáticas agendadas (início em 1h, depois a cada 3h)');
  }

  /**
   * Executa postagens em todos os grupos ativos
   */
  async executeGroupPosts() {
    try {
      console.log('📢 Iniciando rodada de postagens automáticas...');
      
      // Busca grupos ativos
      const groups = await database.all(`
        SELECT * FROM groups 
        WHERE is_active = 1 
        AND auto_post_enabled = 1
        ORDER BY last_post_at ASC
      `);
      
      if (groups.length === 0) {
        console.log('ℹ️ Nenhum grupo com auto-post habilitado');
        return;
      }
      
      let postsCount = 0;
      
      for (const group of groups) {
        try {
          // Verifica se já postou recentemente neste grupo
          const lastPost = this.lastPostTime.get(group.telegram_id);
          const now = Date.now();
          const threeHours = 3 * 60 * 60 * 1000;
          
          if (lastPost && (now - lastPost) < threeHours) {
            console.log(`⏭️ Pulando grupo ${group.title} - postou há menos de 3h`);
            continue;
          }
          
          // Gera conteúdo único com IA
          const content = await this.geminiAI.generateGroupPost(
            'assinatura premium', 
            'adultos interessados em conteúdo exclusivo'
          );
          
          // Monta mensagem final
          const messageData = this.formatGroupMessage(content);
          
          // Envia mensagem com botões
          await this.bot.sendMessage(group.telegram_id, messageData.text, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: messageData.reply_markup
          });
          
          // Atualiza controles
          this.lastPostTime.set(group.telegram_id, now);
          
          // Atualiza banco
          await database.run(
            'UPDATE groups SET last_post_at = ?, post_count = post_count + 1 WHERE telegram_id = ?',
            [new Date().toISOString(), group.telegram_id]
          );
          
          // Log da ação
          await database.saveActionLog('auto_post_sent', group.telegram_id, null, {
            groupName: group.title,
            content: content,
            timestamp: new Date().toISOString()
          });
          
          postsCount++;
          console.log(`✅ Post enviado para: ${group.title}`);
          
          // Delay entre posts para evitar spam
          await this.sleep(2000);
          
        } catch (error) {
          console.error(`❌ Erro ao postar no grupo ${group.title}:`, error.message);
          
          // Se for erro de permissão, desabilita auto-post
          if (error.message.includes('chat not found') || error.message.includes('kicked')) {
            await database.run(
              'UPDATE groups SET auto_post_enabled = 0, is_active = 0 WHERE telegram_id = ?',
              [group.telegram_id]
            );
            console.log(`🚫 Auto-post desabilitado para grupo ${group.title} (removido/sem permissão)`);
          }
        }
      }
      
      console.log(`📊 Rodada concluída: ${postsCount} posts enviados`);
      
      // Salva estatísticas
      await this.savePostingStats(postsCount);
      
    } catch (error) {
      console.error('❌ Erro na execução de postagens:', error);
    }
  }

  /**
   * Executa campanha de DMs para usuários que interagiram
   */
  async executeDMCampaign() {
    try {
      console.log('💬 Iniciando campanha de DMs automáticas...');
      
      // Busca usuários elegíveis para DM
      const users = await this.getEligibleUsersForDM();
      
      if (users.length === 0) {
        console.log('ℹ️ Nenhum usuário elegível para DM');
        return;
      }
      
      let dmCount = 0;
      const maxDMsPerRound = 50; // Limite para evitar spam
      
      for (const user of users.slice(0, maxDMsPerRound)) {
        try {
          // Gera mensagem personalizada
          const dmContent = await this.geminiAI.generatePersonalizedDM(
            user, 
            'subscription_offer'
          );
          
          // Monta mensagem final
          const messageData = this.formatDMMessage(dmContent);
          
          // Envia DM com botões personalizados
          await this.bot.sendMessage(user.telegram_id, messageData.text, {
            parse_mode: 'Markdown',
            reply_markup: messageData.reply_markup
          });
          
          // Atualiza último DM enviado
          await database.run(
            'UPDATE users SET last_dm_sent = ?, dm_count = dm_count + 1 WHERE telegram_id = ?',
            [new Date().toISOString(), user.telegram_id]
          );
          
          // Log
          await database.saveActionLog('auto_dm_sent', user.telegram_id, null, {
            content: dmContent,
            timestamp: new Date().toISOString()
          });
          
          dmCount++;
          console.log(`✅ DM enviada para: ${user.first_name || user.username}`);
          
          // Delay entre DMs
          await this.sleep(3000);
          
        } catch (error) {
          console.error(`❌ Erro ao enviar DM para ${user.telegram_id}:`, error.message);
          
          // Se usuário bloqueou o bot, marca como inativo para DM
          if (error.message.includes('blocked') || error.message.includes('user not found')) {
            await database.run(
              'UPDATE users SET dm_consent = 0 WHERE telegram_id = ?',
              [user.telegram_id]
            );
          }
        }
      }
      
      console.log(`📊 Campanha DM concluída: ${dmCount} mensagens enviadas`);
      
    } catch (error) {
      console.error('❌ Erro na campanha de DMs:', error);
    }
  }

  /**
   * Registra interação do usuário (para elegibilidade de DM)
   * @param {number} userId - ID do usuário
   * @param {string} interactionType - Tipo de interação
   * @param {string} groupId - ID do grupo (opcional)
   */
  async registerUserInteraction(userId, interactionType, groupId = null) {
    try {
      const now = new Date().toISOString();
      
      // Atualiza mapa de interações
      this.userInteractions.set(userId, {
        lastInteraction: now,
        type: interactionType,
        groupId
      });
      
      // Atualiza banco
      await database.run(`
        UPDATE users 
        SET last_interaction = ?, interaction_count = interaction_count + 1,
            dm_consent = CASE WHEN dm_consent IS NULL THEN 1 ELSE dm_consent END
        WHERE telegram_id = ?
      `, [now, userId]);
      
      // Log da interação
      await database.saveActionLog('user_interaction', userId, groupId, {
        type: interactionType,
        timestamp: now
      });
      
      console.log(`📝 Interação registrada: ${userId} - ${interactionType}`);
      
    } catch (error) {
      console.error('Erro ao registrar interação:', error);
    }
  }

  // === MÉTODOS AUXILIARES ===
  
  /**
   * Formata mensagem para grupo
   */
  formatGroupMessage(content) {
    let message = `🔥 **${content.title}**\n\n`;
    message += `${content.description}\n\n`;
    message += `${content.callToAction}\n\n`;
    
    if (content.hashtags && content.hashtags.length > 0) {
      message += content.hashtags.join(' ');
    }
    
    return {
      text: message,
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🔞 Acesso Exclusivo +18',
            url: `https://t.me/${process.env.BOT_USERNAME || 'seu_bot'}`
          }
        ], [
          {
            text: '💎 Assinar Conteúdo Premium',
            callback_data: 'subscription'
          }
        ]]
      }
    };
  }
  
  /**
   * Formata mensagem para DM
   */
  formatDMMessage(content) {
    let message = `${content.message}\n\n`;
    
    if (content.offer) {
      message += `🎁 **${content.offer}**\n\n`;
    }
    
    if (content.urgency) {
      message += `⏰ ${content.urgency}\n\n`;
    }
    
    message += `💬 Clique nos botões abaixo para acessar!`;
    
    return {
      text: message,
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🔞 Ver Conteúdo +18',
            url: `https://t.me/${process.env.BOT_USERNAME || 'seu_bot'}`
          }
        ], [
          {
            text: '💎 Comprar Assinatura',
            callback_data: 'subscription'
          }
        ], [
          {
            text: '❌ Não receber mais DMs',
            callback_data: 'unsubscribe_dm'
          }
        ]]
      }
    };
  }
  
  /**
   * Busca usuários elegíveis para receber DM
   */
  async getEligibleUsersForDM() {
    return await database.all(`
      SELECT telegram_id, username, first_name, last_interaction, 
             last_dm_sent, dm_consent, status
      FROM users 
      WHERE dm_consent = 1 
        AND is_active = 1
        AND status != 'banned'
        AND (
          last_dm_sent IS NULL 
          OR datetime(last_dm_sent) <= datetime('now', '-3 hours')
        )
        AND (
          last_interaction IS NOT NULL 
          AND datetime(last_interaction) >= datetime('now', '-7 days')
        )
      ORDER BY last_interaction DESC
      LIMIT 100
    `);
  }
  
  /**
   * Carrega interações existentes do banco
   */
  async loadUserInteractions() {
    try {
      const interactions = await database.all(`
        SELECT telegram_id, last_interaction 
        FROM users 
        WHERE last_interaction IS NOT NULL
        AND datetime(last_interaction) >= datetime('now', '-24 hours')
      `);
      
      interactions.forEach(user => {
        this.userInteractions.set(user.telegram_id, {
          lastInteraction: user.last_interaction,
          type: 'existing',
          groupId: null
        });
      });
      
      console.log(`📚 Carregadas ${interactions.length} interações recentes`);
    } catch (error) {
      console.error('Erro ao carregar interações:', error);
    }
  }
  
  /**
   * Salva estatísticas de postagem
   */
  async savePostingStats(postsCount) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await database.run(`
        INSERT OR REPLACE INTO daily_stats 
        (date, auto_posts_sent, updated_at)
        VALUES (?, COALESCE((SELECT auto_posts_sent FROM daily_stats WHERE date = ?), 0) + ?, ?)
      `, [today, today, postsCount, new Date().toISOString()]);
      
    } catch (error) {
      console.error('Erro ao salvar estatísticas:', error);
    }
  }
  
  /**
   * Utilitário para sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Habilita/desabilita auto-post para um grupo
   * @param {string} groupId - ID do grupo
   * @param {boolean} enabled - Habilitar ou não
   */
  async toggleGroupAutoPost(groupId, enabled) {
    try {
      await database.run(
        'UPDATE groups SET auto_post_enabled = ? WHERE telegram_id = ?',
        [enabled ? 1 : 0, groupId]
      );
      
      console.log(`${enabled ? '✅' : '❌'} Auto-post ${enabled ? 'habilitado' : 'desabilitado'} para grupo ${groupId}`);
      
      return true;
    } catch (error) {
      console.error('Erro ao alterar auto-post:', error);
      return false;
    }
  }

  /**
   * Obtém o status atual do sistema
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasPostInterval: !!this.postInterval,
      hasDMInterval: !!this.dmInterval,
      activeGroups: this.lastPostTime.size,
      userInteractions: this.userInteractions.size,
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Obtém estatísticas específicas de DM
   */
  async getDMStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = moment().subtract(7, 'days').format('YYYY-MM-DD');
      
      // Estatísticas de hoje
      const todayStats = await database.get(`
        SELECT 
          COALESCE(dm_sent, 0) as sent,
          COALESCE(dm_success, 0) as success,
          COALESCE(dm_failed, 0) as failed
        FROM daily_stats 
        WHERE date = ?
      `, [today]);
      
      const todayData = todayStats || { sent: 0, success: 0, failed: 0 };
      const successRate = todayData.sent > 0 ? Math.round((todayData.success / todayData.sent) * 100) : 0;
      
      // Estatísticas da semana
      const weekStats = await database.get(`
        SELECT 
          COALESCE(SUM(dm_sent), 0) as total,
          COALESCE(SUM(dm_success), 0) as conversions,
          COALESCE(AVG(dm_sent), 0) as dailyAverage
        FROM daily_stats 
        WHERE date >= ? AND date <= ?
      `, [weekAgo, today]);
      
      const weekData = weekStats || { total: 0, conversions: 0, dailyAverage: 0 };
      
      // Usuários elegíveis para DM
      const eligibleUsers = await database.get(`
        SELECT COUNT(*) as count
        FROM users 
        WHERE dm_consent = 1 AND subscription_end > datetime('now')
      `);
      
      return {
        today: {
          sent: todayData.sent,
          success: todayData.success,
          failed: todayData.failed,
          successRate: successRate
        },
        week: {
          total: weekData.total,
          dailyAverage: Math.round(weekData.dailyAverage),
          conversions: weekData.conversions
        },
        users: {
          eligible: eligibleUsers?.count || 0,
          activeInteractions: this.userInteractions.size
        },
        system: {
          isRunning: this.isRunning,
          nextDM: this.dmInterval ? moment().add(3, 'hours').format('HH:mm') : 'Parado'
        }
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas de DM:', error);
      return { error: error.message };
    }
  }

  /**
   * Obtém estatísticas do sistema de auto-post
   */
  async getStats() {
    try {
      const stats = await database.get(`
        SELECT 
          COUNT(CASE WHEN auto_post_enabled = 1 THEN 1 END) as active_groups,
          COUNT(*) as total_groups,
          SUM(post_count) as total_posts
        FROM groups
      `);
      
      const dmStats = await database.get(`
        SELECT 
          COUNT(CASE WHEN dm_consent = 1 THEN 1 END) as dm_enabled_users,
          COUNT(*) as total_users,
          SUM(dm_count) as total_dms
        FROM users
      `);
      
      const todayStats = await database.get(`
        SELECT auto_posts_sent, dm_sent 
        FROM daily_stats 
        WHERE date = ?
      `, [new Date().toISOString().split('T')[0]]);
      
      return {
        groups: stats,
        users: dmStats,
        today: todayStats || { auto_posts_sent: 0, dm_sent: 0 },
        system: {
          isRunning: this.isRunning,
          activeInteractions: this.userInteractions.size,
          lastPostTimes: this.lastPostTime.size
        }
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas:', error);
      return { error: error.message };
    }
  }
}

module.exports = AutoPostManager;