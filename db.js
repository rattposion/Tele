const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './database.sqlite';

class Database {
  constructor() {
    this.db = null;
  }

  // Conecta ao banco de dados
  connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Erro ao conectar com o banco de dados:', err.message);
          reject(err);
        } else {
          console.log('✅ Conectado ao banco de dados SQLite');
          resolve();
        }
      });
    });
  }

  // Executa as migrations
  async migrate() {
    try {
      await this.createUsersTable();
      await this.createPaymentsTable();
      await this.createGroupsTable();
      await this.createGroupMembersTable();
      await this.createScrapingJobsTable();
      await this.createActionLogsTable();
      await this.createDailyStatsTable();
      await this.createSettingsTable();
      await this.createIndexes();
      console.log('✅ Migrations executadas com sucesso');
    } catch (error) {
      console.error('❌ Erro ao executar migrations:', error);
      throw error;
    }
  }

  // Cria tabela de usuários
  createUsersTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT UNIQUE NOT NULL,
          username TEXT,
          first_name TEXT,
          last_name TEXT,
          phone TEXT,
          status TEXT DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'expired')),
          subscription_start DATE,
          subscription_end DATE,
          last_payment_date DATE,
          is_active BOOLEAN DEFAULT 1,
          dm_consent BOOLEAN DEFAULT NULL,
          last_interaction DATETIME,
          interaction_count INTEGER DEFAULT 0,
          last_dm_sent DATETIME,
          dm_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela users:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela users criada/verificada');
          resolve();
        }
      });
    });
  }

  // Cria tabela de pagamentos
  createPaymentsTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          telegram_id TEXT NOT NULL,
          infinitepay_id TEXT UNIQUE,
          amount INTEGER NOT NULL,
          currency TEXT DEFAULT 'BRL',
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'expired', 'cancelled')),
          pix_code TEXT,
          qr_code_url TEXT,
          due_date DATE,
          paid_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela payments:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela payments criada/verificada');
          resolve();
        }
      });
    });
  }

  // Busca ou cria usuário
  async findOrCreateUser(telegramUser) {
    return new Promise((resolve, reject) => {
      const { id, username, first_name, last_name } = telegramUser;
      
      // Primeiro tenta buscar o usuário
      const selectSql = 'SELECT * FROM users WHERE telegram_id = ?';
      
      this.db.get(selectSql, [id.toString()], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (row) {
          // Usuário existe, atualiza informações
          const updateSql = `
            UPDATE users 
            SET username = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE telegram_id = ?
          `;
          
          this.db.run(updateSql, [username, first_name, last_name, id.toString()], function(updateErr) {
            if (updateErr) {
              reject(updateErr);
            } else {
              resolve({ ...row, username, first_name, last_name });
            }
          });
        } else {
          // Usuário não existe, cria novo
          const insertSql = `
            INSERT INTO users (telegram_id, username, first_name, last_name) 
            VALUES (?, ?, ?, ?)
          `;
          
          this.db.run(insertSql, [id.toString(), username, first_name, last_name], function(insertErr) {
            if (insertErr) {
              reject(insertErr);
            } else {
              // Busca o usuário recém-criado
              const newUserSql = 'SELECT * FROM users WHERE id = ?';
              this.get(newUserSql, [this.lastID], (getUserErr, newUser) => {
                if (getUserErr) {
                  reject(getUserErr);
                } else {
                  resolve(newUser);
                }
              });
            }
          });
        }
      });
    });
  }

  // Atualiza status da assinatura do usuário
  updateUserSubscription(telegramId, status, subscriptionEnd = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE users 
        SET status = ?, subscription_end = ?, updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = ?
      `;
      
      this.db.run(sql, [status, subscriptionEnd, telegramId.toString()], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // Cria novo pagamento
  createPayment(paymentData) {
    return new Promise((resolve, reject) => {
      const {
        user_id,
        telegram_id,
        infinitepay_id,
        amount,
        currency = 'BRL',
        pix_code,
        qr_code_url,
        due_date
      } = paymentData;
      
      const sql = `
        INSERT INTO payments (user_id, telegram_id, infinitepay_id, amount, currency, pix_code, qr_code_url, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(sql, [user_id, telegram_id.toString(), infinitepay_id, amount, currency, pix_code, qr_code_url, due_date], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  // Atualiza status do pagamento
  updatePaymentStatus(infinitepayId, status, paidAt = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE payments 
        SET status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE infinitepay_id = ?
      `;
      
      this.db.run(sql, [status, paidAt, infinitepayId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // Busca usuários ativos
  getActiveUsers() {
    return new Promise((resolve, reject) => {
      const sql = "SELECT * FROM users WHERE status = 'active'";
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Busca todos os usuários (para admin)
  getAllUsers() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM users ORDER BY created_at DESC';
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Busca usuário por telegram_id
  getUserByTelegramId(telegramId) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM users WHERE telegram_id = ?';
      
      this.db.get(sql, [telegramId.toString()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Busca pagamentos pendentes expirados
  getExpiredPayments() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM payments 
        WHERE status = 'pending' AND due_date < date('now')
      `;
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Cria tabela de grupos
  createGroupsTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          username TEXT,
          type TEXT NOT NULL,
          member_count INTEGER DEFAULT 0,
          description TEXT,
          invite_link TEXT,
          is_active BOOLEAN DEFAULT 1,
          auto_post_enabled BOOLEAN DEFAULT 1,
          last_post_at DATETIME,
          post_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela groups:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela groups criada/verificada');
          resolve();
        }
      });
    });
  }

  // Cria tabela de membros de grupos
  createGroupMembersTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS group_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          username TEXT,
          first_name TEXT,
          last_name TEXT,
          status TEXT DEFAULT 'member',
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          left_at DATETIME,
          last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
          message_count INTEGER DEFAULT 0,
          is_bot BOOLEAN DEFAULT 0,
          is_premium BOOLEAN DEFAULT 0,
          is_active BOOLEAN DEFAULT 1,
          FOREIGN KEY (group_id) REFERENCES groups (id),
          UNIQUE(group_id, user_id)
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela group_members:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela group_members criada/verificada');
          resolve();
        }
      });
    });
  }

  // Cria tabela de scraping jobs
  createScrapingJobsTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS scraping_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_group_id INTEGER NOT NULL,
          target_group_id INTEGER,
          type TEXT DEFAULT 'scraping',
          status TEXT DEFAULT 'pending',
          progress INTEGER DEFAULT 0,
          total_members INTEGER DEFAULT 0,
          scraped_members INTEGER DEFAULT 0,
          added_members INTEGER DEFAULT 0,
          failed_members INTEGER DEFAULT 0,
          error_message TEXT,
          config TEXT,
          started_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_group_id) REFERENCES groups (id),
          FOREIGN KEY (target_group_id) REFERENCES groups (id)
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela scraping_jobs:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela scraping_jobs criada/verificada');
          resolve();
        }
      });
    });
  }

  // Cria tabela de logs de ações
  createActionLogsTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS action_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_type TEXT NOT NULL,
          user_id INTEGER,
          group_id INTEGER,
          details TEXT,
          metadata TEXT,
          success BOOLEAN DEFAULT 1,
          error_message TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela action_logs:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela action_logs criada/verificada');
          resolve();
        }
      });
    });
  }

  // === MÉTODOS PARA GRUPOS ===

  // Salvar ou atualizar grupo
  async saveGroup(groupData) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO groups 
        (telegram_id, title, username, type, member_count, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      this.db.run(sql, [
        groupData.id,
        groupData.title,
        groupData.username || null,
        groupData.type,
        groupData.member_count || 0
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  // Buscar grupo por telegram_id
  async getGroup(telegramId) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM groups WHERE telegram_id = ?';
      this.db.get(sql, [telegramId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Listar todos os grupos
  async getAllGroups() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM groups ORDER BY created_at DESC';
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // === MÉTODOS PARA MEMBROS DE GRUPOS ===

  // Salvar membro do grupo
  async saveGroupMember(groupId, memberData) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO group_members 
        (group_id, user_id, username, first_name, last_name, status, is_bot, is_premium, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      this.db.run(sql, [
        groupId,
        memberData.id,
        memberData.username || null,
        memberData.first_name || null,
        memberData.last_name || null,
        memberData.status || 'member',
        memberData.is_bot || 0,
        memberData.is_premium || 0
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  // Buscar membros de um grupo
  async getGroupMembers(groupId, limit = 1000, offset = 0) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT gm.*, g.title as group_title 
        FROM group_members gm
        JOIN groups g ON gm.group_id = g.id
        WHERE gm.group_id = ?
        ORDER BY gm.last_seen DESC
        LIMIT ? OFFSET ?
      `;
      
      this.db.all(sql, [groupId, limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Contar membros de um grupo
  async countGroupMembers(groupId) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT COUNT(*) as count FROM group_members WHERE group_id = ?';
      this.db.get(sql, [groupId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  // Buscar membros ativos (não bots)
  async getActiveGroupMembers(groupId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM group_members 
        WHERE group_id = ? AND is_bot = 0 AND status IN ('member', 'administrator', 'creator')
        ORDER BY last_seen DESC
      `;
      
      this.db.all(sql, [groupId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // === MÉTODOS PARA SCRAPING JOBS ===

  // Criar job de scraping
  async createScrapingJob(sourceGroupId, targetGroupId = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO scraping_jobs (source_group_id, target_group_id, status)
        VALUES (?, ?, 'pending')
      `;
      
      this.db.run(sql, [sourceGroupId, targetGroupId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  // Buscar job de scraping ativo
  async getActiveScrapingJob(groupId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM scraping_jobs 
        WHERE source_group_id = ? AND status IN ('running', 'pending')
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      
      this.db.get(sql, [groupId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Buscar job de scraping por ID
  async getScrapingJob(jobId) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM scraping_jobs WHERE id = ?`;
      
      this.db.get(sql, [jobId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Atualizar job de scraping
  async updateScrapingJob(jobId, updates) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      
      Object.keys(updates).forEach(key => {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      });
      
      values.push(jobId);
      
      const sql = `UPDATE scraping_jobs SET ${fields.join(', ')} WHERE id = ?`;
      
      this.db.run(sql, values, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // Buscar jobs de scraping
  async getScrapingJobs(status = null) {
    return new Promise((resolve, reject) => {
      let sql = `
        SELECT sj.*, 
               sg.title as source_group_title,
               tg.title as target_group_title
        FROM scraping_jobs sj
        JOIN groups sg ON sj.source_group_id = sg.id
        LEFT JOIN groups tg ON sj.target_group_id = tg.id
      `;
      
      const params = [];
      
      if (status) {
        sql += ' WHERE sj.status = ?';
        params.push(status);
      }
      
      sql += ' ORDER BY sj.created_at DESC';
      
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Buscar jobs de scraping ativos
  async getActiveScrapingJobs() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT sj.*, 
               sg.title as source_group_title,
               tg.title as target_group_title
        FROM scraping_jobs sj
        JOIN groups sg ON sj.source_group_id = sg.id
        LEFT JOIN groups tg ON sj.target_group_id = tg.id
        WHERE sj.status IN ('running', 'pending')
        ORDER BY sj.created_at DESC
      `;
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // === MÉTODOS PARA LOGS ===

  // Salvar log de ação
  async saveActionLog(actionType, userId = null, groupId = null, details = null, success = true, errorMessage = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO action_logs (action_type, user_id, group_id, details, success, error_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(sql, [actionType, userId, groupId, details, success, errorMessage], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  // Buscar logs recentes
  async getRecentLogs(limit = 100) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT al.*, u.first_name, u.username, g.title as group_title
        FROM action_logs al
        LEFT JOIN users u ON al.user_id = u.telegram_id
        LEFT JOIN groups g ON al.group_id = g.id
        ORDER BY al.created_at DESC
        LIMIT ?
      `;
      
      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Cria tabela de estatísticas diárias
  createDailyStatsTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS daily_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT UNIQUE NOT NULL,
          total_users INTEGER DEFAULT 0,
          active_users INTEGER DEFAULT 0,
          total_groups INTEGER DEFAULT 0,
          active_groups INTEGER DEFAULT 0,
          total_members INTEGER DEFAULT 0,
          new_members INTEGER DEFAULT 0,
          messages_sent INTEGER DEFAULT 0,
          scraping_jobs INTEGER DEFAULT 0,
          successful_adds INTEGER DEFAULT 0,
          failed_adds INTEGER DEFAULT 0,
          revenue DECIMAL(10,2) DEFAULT 0,
          auto_posts_sent INTEGER DEFAULT 0,
          dm_sent INTEGER DEFAULT 0,
          ai_generations INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela daily_stats:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela daily_stats criada/verificada');
          resolve();
        }
      });
    });
  }

  // Cria tabela de configurações
  createSettingsTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          type TEXT DEFAULT 'string',
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(sql, (err) => {
        if (err) {
          console.error('Erro ao criar tabela settings:', err.message);
          reject(err);
        } else {
          console.log('✅ Tabela settings criada/verificada');
          resolve();
        }
      });
    });
  }

  // Cria índices para otimização
  createIndexes() {
    return new Promise(async (resolve, reject) => {
      try {
        const indexes = [
          // Índices para users
          'CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)',
          'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
          'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
          'CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)',
          'CREATE INDEX IF NOT EXISTS idx_users_dm_consent ON users(dm_consent)',
          'CREATE INDEX IF NOT EXISTS idx_users_last_interaction ON users(last_interaction)',
          'CREATE INDEX IF NOT EXISTS idx_users_last_dm_sent ON users(last_dm_sent)',
          
          // Índices para groups
          'CREATE INDEX IF NOT EXISTS idx_groups_telegram_id ON groups(telegram_id)',
          'CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active)',
          'CREATE INDEX IF NOT EXISTS idx_groups_type ON groups(type)',
          'CREATE INDEX IF NOT EXISTS idx_groups_auto_post ON groups(auto_post_enabled)',
          'CREATE INDEX IF NOT EXISTS idx_groups_last_post ON groups(last_post_at)',
          
          // Índices para group_members
          'CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id)',
          'CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id)',
          'CREATE INDEX IF NOT EXISTS idx_group_members_active ON group_members(is_active)',
          'CREATE INDEX IF NOT EXISTS idx_group_members_status ON group_members(status)',
          'CREATE INDEX IF NOT EXISTS idx_group_members_last_seen ON group_members(last_seen)',
          
          // Índices para scraping_jobs
          'CREATE INDEX IF NOT EXISTS idx_scraping_jobs_source_group_id ON scraping_jobs(source_group_id)',
          'CREATE INDEX IF NOT EXISTS idx_scraping_jobs_status ON scraping_jobs(status)',
          'CREATE INDEX IF NOT EXISTS idx_scraping_jobs_type ON scraping_jobs(type)',
          'CREATE INDEX IF NOT EXISTS idx_scraping_jobs_created_at ON scraping_jobs(created_at)',
          
          // Índices para action_logs
          'CREATE INDEX IF NOT EXISTS idx_action_logs_action_type ON action_logs(action_type)',
          'CREATE INDEX IF NOT EXISTS idx_action_logs_user_id ON action_logs(user_id)',
          'CREATE INDEX IF NOT EXISTS idx_action_logs_group_id ON action_logs(group_id)',
          'CREATE INDEX IF NOT EXISTS idx_action_logs_created_at ON action_logs(created_at)',
          'CREATE INDEX IF NOT EXISTS idx_action_logs_success ON action_logs(success)',
          
          // Índices para payments
          'CREATE INDEX IF NOT EXISTS idx_payments_telegram_id ON payments(telegram_id)',
          'CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)',
          'CREATE INDEX IF NOT EXISTS idx_payments_due_date ON payments(due_date)',
          'CREATE INDEX IF NOT EXISTS idx_payments_infinitepay_id ON payments(infinitepay_id)',
          
          // Índices para daily_stats
          'CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)',
          
          // Índices para settings
          'CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)'
        ];

        for (const indexSql of indexes) {
          await new Promise((res, rej) => {
            this.db.run(indexSql, (err) => {
              if (err) rej(err);
              else res();
            });
          });
        }

        console.log('✅ Todos os índices foram criados com sucesso');
        resolve();
      } catch (error) {
        console.error('❌ Erro ao criar índices:', error.message);
        reject(error);
      }
    });
  }

  // === MÉTODOS PARA CONFIGURAÇÕES ===
  
  // Salva ou atualiza uma configuração
  async saveSetting(key, value, type = 'string', description = '') {
    try {
      const sql = `
        INSERT OR REPLACE INTO settings (key, value, type, description, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      await this.run(sql, [key, value, type, description]);
      console.log(`✅ Configuração ${key} salva`);
    } catch (error) {
      console.error('❌ Erro ao salvar configuração:', error.message);
      throw error;
    }
  }
  
  // Busca uma configuração
  async getSetting(key, defaultValue = null) {
    try {
      const sql = 'SELECT value, type FROM settings WHERE key = ?';
      const row = await this.get(sql, [key]);
      
      if (!row) return defaultValue;
      
      // Converte o valor baseado no tipo
      switch (row.type) {
        case 'number':
          return Number(row.value);
        case 'boolean':
          return row.value === 'true';
        case 'json':
          return JSON.parse(row.value);
        default:
          return row.value;
      }
    } catch (error) {
      console.error('❌ Erro ao buscar configuração:', error.message);
      return defaultValue;
    }
  }
  
  // Lista todas as configurações
  async getAllSettings() {
    try {
      const sql = 'SELECT * FROM settings ORDER BY key';
      return await this.all(sql);
    } catch (error) {
      console.error('❌ Erro ao buscar configurações:', error.message);
      return [];
    }
  }
  
  // === MÉTODOS PARA ESTATÍSTICAS DIÁRIAS ===
  
  // Salva estatísticas do dia
  async saveDailyStats(date, stats) {
    try {
      const sql = `
        INSERT OR REPLACE INTO daily_stats (
          date, total_users, active_users, total_groups, active_groups,
          total_members, new_members, messages_sent, scraping_jobs,
          successful_adds, failed_adds, revenue
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await this.run(sql, [
        date,
        stats.total_users || 0,
        stats.active_users || 0,
        stats.total_groups || 0,
        stats.active_groups || 0,
        stats.total_members || 0,
        stats.new_members || 0,
        stats.messages_sent || 0,
        stats.scraping_jobs || 0,
        stats.successful_adds || 0,
        stats.failed_adds || 0,
        stats.revenue || 0
      ]);
      
      console.log(`✅ Estatísticas do dia ${date} salvas`);
    } catch (error) {
      console.error('❌ Erro ao salvar estatísticas diárias:', error.message);
      throw error;
    }
  }
  
  // Busca estatísticas de um período
  async getDailyStats(startDate, endDate = null) {
    try {
      let sql = 'SELECT * FROM daily_stats WHERE date >= ?';
      const params = [startDate];
      
      if (endDate) {
        sql += ' AND date <= ?';
        params.push(endDate);
      }
      
      sql += ' ORDER BY date DESC';
      return await this.all(sql, params);
    } catch (error) {
      console.error('❌ Erro ao buscar estatísticas diárias:', error.message);
      return [];
    }
  }
  
  // Gera estatísticas do dia atual
  async generateTodayStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Busca dados para estatísticas
      const totalUsers = await this.get('SELECT COUNT(*) as count FROM users');
      const activeUsers = await this.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
      const totalGroups = await this.get('SELECT COUNT(*) as count FROM groups');
      const activeGroups = await this.get('SELECT COUNT(*) as count FROM groups WHERE is_active = 1');
      const totalMembers = await this.get('SELECT COUNT(*) as count FROM group_members WHERE is_active = 1');
      
      // Novos membros hoje
      const newMembers = await this.get(`
        SELECT COUNT(*) as count FROM group_members 
        WHERE DATE(joined_at) = ?
      `, [today]);
      
      // Jobs de scraping hoje
      const scrapingJobs = await this.get(`
        SELECT COUNT(*) as count FROM scraping_jobs 
        WHERE DATE(created_at) = ?
      `, [today]);
      
      // Receita do dia
      const revenue = await this.get(`
        SELECT COALESCE(SUM(amount), 0) as total FROM payments 
        WHERE status = 'paid' AND DATE(created_at) = ?
      `, [today]);
      
      const stats = {
        total_users: totalUsers.count,
        active_users: activeUsers.count,
        total_groups: totalGroups.count,
        active_groups: activeGroups.count,
        total_members: totalMembers.count,
        new_members: newMembers.count,
        messages_sent: 0, // Será implementado quando houver tracking de mensagens
        scraping_jobs: scrapingJobs.count,
        successful_adds: 0, // Será calculado baseado nos logs
        failed_adds: 0, // Será calculado baseado nos logs
        revenue: revenue.total
      };
      
      await this.saveDailyStats(today, stats);
      return stats;
    } catch (error) {
      console.error('❌ Erro ao gerar estatísticas do dia:', error.message);
      throw error;
    }
  }
  
  // === MÉTODOS PARA ESTATÍSTICAS AVANÇADAS ===

  // Estatísticas completas do sistema
  async getAdvancedStats() {
    return new Promise((resolve, reject) => {
      const queries = [
        'SELECT COUNT(*) as total_users FROM users',
        'SELECT COUNT(*) as active_subscribers FROM users WHERE subscription_status = "active"',
        'SELECT COUNT(*) as total_groups FROM groups WHERE is_active = 1',
        'SELECT COUNT(*) as total_members FROM group_members',
        'SELECT COUNT(*) as pending_jobs FROM scraping_jobs WHERE status = "pending"',
        'SELECT COUNT(*) as completed_jobs FROM scraping_jobs WHERE status = "completed"',
        'SELECT SUM(amount) as total_revenue FROM payments WHERE status = "paid"',
        'SELECT COUNT(*) as today_payments FROM payments WHERE DATE(created_at) = DATE("now")'
      ];
      
      Promise.all(queries.map(query => 
        new Promise((res, rej) => {
          this.db.get(query, [], (err, row) => {
            if (err) rej(err);
            else res(row);
          });
        })
      )).then(results => {
        resolve({
          totalUsers: results[0].total_users,
          activeSubscribers: results[1].active_subscribers,
          totalGroups: results[2].total_groups,
          totalMembers: results[3].total_members,
          pendingJobs: results[4].pending_jobs,
          completedJobs: results[5].completed_jobs,
          totalRevenue: results[6].total_revenue || 0,
          todayPayments: results[7].today_payments
        });
      }).catch(reject);
    });
  }

  // Fecha conexão com o banco
  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('✅ Conexão com banco de dados fechada');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

// Instância singleton do banco
const database = new Database();

// Inicializa o banco se executado diretamente
if (require.main === module) {
  (async () => {
    try {
      await database.connect();
      await database.migrate();
      console.log('🚀 Banco de dados inicializado com sucesso!');
      process.exit(0);
    } catch (error) {
      console.error('❌ Erro ao inicializar banco:', error);
      process.exit(1);
    }
  })();
}

module.exports = database;