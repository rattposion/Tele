const cron = require('node-cron');
const moment = require('moment');
const database = require('./db');
const TelegramSubscriptionBot = require('./bot');
require('dotenv').config();

// Configuração do momento para português
moment.locale('pt-br');

class CronManager {
  constructor() {
    this.bot = null;
    this.jobs = new Map();
    this.isRunning = false;
    
    console.log('⏰ CronManager inicializado');
  }

  // Define o bot para envio de mensagens
  setBot(bot) {
    this.bot = bot;
    console.log('🤖 Bot definido no CronManager');
  }

  // Inicia todos os jobs de cron
  start() {
    if (this.isRunning) {
      console.log('⚠️ Cron jobs já estão rodando');
      return;
    }

    try {
      // Job para cobranças mensais (dia 1 de cada mês às 9h)
      const monthlyChargeSchedule = process.env.CRON_MONTHLY_CHARGE || '0 9 1 * *';
      this.scheduleMonthlyCharges(monthlyChargeSchedule);

      // Job para verificar assinaturas próximas do vencimento (diário às 8h)
      this.scheduleExpirationWarnings('0 8 * * *');

      // Job para marcar assinaturas expiradas (diário às 0h)
      this.scheduleExpiredSubscriptions('0 0 * * *');

      // Job para limpeza de pagamentos antigos (semanal, domingo às 2h)
      this.scheduleCleanupOldPayments('0 2 * * 0');

      // Job para relatório diário (diário às 18h)
      this.scheduleDailyReport('0 18 * * *');

      this.isRunning = true;
      console.log('✅ Todos os cron jobs iniciados');
      
    } catch (error) {
      console.error('❌ Erro ao iniciar cron jobs:', error.message);
    }
  }

  // Para todos os jobs
  stop() {
    try {
      this.jobs.forEach((job, name) => {
        job.stop();
        console.log(`🛑 Job ${name} parado`);
      });
      
      this.jobs.clear();
      this.isRunning = false;
      
      console.log('✅ Todos os cron jobs parados');
    } catch (error) {
      console.error('❌ Erro ao parar cron jobs:', error.message);
    }
  }

  // Agenda cobranças mensais
  scheduleMonthlyCharges(schedule) {
    const job = cron.schedule(schedule, async () => {
      console.log('📅 Executando cobranças mensais...');
      await this.processMonthlyCharges();
    }, {
      scheduled: false,
      timezone: 'America/Sao_Paulo'
    });

    this.jobs.set('monthly_charges', job);
    job.start();
    
    console.log(`⏰ Cobranças mensais agendadas: ${schedule}`);
  }

  // Agenda avisos de expiração
  scheduleExpirationWarnings(schedule) {
    const job = cron.schedule(schedule, async () => {
      console.log('⚠️ Verificando assinaturas próximas do vencimento...');
      await this.processExpirationWarnings();
    }, {
      scheduled: false,
      timezone: 'America/Sao_Paulo'
    });

    this.jobs.set('expiration_warnings', job);
    job.start();
    
    console.log(`⏰ Avisos de expiração agendados: ${schedule}`);
  }

  // Agenda marcação de assinaturas expiradas
  scheduleExpiredSubscriptions(schedule) {
    const job = cron.schedule(schedule, async () => {
      console.log('⏰ Verificando assinaturas expiradas...');
      await this.processExpiredSubscriptions();
    }, {
      scheduled: false,
      timezone: 'America/Sao_Paulo'
    });

    this.jobs.set('expired_subscriptions', job);
    job.start();
    
    console.log(`⏰ Verificação de expirados agendada: ${schedule}`);
  }

  // Agenda limpeza de pagamentos antigos
  scheduleCleanupOldPayments(schedule) {
    const job = cron.schedule(schedule, async () => {
      console.log('🧹 Executando limpeza de pagamentos antigos...');
      await this.cleanupOldPayments();
    }, {
      scheduled: false,
      timezone: 'America/Sao_Paulo'
    });

    this.jobs.set('cleanup_payments', job);
    job.start();
    
    console.log(`⏰ Limpeza de pagamentos agendada: ${schedule}`);
  }

  // Agenda relatório diário
  scheduleDailyReport(schedule) {
    const job = cron.schedule(schedule, async () => {
      console.log('📊 Gerando relatório diário...');
      await this.generateDailyReport();
    }, {
      scheduled: false,
      timezone: 'America/Sao_Paulo'
    });

    this.jobs.set('daily_report', job);
    job.start();
    
    console.log(`⏰ Relatório diário agendado: ${schedule}`);
  }

