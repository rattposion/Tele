const TelegramBot = require('node-telegram-bot-api');
const database = require('../db');

class GroupManager {
  constructor(bot, database) {
    this.bot = bot;
    this.db = database;
    this.scrapingJobs = new Map(); // Jobs ativos em memória
    this.rateLimits = {
      addMember: 20, // Máximo 20 adds por minuto
      scrapeMembers: 30, // Máximo 30 scrapes por minuto
      getChat: 60 // Máximo 60 getChatMember por minuto
    };
    this.lastActions = {
      addMember: [],
      scrapeMembers: [],
      getChat: []
    };
  }

  // === RATE LIMITING ===
  
  async checkRateLimit(action) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Remove ações antigas
    this.lastActions[action] = this.lastActions[action].filter(time => time > oneMinuteAgo);
    
    // Verifica se excedeu o limite
    if (this.lastActions[action].length >= this.rateLimits[action]) {
      const oldestAction = Math.min(...this.lastActions[action]);
      const waitTime = oldestAction + 60000 - now;
      throw new Error(`Rate limit excedido. Aguarde ${Math.ceil(waitTime / 1000)} segundos.`);
    }
    
    // Registra a ação
    this.lastActions[action].push(now);
  }

  // === GERENCIAMENTO DE GRUPOS ===

  // Salvar informações do grupo
  async saveGroupInfo(chatId) {
    try {
      await this.checkRateLimit('getChat');
      
      const chat = await this.bot.getChat(chatId);
      const memberCount = await this.bot.getChatMemberCount(chatId);
      
      const groupData = {
        id: chat.id,
        title: chat.title,
        username: chat.username,
        type: chat.type,
        member_count: memberCount
      };
      
      const groupId = await this.db.saveGroup(groupData);
      
      await this.db.saveActionLog(
        'group_saved',
        null,
        groupId,
        `Grupo ${chat.title} salvo com ${memberCount} membros`
      );
      
      return { groupId, groupData };
    } catch (error) {
      console.error('Erro ao salvar grupo:', error);
      throw error;
    }
  }

  // === SCRAPING DE MEMBROS ===

  // Iniciar scraping de membros de um grupo
  async startMemberScraping(sourceGroupId, targetGroupId = null, adminUserId = null) {
    try {
      // Verificar se o grupo existe
      const sourceGroup = await this.db.getGroup(sourceGroupId);
      if (!sourceGroup) {
        throw new Error('Grupo fonte não encontrado');
      }

      // Criar job de scraping
      const jobId = await this.db.createScrapingJob(sourceGroup.id, targetGroupId);
      
      // Marcar job como iniciado
      await this.db.updateScrapingJob(jobId, {
        status: 'running',
        started_at: new Date().toISOString()
      });

      // Iniciar scraping em background
      this.scrapingJobs.set(jobId, {
        status: 'running',
        sourceGroupId,
        targetGroupId,
        adminUserId,
        startTime: Date.now()
      });

      // Executar scraping
      this.executeScraping(jobId, sourceGroupId, targetGroupId, adminUserId);
      
      return jobId;
    } catch (error) {
      console.error('Erro ao iniciar scraping:', error);
      throw error;
    }
  }

  // Iniciar scraping melhorado
  async startScraping(groupId) {
    try {
      // Verificar se o grupo existe
      const groupInfo = await this.bot.getChat(groupId);
      
      // Salvar informações do grupo
      await this.saveGroup({
        telegram_id: groupId,
        title: groupInfo.title,
        type: groupInfo.type,
        member_count: await this.bot.getChatMemberCount(groupId)
      });
      
      // Verificar se já existe um job ativo para este grupo
      const existingJob = await this.db.getActiveScrapingJob(groupId);
      if (existingJob) {
        return { success: false, error: 'Job de scraping já ativo para este grupo' };
      }
      
      // Criar job de scraping
      const jobId = await this.db.createScrapingJob({
        group_id: groupId,
        status: 'running',
        progress: 0,
        total_members: 0,
        scraped_members: 0
      });
      
      // Iniciar scraping em background
      this.performScraping(groupId, jobId);
      
      return { success: true, jobId };
    } catch (error) {
      console.error('❌ Erro ao iniciar scraping:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Executar scraping melhorado
  async performScraping(groupId, jobId) {
    try {
      console.log(`🔄 Iniciando scraping do grupo ${groupId}`);
      
      // Obter informações do grupo
      const memberCount = await this.bot.getChatMemberCount(groupId);
      await this.db.updateScrapingJob(jobId, { total_members: memberCount });
      
      let scrapedCount = 0;
      let offset = 0;
      const limit = 200; // Telegram API limit
      
      // Método 1: Tentar obter administradores
      try {
        const admins = await this.bot.getChatAdministrators(groupId);
        
        for (const admin of admins) {
          if (!admin.user.is_bot) {
            await this.saveMember({
              user_id: admin.user.id.toString(),
              group_id: groupId,
              username: admin.user.username,
              first_name: admin.user.first_name,
              last_name: admin.user.last_name,
              status: 'administrator',
              is_active: true
            });
            scrapedCount++;
          }
          
          // Rate limiting
          await this.delay(this.rateLimitDelay);
        }
      } catch (error) {
        console.log('⚠️ Não foi possível obter administradores:', error.message);
      }
      
      // Método 2: Scraping via histórico de mensagens (mais efetivo)
      try {
        let hasMoreMessages = true;
        let lastMessageId = null;
        
        while (hasMoreMessages && scrapedCount < 10000) { // Limite de segurança
          const messages = await this.getChatHistory(groupId, lastMessageId, 100);
          
          if (messages.length === 0) {
            hasMoreMessages = false;
            break;
          }
          
          for (const message of messages) {
            if (message.from && !message.from.is_bot) {
              await this.saveMember({
                user_id: message.from.id.toString(),
                group_id: groupId,
                username: message.from.username,
                first_name: message.from.first_name,
                last_name: message.from.last_name,
                is_active: true,
                last_seen: new Date().toISOString()
              });
              scrapedCount++;
            }
            
            lastMessageId = message.message_id;
          }
          
          // Atualizar progresso
          const progress = Math.min(Math.round((scrapedCount / memberCount) * 100), 100);
          await this.db.updateScrapingJob(jobId, {
            progress,
            scraped_members: scrapedCount
          });
          
          // Rate limiting mais agressivo para histórico
          await this.delay(this.rateLimitDelay * 2);
        }
      } catch (error) {
        console.log('⚠️ Erro no scraping via histórico:', error.message);
      }
      
      // Método 3: Monitoramento passivo (já implementado nos eventos)
      console.log('📡 Scraping ativo concluído. Monitoramento passivo ativo.');
      
      // Finalizar job
      await this.db.updateScrapingJob(jobId, {
        status: 'completed',
        progress: 100,
        scraped_members: scrapedCount,
        completed_at: new Date().toISOString()
      });
      
      await this.db.saveLog({
        action: 'scraping_completed',
        details: `Scraping concluído para grupo ${groupId}. ${scrapedCount} membros coletados.`,
        group_id: groupId
      });
      
      console.log(`✅ Scraping concluído: ${scrapedCount} membros coletados`);
      
    } catch (error) {
      console.error('❌ Erro durante scraping:', error.message);
      
      await this.db.updateScrapingJob(jobId, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      });
    }
  }
  
  async getChatHistory(chatId, fromMessageId = null, limit = 100) {
    try {
      // Simular obtenção de histórico (Telegram Bot API não tem getHistory direto)
      // Esta é uma implementação simplificada
      const messages = [];
      
      // Em uma implementação real, você usaria:
      // - Telegram Client API (não Bot API)
      // - Ou coletaria via eventos em tempo real
      
      return messages;
    } catch (error) {
      console.error('❌ Erro ao obter histórico:', error.message);
      return [];
    }
  }

  // Executar o scraping (método privado)
  async executeScraping(jobId, sourceGroupId, targetGroupId, adminUserId) {
    let scrapedCount = 0;
    let addedCount = 0;
    let failedCount = 0;
    
    try {
      console.log(`🔍 Iniciando scraping do grupo ${sourceGroupId}`);
      
      // Buscar grupo no banco
      const sourceGroup = await this.db.getGroup(sourceGroupId);
      
      // Obter lista de administradores para pular
      const admins = await this.bot.getChatAdministrators(sourceGroupId);
      const adminIds = admins.map(admin => admin.user.id);
      
      // Scraping por lotes para evitar rate limit
      const batchSize = 50;
      let offset = 0;
      let hasMore = true;
      
      while (hasMore && this.scrapingJobs.has(jobId)) {
        try {
          await this.checkRateLimit('scrapeMembers');
          
          // Simular obtenção de membros (API do Telegram tem limitações)
          // Em produção, você precisaria usar métodos específicos ou APIs premium
          const members = await this.getMembersFromGroup(sourceGroupId, offset, batchSize);
          
          if (members.length === 0) {
            hasMore = false;
            break;
          }
          
          for (const member of members) {
            try {
              // Pular bots e administradores
              if (member.is_bot || adminIds.includes(member.id)) {
                continue;
              }
              
              // Salvar membro no banco
              await this.db.saveGroupMember(sourceGroup.id, member);
              scrapedCount++;
              
              // Se há grupo alvo, tentar adicionar
              if (targetGroupId) {
                try {
                  await this.addMemberToGroup(targetGroupId, member.id);
                  addedCount++;
                  
                  await this.db.saveActionLog(
                    'member_added',
                    member.id,
                    targetGroupId,
                    `Membro ${member.first_name} adicionado automaticamente`
                  );
                } catch (addError) {
                  failedCount++;
                  console.log(`Falha ao adicionar ${member.id}:`, addError.message);
                  
                  await this.db.saveActionLog(
                    'member_add_failed',
                    member.id,
                    targetGroupId,
                    addError.message,
                    false,
                    addError.message
                  );
                }
              }
              
              // Delay para evitar rate limit
              await this.sleep(100);
              
            } catch (memberError) {
              console.error(`Erro ao processar membro ${member.id}:`, memberError);
              failedCount++;
            }
          }
          
          // Atualizar progresso
          await this.db.updateScrapingJob(jobId, {
            scraped_members: scrapedCount,
            added_members: addedCount,
            failed_members: failedCount
          });
          
          offset += batchSize;
          
          // Notificar admin sobre progresso a cada 100 membros
          if (adminUserId && scrapedCount % 100 === 0) {
            await this.bot.sendMessage(adminUserId, 
              `📊 Progresso do Scraping:\n` +
              `👥 Coletados: ${scrapedCount}\n` +
              `✅ Adicionados: ${addedCount}\n` +
              `❌ Falharam: ${failedCount}`
            );
          }
          
        } catch (batchError) {
          console.error('Erro no lote de scraping:', batchError);
          await this.sleep(5000); // Aguardar 5s antes de tentar novamente
        }
      }
      
      // Finalizar job
      await this.db.updateScrapingJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_members: scrapedCount,
        scraped_members: scrapedCount,
        added_members: addedCount,
        failed_members: failedCount
      });
      
      // Remover da memória
      this.scrapingJobs.delete(jobId);
      
      // Notificar admin sobre conclusão
      if (adminUserId) {
        await this.bot.sendMessage(adminUserId,
          `✅ Scraping Concluído!\n\n` +
          `📊 Resultados:\n` +
          `👥 Total coletados: ${scrapedCount}\n` +
          `✅ Adicionados com sucesso: ${addedCount}\n` +
          `❌ Falharam: ${failedCount}\n\n` +
          `⏱️ Tempo total: ${Math.round((Date.now() - this.scrapingJobs.get(jobId)?.startTime || 0) / 1000)}s`
        );
      }
      
      console.log(`✅ Scraping ${jobId} concluído: ${scrapedCount} coletados, ${addedCount} adicionados`);
      
    } catch (error) {
      console.error(`Erro no scraping ${jobId}:`, error);
      
      // Marcar job como falhou
      await this.db.updateScrapingJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        scraped_members: scrapedCount,
        added_members: addedCount,
        failed_members: failedCount
      });
      
      // Remover da memória
      this.scrapingJobs.delete(jobId);
      
      // Notificar admin sobre erro
      if (adminUserId) {
        await this.bot.sendMessage(adminUserId,
          `❌ Erro no Scraping:\n\n` +
          `${error.message}\n\n` +
          `📊 Progresso até o erro:\n` +
          `👥 Coletados: ${scrapedCount}\n` +
          `✅ Adicionados: ${addedCount}\n` +
          `❌ Falharam: ${failedCount}`
        );
      }
    }
  }

  // Obter membros de um grupo (método simulado)
  async getMembersFromGroup(groupId, offset = 0, limit = 50) {
    try {
      // NOTA: A API oficial do Telegram não permite listar todos os membros
      // Este é um método simulado. Em produção, você precisaria:
      // 1. Usar Telegram Client API (não Bot API)
      // 2. Usar bibliotecas como 'telegram' (MTProto)
      // 3. Ter permissões especiais no grupo
      
      // Por enquanto, retornamos uma lista vazia para demonstração
      // Em implementação real, substitua por:
      // - Telegram Client API
      // - Scraping via web
      // - APIs premium de terceiros
      
      console.log(`⚠️  Simulando obtenção de membros do grupo ${groupId} (offset: ${offset})`);
      
      // Simular alguns membros para teste
      if (offset === 0) {
        return [
          {
            id: 123456789,
            first_name: 'Usuário',
            last_name: 'Teste',
            username: 'usuario_teste',
            is_bot: false,
            status: 'member'
          }
        ];
      }
      
      return []; // Sem mais membros
    } catch (error) {
      console.error('Erro ao obter membros:', error);
      return [];
    }
  }

  // === ADIÇÃO DE MEMBROS ===

  // Adicionar membro a um grupo
  async addMemberToGroup(groupId, userId, inviteLink = null) {
    try {
      await this.checkRateLimit('addMember');
      
      // Verificar se o usuário já está no grupo
      try {
        const member = await this.bot.getChatMember(groupId, userId);
        if (['member', 'administrator', 'creator'].includes(member.status)) {
          throw new Error('Usuário já está no grupo');
        }
      } catch (error) {
        // Se der erro, provavelmente o usuário não está no grupo
      }
      
      let result = { success: false };
      
      if (inviteLink) {
        // Método 1: Via link de convite
        try {
          await this.bot.sendMessage(userId,
            `🎉 Você foi convidado para um grupo especial!\n\n` +
            `🔗 Link: ${inviteLink}\n\n` +
            `💡 Clique no link para entrar no grupo.`
          );
          result = { success: true, method: 'invite_link' };
        } catch (error) {
          console.log(`⚠️ Não foi possível enviar convite para ${userId}:`, error.message);
          result = { success: false, error: 'Usuário bloqueou o bot ou não permite mensagens' };
        }
      } else {
        // Método 2: Gerar link personalizado e enviar
        try {
          await this.bot.unbanChatMember(groupId, userId); // Remove ban se houver
          
          // Gerar link de convite personalizado
          const personalInviteLink = await this.bot.createChatInviteLink(groupId, {
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 3600 // 1 hora
          });
          
          // Enviar convite privado para o usuário
          await this.bot.sendMessage(userId,
            `🎉 Você foi convidado para um grupo exclusivo!\n\n` +
            `🔗 Clique no link para entrar:\n${personalInviteLink.invite_link}\n\n` +
            `⏰ Este convite expira em 1 hora.`
          );
          result = { success: true, method: 'personal_invite' };
        } catch (dmError) {
          // Se não conseguir enviar DM, tentar adicionar diretamente
          console.log(`Não foi possível enviar DM para ${userId}, tentando adicionar diretamente`);
          
          try {
            await this.bot.addChatMember(groupId, userId);
            result = { success: true, method: 'direct_add' };
          } catch (addError) {
            result = { success: false, error: 'Usuário não permite mensagens privadas e adição direta falhou' };
          }
        }
      }
      
      // Registrar tentativa
      await this.db.saveActionLog(
        result.success ? 'member_added' : 'member_add_failed',
        userId,
        groupId,
        `Tentativa de adicionar usuário ${userId} ao grupo ${groupId}. Resultado: ${result.success ? 'sucesso' : result.error}`,
        result.success
      );
      
      return result.success;
    } catch (error) {
      console.error(`Erro ao adicionar usuário ${userId} ao grupo ${groupId}:`, error);
      throw error;
    }
  }

  // Verificar rate limiting
  async checkRateLimitForUser(action, userId) {
    try {
      const now = Date.now();
      const key = `${action}_${userId}`;
      
      if (!this.rateLimitCache) {
        this.rateLimitCache = new Map();
      }
      
      const lastAction = this.rateLimitCache.get(key);
      const rateLimitDelay = 2000; // 2 segundos entre ações por usuário
      
      if (lastAction && (now - lastAction) < rateLimitDelay) {
        return false;
      }
      
      this.rateLimitCache.set(key, now);
      return true;
    } catch (error) {
      console.error('❌ Erro no rate limiting:', error.message);
      return true; // Em caso de erro, permitir a ação
    }
  }

  // Adicionar múltiplos membros com controle avançado
  async bulkAddMembers(userIds, targetGroupId, options = {}) {
    try {
      const {
        maxConcurrent = 5,
        delayBetweenBatches = 10000,
        useInviteLink = true
      } = options;
      
      let inviteLink = null;
      if (useInviteLink) {
        try {
          inviteLink = await this.bot.exportChatInviteLink(targetGroupId);
        } catch (error) {
          console.log('⚠️ Não foi possível obter link de convite');
        }
      }
      
      const results = {
        success: 0,
        failed: 0,
        errors: []
      };
      
      // Processar em lotes
      for (let i = 0; i < userIds.length; i += maxConcurrent) {
        const batch = userIds.slice(i, i + maxConcurrent);
        
        const promises = batch.map(async (userId) => {
          try {
            const success = await this.addMemberToGroup(targetGroupId, userId, inviteLink);
            
            if (success) {
              results.success++;
            } else {
              results.failed++;
              results.errors.push(`${userId}: Falha na adição`);
            }
          } catch (error) {
            results.failed++;
            results.errors.push(`${userId}: ${error.message}`);
          }
          
          // Delay individual
          await this.delay(2000);
        });
        
        await Promise.all(promises);
        
        // Pausa entre lotes
        if (i + maxConcurrent < userIds.length) {
          console.log(`📊 Processados ${i + maxConcurrent}/${userIds.length} usuários`);
          await this.delay(delayBetweenBatches);
        }
      }
      
      return results;
    } catch (error) {
      console.error('❌ Erro no bulk add:', error.message);
      return { success: 0, failed: userIds.length, errors: [error.message] };
    }
  }

  // === UTILITÁRIOS ===

  // Sleep helper
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Delay helper para rate limiting
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Salvar membro no banco
  async saveMember(memberData) {
    try {
      const query = `
        INSERT OR REPLACE INTO group_members (
          user_id, group_id, username, first_name, last_name, 
          status, is_active, last_seen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const status = memberData.is_admin ? 'administrator' : (memberData.status || 'member');
      
      await this.db.run(query, [
        memberData.user_id,
        memberData.group_id,
        memberData.username,
        memberData.first_name,
        memberData.last_name,
        status,
        memberData.is_active ? 1 : 0,
        memberData.last_seen || new Date().toISOString()
      ]);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Erro ao salvar membro:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Salvar grupo no banco
  async saveGroup(groupData) {
    try {
      const query = `
        INSERT OR REPLACE INTO groups (
          telegram_id, title, type, member_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      
      await this.db.run(query, [
        groupData.telegram_id,
        groupData.title,
        groupData.type,
        groupData.member_count
      ]);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Erro ao salvar grupo:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getGroupMembers(groupId, activeOnly = true) {
    return await this.db.getGroupMembers(groupId, activeOnly);
  }
  
  async updateMemberStatus(userId, groupId, isActive) {
    try {
      const query = `
        UPDATE group_members 
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE user_id = ? AND group_id = ?
      `;
      
      await this.db.run(query, [isActive ? 1 : 0, userId, groupId]);
      
      await this.db.saveLog({
        action: 'member_status_update',
        details: `Usuário ${userId} marcado como ${isActive ? 'ativo' : 'inativo'} no grupo ${groupId}`,
        user_id: userId
      });
      
      return { success: true };
    } catch (error) {
      console.error('❌ Erro ao atualizar status do membro:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Parar job de scraping
  async stopScrapingJob(jobId) {
    if (this.scrapingJobs.has(jobId)) {
      this.scrapingJobs.delete(jobId);
      
      await this.db.updateScrapingJob(jobId, {
        status: 'cancelled',
        completed_at: new Date().toISOString()
      });
      
      return true;
    }
    return false;
  }

  // Obter status de jobs ativos
  getActiveJobs() {
    return Array.from(this.scrapingJobs.entries()).map(([jobId, job]) => ({
      jobId,
      ...job,
      runningTime: Date.now() - job.startTime
    }));
  }

  async getScrapingJobs() {
    return await this.db.getScrapingJobs();
  }
  
  async getLogs() {
    return await this.db.getRecentLogs();
  }
  
  async getGroups() {
    try {
      const query = `
        SELECT g.*, COUNT(gm.user_id) as member_count
        FROM groups g
        LEFT JOIN group_members gm ON g.telegram_id = gm.group_id AND gm.is_active = 1
        GROUP BY g.id
        ORDER BY g.created_at DESC
      `;
      
      return await this.db.all(query);
    } catch (error) {
      console.error('❌ Erro ao buscar grupos:', error.message);
      return [];
    }
  }
  
  async getAllActiveMembers() {
    try {
      const query = `
        SELECT DISTINCT gm.user_id, gm.username, gm.first_name, gm.last_name
        FROM group_members gm
        WHERE gm.is_active = 1
        ORDER BY gm.created_at DESC
        LIMIT 1000
      `;
      
      return await this.db.all(query);
    } catch (error) {
      console.error('❌ Erro ao buscar membros ativos:', error.message);
      return [];
    }
  }

  // === BACKUP E REPLICAÇÃO ===

  // Replicar membros entre grupos
  async replicateMembers(sourceGroupId, targetGroupId, adminUserId, maxMembers = 100) {
    try {
      const sourceGroup = await this.db.getGroup(sourceGroupId);
      const targetGroup = await this.db.getGroup(targetGroupId);
      
      if (!sourceGroup || !targetGroup) {
        throw new Error('Grupo fonte ou destino não encontrado');
      }
      
      // Buscar membros ativos do grupo fonte
      const members = await this.db.getActiveGroupMembers(sourceGroup.id);
      
      if (members.length === 0) {
        return { success: false, error: 'Nenhum membro encontrado no grupo de origem' };
      }
      
      // Criar job de replicação
      const jobId = await this.db.createScrapingJob(sourceGroup.id, targetGroup.id);
      
      await this.db.updateScrapingJob(jobId, {
        status: 'running',
        total_members: Math.min(members.length, maxMembers),
        started_at: new Date().toISOString()
      });
      
      let addedCount = 0;
      let failedCount = 0;
      const errors = [];
      
      // Obter link de convite do grupo de destino
      let inviteLink = null;
      try {
        inviteLink = await this.bot.exportChatInviteLink(targetGroupId);
        console.log(`🔗 Link de convite obtido: ${inviteLink}`);
      } catch (error) {
        console.log('⚠️ Não foi possível obter link de convite:', error.message);
      }
      
      // Processar membros em lotes com controle avançado
      const membersToAdd = members.slice(0, maxMembers);
      const batchSize = 10; // Processar em lotes de 10
      
      for (let i = 0; i < membersToAdd.length; i += batchSize) {
        const batch = membersToAdd.slice(i, i + batchSize);
        
        for (const member of batch) {
          try {
            // Verificar se o membro já está no grupo de destino
            try {
              const memberInfo = await this.bot.getChatMember(targetGroupId, member.user_id);
              if (memberInfo.status !== 'left' && memberInfo.status !== 'kicked') {
                console.log(`👤 ${member.first_name} já está no grupo de destino`);
                continue;
              }
            } catch (error) {
              // Membro não está no grupo, pode tentar adicionar
            }
            
            const success = await this.addMemberToGroup(targetGroupId, member.user_id, inviteLink);
            
            if (success) {
              addedCount++;
              console.log(`✅ ${member.first_name} adicionado com sucesso`);
            } else {
              failedCount++;
              errors.push(`${member.first_name}: Falha na adição`);
              console.log(`❌ Falha ao adicionar ${member.first_name}`);
            }
            
            // Delay entre adições
            await this.sleep(2000);
            
          } catch (error) {
            failedCount++;
            errors.push(`${member.first_name}: ${error.message}`);
            console.log(`Falha ao replicar membro ${member.user_id}:`, error.message);
          }
          
          // Atualizar progresso
          const progress = Math.round(((i + batch.indexOf(member) + 1) / membersToAdd.length) * 100);
          await this.db.updateScrapingJob(jobId, {
            progress,
            scraped_members: addedCount + failedCount,
            added_members: addedCount,
            failed_members: failedCount
          });
        }
        
        // Notificar progresso a cada lote
        if (adminUserId && i % (batchSize * 2) === 0) {
          await this.bot.sendMessage(adminUserId,
            `📊 Progresso da Replicação:\n` +
            `✅ Adicionados: ${addedCount}\n` +
            `❌ Falharam: ${failedCount}\n` +
            `📈 Total processados: ${addedCount + failedCount}/${membersToAdd.length}`
          );
        }
        
        // Pausa entre lotes
        console.log(`📊 Lote processado. ${addedCount}/${membersToAdd.length} membros adicionados`);
        await this.sleep(5000); // 5 segundos entre lotes
      }
      
      // Finalizar job
      await this.db.updateScrapingJob(jobId, {
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        total_members: membersToAdd.length,
        scraped_members: addedCount + failedCount,
        added_members: addedCount,
        failed_members: failedCount
      });
      
      await this.db.saveActionLog(
        'members_replicated',
        null,
        targetGroup.id,
        `Replicação de ${sourceGroupId} para ${targetGroupId}. ${addedCount}/${membersToAdd.length} membros adicionados.`
      );
      
      // Notificar conclusão
      if (adminUserId) {
        await this.bot.sendMessage(adminUserId,
          `✅ Replicação Concluída!\n\n` +
          `📊 Resultados:\n` +
          `👥 Total de membros: ${membersToAdd.length}\n` +
          `✅ Adicionados: ${addedCount}\n` +
          `❌ Falharam: ${failedCount}\n` +
          `📈 Taxa de sucesso: ${Math.round((addedCount / membersToAdd.length) * 100)}%`
        );
      }
      
      return {
        success: true,
        added: addedCount,
        failed: failedCount,
        total: membersToAdd.length,
        errors: errors.slice(0, 10), // Limitar erros mostrados
        jobId
      };
      
    } catch (error) {
      console.error('Erro na replicação:', error);
      throw error;
    }
  }
}

module.exports = GroupManager;