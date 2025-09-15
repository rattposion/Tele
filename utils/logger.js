const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, '..', 'logs');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  formatTimestamp() {
    return new Date().toISOString();
  }

  formatLogEntry(level, message, context = {}) {
    return {
      timestamp: this.formatTimestamp(),
      level: level.toUpperCase(),
      message,
      context,
      pid: process.pid
    };
  }

  writeToFile(filename, logEntry) {
    const logPath = path.join(this.logDir, filename);
    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      fs.appendFileSync(logPath, logLine);
    } catch (error) {
      console.error('Erro ao escrever log:', error);
    }
  }

  // Logs gerais
  info(message, context = {}) {
    const logEntry = this.formatLogEntry('info', message, context);
    console.log(`ℹ️ ${message}`, context);
    this.writeToFile('app.log', logEntry);
  }

  warn(message, context = {}) {
    const logEntry = this.formatLogEntry('warn', message, context);
    console.warn(`⚠️ ${message}`, context);
    this.writeToFile('app.log', logEntry);
  }

  error(message, error = null, context = {}) {
    const errorContext = {
      ...context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        status: error.status,
        statusText: error.statusText,
        errorDetails: error.errorDetails
      } : null
    };
    
    const logEntry = this.formatLogEntry('error', message, errorContext);
    console.error(`❌ ${message}`, errorContext);
    this.writeToFile('errors.log', logEntry);
    this.writeToFile('app.log', logEntry);
  }

  // Logs específicos para API do Gemini
  geminiApiCall(method, prompt, context = {}) {
    const logEntry = this.formatLogEntry('info', `Chamada API Gemini: ${method}`, {
      method,
      promptLength: prompt?.length || 0,
      promptPreview: prompt?.substring(0, 100) + (prompt?.length > 100 ? '...' : ''),
      ...context
    });
    
    console.log(`🤖 API Gemini: ${method}`, { promptLength: prompt?.length });
    this.writeToFile('gemini-api.log', logEntry);
  }

  geminiApiSuccess(method, responseLength, duration, context = {}) {
    const logEntry = this.formatLogEntry('info', `Sucesso API Gemini: ${method}`, {
      method,
      responseLength,
      duration,
      ...context
    });
    
    console.log(`✅ Gemini sucesso: ${method} (${duration}ms)`);
    this.writeToFile('gemini-api.log', logEntry);
  }

  geminiApiError(method, error, attempt, maxRetries, context = {}) {
    const errorContext = {
      method,
      attempt,
      maxRetries,
      error: {
        name: error.name,
        message: error.message,
        status: error.status,
        statusText: error.statusText,
        errorDetails: error.errorDetails
      },
      ...context
    };
    
    const logEntry = this.formatLogEntry('error', `Erro API Gemini: ${method}`, errorContext);
    console.error(`❌ Gemini erro: ${method} (tentativa ${attempt}/${maxRetries})`, { status: error.status });
    this.writeToFile('gemini-errors.log', logEntry);
    this.writeToFile('errors.log', logEntry);
  }

  geminiApiFallback(method, reason, context = {}) {
    const logEntry = this.formatLogEntry('warn', `Fallback Gemini: ${method}`, {
      method,
      reason,
      ...context
    });
    
    console.warn(`🔄 Gemini fallback: ${method} - ${reason}`);
    this.writeToFile('gemini-fallback.log', logEntry);
  }

  // Logs para performance
  performance(operation, duration, context = {}) {
    const logEntry = this.formatLogEntry('info', `Performance: ${operation}`, {
      operation,
      duration,
      ...context
    });
    
    if (duration > 5000) {
      console.warn(`⏱️ Performance lenta: ${operation} (${duration}ms)`);
    } else {
      console.log(`⏱️ Performance: ${operation} (${duration}ms)`);
    }
    
    this.writeToFile('performance.log', logEntry);
  }

  // Logs para usuários e grupos
  userAction(userId, action, context = {}) {
    const logEntry = this.formatLogEntry('info', `Ação usuário: ${action}`, {
      userId,
      action,
      ...context
    });
    
    console.log(`👤 Usuário ${userId}: ${action}`);
    this.writeToFile('user-actions.log', logEntry);
  }

  groupAction(groupId, action, context = {}) {
    const logEntry = this.formatLogEntry('info', `Ação grupo: ${action}`, {
      groupId,
      action,
      ...context
    });
    
    console.log(`👥 Grupo ${groupId}: ${action}`);
    this.writeToFile('group-actions.log', logEntry);
  }

  // Método para limpar logs antigos
  cleanOldLogs(daysToKeep = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    try {
      const files = fs.readdirSync(this.logDir);
      
      files.forEach(file => {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Log antigo removido: ${file}`);
        }
      });
    } catch (error) {
      console.error('Erro ao limpar logs antigos:', error);
    }
  }

  // Método para obter estatísticas dos logs
  getLogStats() {
    try {
      const files = fs.readdirSync(this.logDir);
      const stats = {};
      
      files.forEach(file => {
        const filePath = path.join(this.logDir, file);
        const fileStats = fs.statSync(filePath);
        
        stats[file] = {
          size: fileStats.size,
          modified: fileStats.mtime,
          lines: fs.readFileSync(filePath, 'utf8').split('\n').length - 1
        };
      });
      
      return stats;
    } catch (error) {
      console.error('Erro ao obter estatísticas dos logs:', error);
      return {};
    }
  }
}

// Singleton instance
const logger = new Logger();

module.exports = logger;