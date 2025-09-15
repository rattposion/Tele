const fs = require('fs').promises;
const path = require('path');
const database = require('../db');

class BackupManager {
  constructor() {
    this.db = database;
    // Usar diretório de dados se estiver em Docker, senão usar diretório local
    const isDocker = process.env.DATABASE_PATH && process.env.DATABASE_PATH.includes('/app/');
    this.backupDir = isDocker 
      ? path.join(process.env.DATABASE_PATH, '../backups')
      : path.join(__dirname, '../backups');
    this.ensureBackupDir();
  }

  // Garante que o diretório de backup existe
  async ensureBackupDir() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      console.error('❌ Erro ao criar diretório de backup:', error.message);
    }
  }

  // === BACKUP DE DADOS ===

  // Backup completo do banco de dados
  async createFullBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `backup_${timestamp}.json`);

      console.log('🔄 Iniciando backup completo...');

      // Busca todos os dados
      const users = await this.db.all('SELECT * FROM users');
      const groups = await this.db.all('SELECT * FROM groups');
      const groupMembers = await this.db.all('SELECT * FROM group_members');
      const scrapingJobs = await this.db.all('SELECT * FROM scraping_jobs');
      const actionLogs = await this.db.all('SELECT * FROM action_logs WHERE created_at >= date("now", "-30 days")');
      const payments = await this.db.all('SELECT * FROM payments');
      const settings = await this.db.all('SELECT * FROM settings');
      const dailyStats = await this.db.all('SELECT * FROM daily_stats WHERE date >= date("now", "-90 days")');

      const backupData = {
        timestamp: new Date().toISOString(),
        version: '1.0',
        data: {
          users,
          groups,
          group_members: groupMembers,
          scraping_jobs: scrapingJobs,
          action_logs: actionLogs,
          payments,
          settings,
          daily_stats: dailyStats
        },
        stats: {
          total_users: users.length,
          total_groups: groups.length,
          total_members: groupMembers.length,
          total_jobs: scrapingJobs.length
        }
      };

      await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      
      // Log da ação
      await this.db.saveActionLog('backup_created', null, null, {
        backup_file: backupFile,
        stats: backupData.stats
      });

      console.log(`✅ Backup completo criado: ${backupFile}`);
      return backupFile;
    } catch (error) {
      console.error('❌ Erro ao criar backup:', error.message);
      throw error;
    }
  }

  // Backup específico de membros de um grupo
  async backupGroupMembers(groupId) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `group_${groupId}_${timestamp}.json`);

      // Busca dados do grupo
      const group = await this.db.get('SELECT * FROM groups WHERE telegram_id = ?', [groupId]);
      if (!group) {
        throw new Error(`Grupo ${groupId} não encontrado`);
      }

      const members = await this.db.all(`
        SELECT gm.*, u.username, u.first_name, u.last_name, u.phone
        FROM group_members gm
        LEFT JOIN users u ON gm.user_id = u.telegram_id
        WHERE gm.group_id = ? AND gm.is_active = 1
        ORDER BY gm.joined_at DESC
      `, [groupId]);

      const backupData = {
        timestamp: new Date().toISOString(),
        group: group,
        members: members,
        total_members: members.length
      };

      await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      
      console.log(`✅ Backup do grupo ${group.name} criado: ${backupFile}`);
      return backupFile;
    } catch (error) {
      console.error('❌ Erro ao fazer backup do grupo:', error.message);
      throw error;
    }
  }

  // === REPLICAÇÃO DE MEMBROS ===

  // Replica membros de um grupo para outro
  async replicateMembers(sourceGroupId, targetGroupId, options = {}) {
    try {
      const {
        maxMembers = 100,
        onlyActive = true,
        excludeAdmins = false,
        delayBetweenAdds = 2000,
        onProgress = null
      } = options;

      console.log(`🔄 Iniciando replicação: ${sourceGroupId} → ${targetGroupId}`);

      // Verifica se os grupos existem
      const sourceGroup = await this.db.get('SELECT * FROM groups WHERE telegram_id = ?', [sourceGroupId]);
      const targetGroup = await this.db.get('SELECT * FROM groups WHERE telegram_id = ?', [targetGroupId]);

      if (!sourceGroup || !targetGroup) {
        throw new Error('Grupo de origem ou destino não encontrado');
      }

      // Busca membros do grupo de origem
      let sql = `
        SELECT DISTINCT gm.user_id, gm.username, gm.first_name, gm.last_name
        FROM group_members gm
        WHERE gm.group_id = ?
      `;
      const params = [sourceGroupId];

      if (onlyActive) {
        sql += ' AND gm.is_active = 1';
      }

      if (excludeAdmins) {
        sql += " AND gm.status != 'administrator'";
      }

      // Exclui membros que já estão no grupo de destino
      sql += ` AND gm.user_id NOT IN (
        SELECT user_id FROM group_members 
        WHERE group_id = ? AND is_active = 1
      )`;
      params.push(targetGroupId);

      sql += ` ORDER BY gm.last_seen DESC LIMIT ?`;
      params.push(maxMembers);

      const membersToReplicate = await this.db.all(sql, params);

      if (membersToReplicate.length === 0) {
        console.log('ℹ️ Nenhum membro para replicar');
        return { success: 0, failed: 0, total: 0 };
      }

      // Cria job de replicação
      const jobId = await this.db.createScrapingJob(
        sourceGroupId,
        targetGroupId,
        'replication',
        membersToReplicate.length
      );

      let successCount = 0;
      let failedCount = 0;

      // Processa membros em lotes
      for (let i = 0; i < membersToReplicate.length; i++) {
        const member = membersToReplicate[i];
        
        try {
          // Simula adição do membro (aqui você integraria com a API do Telegram)
          await this.simulateAddMember(targetGroupId, member);
          
          // Salva membro no grupo de destino
          await this.db.saveGroupMember(
            targetGroupId,
            member.user_id,
            member.username,
            member.first_name,
            member.last_name
          );

          successCount++;
          
          // Log de sucesso
          await this.db.saveActionLog('member_replicated', member.user_id, targetGroupId, {
            source_group: sourceGroupId,
            target_group: targetGroupId,
            job_id: jobId
          });

        } catch (error) {
          failedCount++;
          console.error(`❌ Erro ao replicar membro ${member.user_id}:`, error.message);
          
          // Log de erro
          await this.db.saveActionLog('member_replication_failed', member.user_id, targetGroupId, {
            source_group: sourceGroupId,
            error: error.message,
            job_id: jobId
          }, false);
        }

        // Atualiza progresso
        const progress = Math.round(((i + 1) / membersToReplicate.length) * 100);
        await this.db.updateScrapingJob(jobId, {
          progress,
          added_members: successCount,
          failed_members: failedCount
        });

        // Callback de progresso
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: membersToReplicate.length,
            success: successCount,
            failed: failedCount,
            progress
          });
        }

        // Delay entre adições
        if (i < membersToReplicate.length - 1) {
          await this.delay(delayBetweenAdds);
        }
      }

      // Finaliza job
      await this.db.updateScrapingJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString()
      });

      const result = {
        success: successCount,
        failed: failedCount,
        total: membersToReplicate.length,
        job_id: jobId
      };

      console.log(`✅ Replicação concluída: ${successCount}/${membersToReplicate.length} membros`);
      return result;

    } catch (error) {
      console.error('❌ Erro na replicação:', error.message);
      throw error;
    }
  }

  // Simula adição de membro (substituir pela integração real)
  async simulateAddMember(groupId, member) {
    // Aqui você integraria com a API do Telegram para adicionar o membro
    // Por enquanto, apenas simula um delay
    await this.delay(500);
    
    // Simula 10% de chance de falha
    if (Math.random() < 0.1) {
      throw new Error('Falha simulada na adição');
    }
  }

  // === RESTAURAÇÃO ===

  // Restaura backup
  async restoreBackup(backupFile) {
    try {
      console.log(`🔄 Iniciando restauração do backup: ${backupFile}`);
      
      const backupData = JSON.parse(await fs.readFile(backupFile, 'utf8'));
      
      if (!backupData.data) {
        throw new Error('Formato de backup inválido');
      }

      // Restaura dados (implementar conforme necessário)
      console.log('⚠️ Restauração de backup ainda não implementada completamente');
      console.log('📊 Estatísticas do backup:', backupData.stats);
      
      return backupData.stats;
    } catch (error) {
      console.error('❌ Erro ao restaurar backup:', error.message);
      throw error;
    }
  }

  // === LIMPEZA ===

  // Remove backups antigos
  async cleanOldBackups(daysToKeep = 30) {
    try {
      const files = await fs.readdir(this.backupDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let removedCount = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
            removedCount++;
            console.log(`🗑️ Backup removido: ${file}`);
          }
        }
      }

      console.log(`✅ Limpeza concluída: ${removedCount} backups removidos`);
      return removedCount;
    } catch (error) {
      console.error('❌ Erro na limpeza de backups:', error.message);
      throw error;
    }
  }

  // === UTILITÁRIOS ===

  // Lista backups disponíveis
  async listBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);
          
          backups.push({
            filename: file,
            path: filePath,
            size: stats.size,
            created: stats.mtime,
            age_days: Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24))
          });
        }
      }

      return backups.sort((a, b) => b.created - a.created);
    } catch (error) {
      console.error('❌ Erro ao listar backups:', error.message);
      return [];
    }
  }

  // Delay helper
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Agenda backup automático
  scheduleAutoBackup(intervalHours = 24) {
    console.log(`⏰ Backup automático agendado a cada ${intervalHours} horas`);
    
    setInterval(async () => {
      try {
        await this.createFullBackup();
        await this.cleanOldBackups();
      } catch (error) {
        console.error('❌ Erro no backup automático:', error.message);
      }
    }, intervalHours * 60 * 60 * 1000);
  }
}

module.exports = BackupManager;