  // Processa cobranças mensais para usuários ativos
  async processMonthlyCharges() {
    try {
      const activeUsers = await database.getActiveUsers();
      
      console.log(`💳 Processando ${activeUsers.length} cobranças mensais`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const user of activeUsers) {
        try {
          // Verifica se a assinatura ainda está válida
          const subscriptionEnd = moment(user.subscription_end);
          const now = moment();
          
          // Se a assinatura expira em menos de 7 dias, gera nova cobrança
          if (subscriptionEnd.diff(now, 'days') <= 7) {
            if (this.bot) {
              await this.bot.sendRenewalCharge(user.telegram_id);
              successCount++;
              
              // Aguarda um pouco entre envios para não sobrecarregar
              await this.sleep(1000);
            }
          }
        } catch (error) {
          console.error(`❌ Erro ao processar cobrança para usuário ${user.telegram_id}:`, error.message);
          errorCount++;
        }
      }
      
      console.log(`✅ Cobranças mensais processadas: ${successCount} sucessos, ${errorCount} erros`);
      
    } catch (error) {
      console.error('❌ Erro ao processar cobranças mensais:', error.message);
    }
  }

  // Processa avisos de expiração
  async processExpirationWarnings() {
    try {
      const activeUsers = await database.getActiveUsers();
      const warningDays = [7, 3, 1]; // Avisa 7, 3 e 1 dia antes
      
      let warningCount = 0;
      
      for (const user of activeUsers) {
        try {
          const subscriptionEnd = moment(user.subscription_end);
          const now = moment();
          const daysLeft = subscriptionEnd.diff(now, 'days');
          
          // Envia aviso se estiver nos dias de warning
          if (warningDays.includes(daysLeft)) {
            await this.sendExpirationWarning(user, daysLeft);
            warningCount++;
            
            await this.sleep(500);
          }
        } catch (error) {
          console.error(`❌ Erro ao enviar aviso para usuário ${user.telegram_id}:`, error.message);
        }
      }
      
      if (warningCount > 0) {
        console.log(`⚠️ ${warningCount} avisos de expiração enviados`);
      }
      
    } catch (error) {
      console.error('❌ Erro ao processar avisos de expiração:', error.message);
    }
  }

  // Envia aviso de expiração para usuário
  async sendExpirationWarning(user, daysLeft) {
    if (!this.bot) return;
    
    try {
      const endDate = moment(user.subscription_end).format('DD/MM/YYYY');
      const dayText = daysLeft === 1 ? 'dia' : 'dias';
      
      const message = `
⚠️ *Aviso de Vencimento*

🗓️ Sua assinatura expira em *${daysLeft} ${dayText}* (${endDate})

💡 Renove agora para não perder o acesso ao conteúdo premium!

👉 Use /start para renovar sua assinatura.`;
      
      await this.bot.bot.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' });
      
      console.log(`⚠️ Aviso enviado para ${user.first_name} (${daysLeft} dias restantes)`);
      
    } catch (error) {
      console.error(`❌ Erro ao enviar aviso para ${user.telegram_id}:`, error.message);
    }
  }

  // Processa assinaturas expiradas
  async processExpiredSubscriptions() {
    try {
      const activeUsers = await database.getActiveUsers();
      const now = moment();
      
      let expiredCount = 0;
      
      for (const user of activeUsers) {
        try {
          const subscriptionEnd = moment(user.subscription_end);
          
          // Se a assinatura já expirou
          if (subscriptionEnd.isBefore(now)) {
            // Marca como expirada
            await database.updateUserSubscription(user.telegram_id, 'expired');
            
            // Envia notificação de expiração
            await this.sendExpirationNotification(user);
            
            expiredCount++;
            
            await this.sleep(500);
          }
        } catch (error) {
          console.error(`❌ Erro ao processar expiração do usuário ${user.telegram_id}:`, error.message);
        }
      }
      
      if (expiredCount > 0) {
        console.log(`⏰ ${expiredCount} assinaturas marcadas como expiradas`);
      }
      
    } catch (error) {
      console.error('❌ Erro ao processar assinaturas expiradas:', error.message);
    }
  }

  // Envia notificação de expiração
  async sendExpirationNotification(user) {
    if (!this.bot) return;
    
    try {
      const message = `
❌ *Assinatura Expirada*

😔 Sua assinatura expirou e você perdeu o acesso ao conteúdo premium.

🔄 *Quer continuar?*
Renove sua assinatura para voltar a ter acesso completo!

👉 Use /start para assinar novamente.`;
      
      await this.bot.bot.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' });
      
      console.log(`❌ Notificação de expiração enviada para ${user.first_name}`);
      
    } catch (error) {
      console.error(`❌ Erro ao enviar notificação de expiração para ${user.telegram_id}:`, error.message);
    }
  }

