const database = require('../db');
const moment = require('moment');

class AutoAddManager {
  constructor(bot) {
    this.bot = bot;
    this.db = database;
    this.isRunning = false;
    this.currentJob = null;
    this.settings = {
      delayBetweenAdds: 30000, // 30 segundos entre cada add
      maxAddsPerHour: 20, // Máximo 20 adds por hora
      maxAddsPerDay: 200, // Máximo 200 adds por dia
      retryAttempts: 3, // Tentativas de retry
      retryDelay: 60000 // 1 minuto entre retries
    };
    this.dailyStats = {
      date: moment().format('YYYY-MM-DD'),
      adds: 0,
      hourlyAdds: 0,
      lastHourReset: moment().hour()
    };
  }

  /**
   * Iniciar processo de auto-add
   * @param {string} targetGroupId - ID do grupo alvo
   * @param {Object} options - Opções de configuração
   * @returns {Object} Resultado da operação
   */
  async startAutoAdd(targetGroupId, options = {}) {
    if (this.isRunning) {
      return { success: false, error: 'Auto-add já está em execução' };
    }

    try {
      this.isRunning = true;
      
      const {
        sourceGroupIds = null,
        activeOnly = true,
        adminUserId = null,
        maxUsers = 100
      } = options;

      // Verificar se o grupo alvo existe e se o bot tem permissões
      const targetGroup = await this.validateTargetGroup(targetGroupId);
      if (!targetGroup.success) {
        this.isRunning = false;
        return targetGroup;
      }

      // Buscar usuários para adicionar
      let users = [];
      
      if (sourceGroupIds && sourceGroupIds.length > 0) {
        users = await this.db.getUsersFromGroups(sourceGroupIds);
      } else {
        users = await this.db.getAllCollectedUsers(activeOnly);
      }

      // Filtrar usuários que já estão no grupo alvo
      const existingMembers = await this.db.getGroupMembers(targetGroupId);
      const existingIds = existingMembers.map(m => m.user_id);
      
      users = users.filter(user => !existingIds.includes(user.user_id));
      
      // Limitar quantidade
      if (users.length > maxUsers) {
        users = users.slice(0, maxUsers);
      }

      if (users.length === 0) {
        this.isRunning = false;
        return { success: false, error: 'Nenhum usuário novo encontrado para adicionar' };
      }

      console.log(`🤖 Iniciando auto-add de ${users.length} usuários no grupo ${targetGroupId}`);

      // Inicializar estatísticas
      const stats = {
        total: users.length,
        added: 0,
        failed: 0,
        blocked: 0,
        already_member: 0,
        rate_limited: 0,
        errors: []
      };

      // Processar usuários um por um
      for (let i = 0; i < users.length && this.isRunning; i++) {
        const user = users[i];
        
        // Verificar limites diários/horários
        if (!this.checkRateLimits()) {
          console.log('⏰ Limite de rate atingido, pausando auto-add');
          break;
        }
        
        console.log(`👤 Processando usuário ${i + 1}/${users.length}: ${user.first_name} (${user.user_id})`);
        
        const result = await this.addUserToGroup(targetGroupId, user, stats);
        
        // Notificar progresso a cada 10 usuários
        if (adminUserId && (i + 1) % 10 === 0) {
          const progress = Math.round(((i + 1) / users.length) * 100);
          await this.notifyProgress(adminUserId, stats, progress, targetGroupId);
        }
        
        // Aguardar entre adds
        if (i < users.length - 1 && this.isRunning) {
          await this.delay(this.settings.delayBetweenAdds);
        }
      }

      // Finalizar
      this.isRunning = false;
      
      // Notificar admin sobre conclusão
      if (adminUserId) {
        await this.notifyCompletion(adminUserId, stats, targetGroupId);
      }

      // Salvar log da operação
      await this.db.saveActionLog(
        'auto_add_completed',
        adminUserId,
        targetGroupId,
        `Auto-add concluído: ${stats.added}/${stats.total} usuários adicionados`,
        true
      );

      console.log(`✅ Auto-add concluído: ${stats.added}/${stats.total} usuários adicionados`);
      
      return {
        success: true,
        stats
      };

    } catch (error) {
      this.isRunning = false;
      console.error('❌ Erro no auto-add:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Adicionar usuário específico ao grupo
   * @param {string} groupId - ID do grupo
   * @param {Object} user - Dados do usuário
   * @param {Object} stats - Estatísticas
   * @returns {Object} Resultado da operação
   */
  async addUserToGroup(groupId, user, stats) {
    let attempts = 0;
    
    while (attempts < this.settings.retryAttempts) {
      try {
        // Tentar adicionar usuário
        await this.bot.addChatMember(groupId, user.user_id);
        
        stats.added++;
        this.updateDailyStats();
        
        // Salvar no banco como membro do grupo
        await this.db.saveMember({
          user_id: user.user_id,
          group_id: groupId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          status: 'member',
          is_active: true
        });
        
        console.log(`✅ Usuário adicionado: ${user.first_name} (${user.user_id})`);
        
        return { success: true };
        
      } catch (error) {
        attempts++;
        
        // Analisar tipo de erro
        if (error.message.includes('USER_ALREADY_PARTICIPANT')) {
          stats.already_member++;
          console.log(`ℹ️ Usuário já é membro: ${user.first_name}`);
          return { success: false, reason: 'already_member' };
          
        } else if (error.message.includes('USER_PRIVACY_RESTRICTED')) {
          stats.blocked++;
          console.log(`🚫 Privacidade restrita: ${user.first_name}`);
          return { success: false, reason: 'privacy_restricted' };
          
        } else if (error.message.includes('FLOOD_WAIT')) {
          stats.rate_limited++;
          const waitTime = this.extractFloodWaitTime(error.message);
          console.log(`⏰ Rate limit atingido, aguardando ${waitTime}s`);
          
          if (attempts < this.settings.retryAttempts) {
            await this.delay(waitTime * 1000);
            continue;
          }
          
        } else if (error.message.includes('USER_NOT_FOUND')) {
          stats.failed++;
          console.log(`❌ Usuário não encontrado: ${user.user_id}`);
          return { success: false, reason: 'user_not_found' };
          
        } else {
          stats.failed++;
          stats.errors.push({
            user_id: user.user_id,
            error: error.message
          });
          
          console.error(`❌ Erro ao adicionar ${user.first_name}: ${error.message}`);
          
          if (attempts < this.settings.retryAttempts) {
            await this.delay(this.settings.retryDelay);
            continue;
          }
        }
        
        break;
      }
    }
    
    return { success: false, reason: 'max_attempts_reached' };
  }

  /**
   * Validar grupo alvo
   * @param {string} groupId - ID do grupo
   * @returns {Object} Resultado da validação
   */
  async validateTargetGroup(groupId) {
    try {
      const chat = await this.bot.getChat(groupId);
      
      if (chat.type !== 'group' && chat.type !== 'supergroup') {
        return { success: false, error: 'O alvo deve ser um grupo ou supergrupo' };
      }
      
      // Verificar se o bot é admin
      const botMember = await this.bot.getChatMember(groupId, this.bot.id);
      
      if (!botMember.can_invite_users && botMember.status !== 'administrator') {
        return { success: false, error: 'Bot não tem permissão para adicionar usuários neste grupo' };
      }
      
      return { success: true, chat };
      
    } catch (error) {
      return { success: false, error: `Erro ao validar grupo: ${error.message}` };
    }
  }

  /**
   * Verificar limites de rate
   * @returns {boolean}
   */
  checkRateLimits() {
    const now = moment();
    const currentDate = now.format('YYYY-MM-DD');
    const currentHour = now.hour();
    
    // Reset diário
    if (this.dailyStats.date !== currentDate) {
      this.dailyStats = {
        date: currentDate,
        adds: 0,
        hourlyAdds: 0,
        lastHourReset: currentHour
      };
    }
    
    // Reset horário
    if (this.dailyStats.lastHourReset !== currentHour) {
      this.dailyStats.hourlyAdds = 0;
      this.dailyStats.lastHourReset = currentHour;
    }
    
    // Verificar limites
    if (this.dailyStats.adds >= this.settings.maxAddsPerDay) {
      console.log('⚠️ Limite diário de adds atingido');
      return false;
    }
    
    if (this.dailyStats.hourlyAdds >= this.settings.maxAddsPerHour) {
      console.log('⚠️ Limite horário de adds atingido');
      return false;
    }
    
    return true;
  }

  /**
   * Atualizar estatísticas diárias
   */
  updateDailyStats() {
    this.dailyStats.adds++;
    this.dailyStats.hourlyAdds++;
  }

  /**
   * Extrair tempo de espera do FLOOD_WAIT
   * @param {string} errorMessage - Mensagem de erro
   * @returns {number} Tempo em segundos
   */
  extractFloodWaitTime(errorMessage) {
    const match = errorMessage.match(/FLOOD_WAIT_(\d+)/);
    return match ? parseInt(match[1]) : 60; // Default 60 segundos
  }

  /**
   * Notificar progresso para o admin
   * @param {string} adminUserId - ID do admin
   * @param {Object} stats - Estatísticas
   * @param {number} progress - Progresso em porcentagem
   * @param {string} groupId - ID do grupo
   */
  async notifyProgress(adminUserId, stats, progress, groupId) {
    try {
      const message = 
        `🤖 **Progresso do Auto-Add**\n\n` +
        `📍 **Grupo:** \`${groupId}\`\n` +
        `🔄 **Progresso:** ${progress}%\n` +
        `✅ **Adicionados:** ${stats.added}\n` +
        `❌ **Falharam:** ${stats.failed}\n` +
        `🚫 **Bloqueados:** ${stats.blocked}\n` +
        `👥 **Já membros:** ${stats.already_member}\n` +
        `📊 **Total:** ${stats.total}`;

      await this.bot.sendMessage(adminUserId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Erro ao notificar progresso:', error.message);
    }
  }

  /**
   * Notificar conclusão para o admin
   * @param {string} adminUserId - ID do admin
   * @param {Object} stats - Estatísticas finais
   * @param {string} groupId - ID do grupo
   */
  async notifyCompletion(adminUserId, stats, groupId) {
    try {
      const successRate = ((stats.added / stats.total) * 100).toFixed(1);
      
      const message = 
        `🎉 **Auto-Add Concluído!**\n\n` +
        `📍 **Grupo:** \`${groupId}\`\n` +
        `📊 **Resultados Finais:**\n` +
        `✅ **Adicionados:** ${stats.added}\n` +
        `❌ **Falharam:** ${stats.failed}\n` +
        `🚫 **Bloqueados:** ${stats.blocked}\n` +
        `👥 **Já membros:** ${stats.already_member}\n` +
        `⏰ **Rate limited:** ${stats.rate_limited}\n` +
        `📊 **Total:** ${stats.total}\n` +
        `📈 **Taxa de Sucesso:** ${successRate}%\n\n` +
        `🕐 **Concluído em:** ${moment().format('DD/MM/YYYY HH:mm')}`;

      await this.bot.sendMessage(adminUserId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Erro ao notificar conclusão:', error.message);
    }
  }

  /**
   * Obter status atual do auto-add
   * @returns {Object} Status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      dailyStats: this.dailyStats,
      settings: this.settings
    };
  }

  /**
   * Parar auto-add atual
   */
  stop() {
    if (this.isRunning) {
      this.isRunning = false;
      console.log('🛑 Auto-add interrompido');
      return true;
    }
    return false;
  }

  /**
   * Atualizar configurações
   * @param {Object} newSettings - Novas configurações
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    console.log('⚙️ Configurações do auto-add atualizadas:', this.settings);
  }

  /**
   * Delay helper
   * @param {number} ms - Milissegundos
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AutoAddManager;