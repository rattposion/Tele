const database = require('../db');
const moment = require('moment');

class MassMessageManager {
  constructor(bot) {
    this.bot = bot;
    this.db = database;
    this.isRunning = false;
    this.currentJob = null;
    this.rateLimits = {
      messagesPerSecond: 1, // 1 mensagem por segundo para evitar rate limit
      batchSize: 50, // Processar em lotes de 50
      delayBetweenBatches: 5000 // 5 segundos entre lotes
    };
  }

  /**
   * Enviar mensagem para todos os usuários coletados
   * @param {string} message - Mensagem a ser enviada
   * @param {Object} options - Opções de envio
   * @returns {Object} Resultado do envio
   */
  async sendToAllUsers(message, options = {}) {
    if (this.isRunning) {
      return { success: false, error: 'Já existe um job de mensagem em massa em execução' };
    }

    try {
      this.isRunning = true;
      
      const {
        activeOnly = false,
        status = 'all',
        groupIds = null,
        parseMode = 'Markdown',
        adminUserId = null
      } = options;

      // Buscar usuários baseado nos filtros
      let users = [];
      
      if (groupIds && groupIds.length > 0) {
        users = await this.db.getUsersFromGroups(groupIds);
      } else if (status !== 'all') {
        users = await this.db.getUsersByActivityStatus(status);
      } else {
        users = await this.db.getAllCollectedUsers(activeOnly);
      }

      if (users.length === 0) {
        this.isRunning = false;
        return { success: false, error: 'Nenhum usuário encontrado com os critérios especificados' };
      }

      console.log(`📤 Iniciando envio de mensagem em massa para ${users.length} usuários`);

      // Inicializar estatísticas
      const stats = {
        total: users.length,
        sent: 0,
        failed: 0,
        blocked: 0,
        errors: []
      };

      // Processar em lotes
      const batches = this.chunkArray(users, this.rateLimits.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        console.log(`📦 Processando lote ${i + 1}/${batches.length} (${batch.length} usuários)`);
        
        // Processar lote atual
        await this.processBatch(batch, message, parseMode, stats);
        
        // Notificar admin sobre progresso
        if (adminUserId && (i + 1) % 5 === 0) {
          const progress = Math.round(((i + 1) / batches.length) * 100);
          await this.notifyProgress(adminUserId, stats, progress);
        }
        
        // Aguardar entre lotes (exceto no último)
        if (i < batches.length - 1) {
          await this.delay(this.rateLimits.delayBetweenBatches);
        }
      }

      // Finalizar
      this.isRunning = false;
      
      // Notificar admin sobre conclusão
      if (adminUserId) {
        await this.notifyCompletion(adminUserId, stats);
      }

      // Salvar log da operação
      await this.db.saveActionLog(
        'mass_message_sent',
        adminUserId,
        null,
        `Mensagem enviada para ${stats.sent}/${stats.total} usuários`,
        true
      );

      console.log(`✅ Mensagem em massa concluída: ${stats.sent}/${stats.total} enviadas`);
      
      return {
        success: true,
        stats
      };

    } catch (error) {
      this.isRunning = false;
      console.error('❌ Erro no envio de mensagem em massa:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Processar um lote de usuários
   * @param {Array} batch - Lote de usuários
   * @param {string} message - Mensagem a ser enviada
   * @param {string} parseMode - Modo de parse
   * @param {Object} stats - Estatísticas
   */
  async processBatch(batch, message, parseMode, stats) {
    for (const user of batch) {
      try {
        await this.bot.sendMessage(user.user_id, message, {
          parse_mode: parseMode,
          disable_web_page_preview: true
        });
        
        stats.sent++;
        
        // Atualizar atividade do usuário
        await this.db.updateUserActivity(user.user_id, true);
        
        console.log(`✅ Mensagem enviada para: ${user.first_name} (${user.user_id})`);
        
      } catch (error) {
        stats.failed++;
        
        // Verificar se usuário bloqueou o bot
        if (error.message.includes('blocked') || error.message.includes('Forbidden')) {
          stats.blocked++;
          await this.db.updateUserActivity(user.user_id, false);
          console.log(`🚫 Usuário bloqueou o bot: ${user.first_name} (${user.user_id})`);
        } else {
          stats.errors.push({
            user_id: user.user_id,
            error: error.message
          });
          console.error(`❌ Erro ao enviar para ${user.first_name}: ${error.message}`);
        }
      }
      
      // Rate limiting
      await this.delay(1000 / this.rateLimits.messagesPerSecond);
    }
  }

  /**
   * Notificar progresso para o admin
   * @param {string} adminUserId - ID do admin
   * @param {Object} stats - Estatísticas
   * @param {number} progress - Progresso em porcentagem
   */
  async notifyProgress(adminUserId, stats, progress) {
    try {
      const message = 
        `📊 **Progresso da Mensagem em Massa**\n\n` +
        `🔄 **Progresso:** ${progress}%\n` +
        `✅ **Enviadas:** ${stats.sent}\n` +
        `❌ **Falharam:** ${stats.failed}\n` +
        `🚫 **Bloquearam:** ${stats.blocked}\n` +
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
   */
  async notifyCompletion(adminUserId, stats) {
    try {
      const successRate = ((stats.sent / stats.total) * 100).toFixed(1);
      
      const message = 
        `🎉 **Mensagem em Massa Concluída!**\n\n` +
        `📊 **Resultados Finais:**\n` +
        `✅ **Enviadas:** ${stats.sent}\n` +
        `❌ **Falharam:** ${stats.failed}\n` +
        `🚫 **Bloquearam:** ${stats.blocked}\n` +
        `📊 **Total:** ${stats.total}\n` +
        `📈 **Taxa de Sucesso:** ${successRate}%\n\n` +
        `🕐 **Concluído em:** ${moment().format('DD/MM/YYYY HH:mm')}`;

      await this.bot.sendMessage(adminUserId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Erro ao notificar conclusão:', error.message);
    }
  }

  /**
   * Obter estatísticas de usuários coletados
   * @returns {Object} Estatísticas
   */
  async getStats() {
    try {
      const allUsers = await this.db.getAllCollectedUsers();
      const activeUsers = await this.db.getUsersByActivityStatus('active');
      const inactiveUsers = await this.db.getUsersByActivityStatus('inactive');
      const groups = await this.db.getAllGroups();
      
      return {
        total_users: allUsers.length,
        active_users: activeUsers.length,
        inactive_users: inactiveUsers.length,
        total_groups: groups.length,
        activity_rate: allUsers.length > 0 ? ((activeUsers.length / allUsers.length) * 100).toFixed(1) : 0
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas:', error.message);
      return null;
    }
  }

  /**
   * Verificar se há job em execução
   * @returns {boolean}
   */
  isJobRunning() {
    return this.isRunning;
  }

  /**
   * Parar job atual (se houver)
   */
  stopCurrentJob() {
    if (this.isRunning) {
      this.isRunning = false;
      console.log('🛑 Job de mensagem em massa interrompido');
      return true;
    }
    return false;
  }

  /**
   * Dividir array em chunks
   * @param {Array} array - Array a ser dividido
   * @param {number} size - Tamanho do chunk
   * @returns {Array} Array de chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Delay helper
   * @param {number} ms - Milissegundos
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MassMessageManager;