  // Limpa pagamentos antigos
  async cleanupOldPayments() {
    try {
      // Remove pagamentos pendentes com mais de 30 dias
      const cutoffDate = moment().subtract(30, 'days').format('YYYY-MM-DD');
      
      const deleteQuery = `
        DELETE FROM payments 
        WHERE status = 'pending' 
        AND created_at < ?
      `;
      
      return new Promise((resolve, reject) => {
        database.db.run(deleteQuery, [cutoffDate], function(err) {
          if (err) {
            console.error('❌ Erro ao limpar pagamentos antigos:', err.message);
            reject(err);
          } else {
            if (this.changes > 0) {
              console.log(`🧹 ${this.changes} pagamentos antigos removidos`);
            }
            resolve(this.changes);
          }
        });
      });
      
    } catch (error) {
      console.error('❌ Erro na limpeza de pagamentos:', error.message);
    }
  }

  // Gera relatório diário para admins
  async generateDailyReport() {
    try {
      const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
      
      if (adminIds.length === 0 || !this.bot) {
        return;
      }
      
      const users = await database.getAllUsers();
      const activeUsers = users.filter(u => u.status === 'active');
      const expiredToday = users.filter(u => {
        return u.status === 'expired' && 
               moment(u.updated_at).format('YYYY-MM-DD') === moment().format('YYYY-MM-DD');
      });
      
      const subscriptionPrice = parseInt(process.env.SUBSCRIPTION_PRICE) || 4990;
      const monthlyRevenue = activeUsers.length * subscriptionPrice;
      
      const report = `
📊 *Relatório Diário - ${moment().format('DD/MM/YYYY')}*

👥 *Usuários:*
• Total: ${users.length}
• Ativos: ${activeUsers.length}
• Expiraram hoje: ${expiredToday.length}

💰 *Financeiro:*
• Receita mensal: ${this.formatCurrency(monthlyRevenue)}
• Ticket médio: ${this.formatCurrency(subscriptionPrice)}

📈 *Performance:*
• Taxa de conversão: ${users.length > 0 ? Math.round((activeUsers.length / users.length) * 100) : 0}%
• Churn hoje: ${expiredToday.length}`;
      
      // Envia para todos os admins
      for (const adminId of adminIds) {
        try {
          await this.bot.bot.sendMessage(adminId.trim(), report, { parse_mode: 'Markdown' });
        } catch (error) {
          console.error(`❌ Erro ao enviar relatório para admin ${adminId}:`, error.message);
        }
      }
      
      console.log('📊 Relatório diário enviado para admins');
      
    } catch (error) {
      console.error('❌ Erro ao gerar relatório diário:', error.message);
    }
  }

  // Formata valor monetário
  formatCurrency(amountInCents) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amountInCents / 100);
  }

  // Função auxiliar para aguardar
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Executa job manualmente (para testes)
  async runJob(jobName) {
    try {
      console.log(`🔄 Executando job manual: ${jobName}`);
      
      switch (jobName) {
        case 'monthly_charges':
          await this.processMonthlyCharges();
          break;
        case 'expiration_warnings':
          await this.processExpirationWarnings();
          break;
        case 'expired_subscriptions':
          await this.processExpiredSubscriptions();
          break;
        case 'cleanup_payments':
          await this.cleanupOldPayments();
          break;
        case 'daily_report':
          await this.generateDailyReport();
          break;
        default:
          throw new Error(`Job não encontrado: ${jobName}`);
      }
      
      console.log(`✅ Job ${jobName} executado com sucesso`);
      
    } catch (error) {
      console.error(`❌ Erro ao executar job ${jobName}:`, error.message);
      throw error;
    }
  }

  // Retorna status dos jobs
  getStatus() {
    const status = {
      running: this.isRunning,
      jobs: []
    };
    
    this.jobs.forEach((job, name) => {
      status.jobs.push({
        name,
        running: job.running || false
      });
    });
    
    return status;
  }
}

// Instância singleton
const cronManager = new CronManager();

// Se executado diretamente, inicia os jobs
if (require.main === module) {
  console.log('🚀 Iniciando CronManager standalone...');
  
  // Conecta ao banco
  database.connect()
    .then(() => {
      cronManager.start();
      console.log('✅ CronManager iniciado com sucesso!');
    })
    .catch(error => {
      console.error('❌ Erro ao iniciar CronManager:', error.message);
      process.exit(1);
    });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📨 SIGTERM recebido');
    cronManager.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('📨 SIGINT recebido');
    cronManager.stop();
    process.exit(0);
  });
}

module.exports = cronManager;