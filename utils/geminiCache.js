const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

class GeminiCache {
  constructor() {
    this.cacheDir = path.join(__dirname, '..', 'cache');
    this.memoryCache = new Map();
    this.maxMemoryItems = 100;
    this.defaultTTL = 24 * 60 * 60 * 1000; // 24 horas em ms
    
    this.ensureCacheDirectory();
    this.loadMemoryCache();
    
    // Limpeza automática a cada hora
    setInterval(() => this.cleanExpiredCache(), 60 * 60 * 1000);
  }

  ensureCacheDirectory() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        logger.info(`Cache directory created: ${this.cacheDir}`);
      }
    } catch (error) {
      logger.error(`Failed to create cache directory ${this.cacheDir}:`, error.message);
      
      // Fallback para diretório temporário
      const tempDir = require('os').tmpdir();
      this.cacheDir = path.join(tempDir, 'gemini-cache');
      
      try {
        if (!fs.existsSync(this.cacheDir)) {
          fs.mkdirSync(this.cacheDir, { recursive: true });
          logger.warn(`Using fallback cache directory: ${this.cacheDir}`);
        }
      } catch (fallbackError) {
        logger.error('Failed to create fallback cache directory:', fallbackError.message);
        // Desabilitar cache em disco se não conseguir criar diretório
        this.cacheDir = null;
        logger.warn('Disk cache disabled - using memory cache only');
      }
    }
  }

  /**
   * Gera uma chave única baseada no tipo de operação e parâmetros
   */
  generateCacheKey(operation, params) {
    const normalizedParams = this.normalizeParams(params);
    const keyString = `${operation}:${JSON.stringify(normalizedParams)}`;
    return crypto.createHash('md5').update(keyString).digest('hex');
  }

  /**
   * Normaliza parâmetros para gerar chaves consistentes
   */
  normalizeParams(params) {
    if (!params || typeof params !== 'object') return {};
    
    const normalized = {};
    
    // Remove campos que não devem afetar o cache
    const excludeFields = ['timestamp', 'generatedAt', 'id', 'userId', 'groupId'];
    
    Object.keys(params)
      .filter(key => !excludeFields.includes(key))
      .sort()
      .forEach(key => {
        if (typeof params[key] === 'string') {
          // Normaliza strings removendo espaços extras e convertendo para lowercase
          normalized[key] = params[key].trim().toLowerCase();
        } else {
          normalized[key] = params[key];
        }
      });
    
    return normalized;
  }

  /**
   * Verifica se um item do cache ainda é válido
   */
  isValidCacheItem(item) {
    if (!item || !item.expiresAt) return false;
    return Date.now() < item.expiresAt;
  }

  /**
   * Busca item no cache (memória primeiro, depois disco)
   */
  async get(operation, params) {
    const cacheKey = this.generateCacheKey(operation, params);
    
    try {
      // Verifica cache em memória primeiro
      if (this.memoryCache.has(cacheKey)) {
        const item = this.memoryCache.get(cacheKey);
        
        if (this.isValidCacheItem(item)) {
          logger.info(`Cache hit (memória): ${operation}`, {
            cacheKey: cacheKey.substring(0, 8),
            operation,
            source: 'memory'
          });
          
          return {
            ...item.data,
            cached: true,
            cacheSource: 'memory',
            cachedAt: item.cachedAt
          };
        } else {
          // Remove item expirado da memória
          this.memoryCache.delete(cacheKey);
        }
      }
      
      // Verifica cache em disco
      const diskItem = await this.getFromDisk(cacheKey);
      if (diskItem && this.isValidCacheItem(diskItem)) {
        // Adiciona de volta à memória
        this.addToMemoryCache(cacheKey, diskItem);
        
        logger.info(`Cache hit (disco): ${operation}`, {
          cacheKey: cacheKey.substring(0, 8),
          operation,
          source: 'disk'
        });
        
        return {
          ...diskItem.data,
          cached: true,
          cacheSource: 'disk',
          cachedAt: diskItem.cachedAt
        };
      }
      
      logger.info(`Cache miss: ${operation}`, {
        cacheKey: cacheKey.substring(0, 8),
        operation
      });
      
      return null;
    } catch (error) {
      logger.error('Erro ao buscar no cache', error, {
        operation,
        cacheKey: cacheKey.substring(0, 8)
      });
      return null;
    }
  }

  /**
   * Armazena item no cache
   */
  async set(operation, params, data, ttl = null) {
    const cacheKey = this.generateCacheKey(operation, params);
    const expiresAt = Date.now() + (ttl || this.getTTLForOperation(operation));
    
    const cacheItem = {
      data,
      cachedAt: new Date().toISOString(),
      expiresAt,
      operation,
      params: this.normalizeParams(params)
    };
    
    try {
      // Adiciona à memória
      this.addToMemoryCache(cacheKey, cacheItem);
      
      // Salva no disco
      await this.saveToDisk(cacheKey, cacheItem);
      
      logger.info(`Item adicionado ao cache: ${operation}`, {
        cacheKey: cacheKey.substring(0, 8),
        operation,
        ttl: ttl || this.getTTLForOperation(operation),
        dataSize: JSON.stringify(data).length
      });
      
    } catch (error) {
      logger.error('Erro ao salvar no cache', error, {
        operation,
        cacheKey: cacheKey.substring(0, 8)
      });
    }
  }

  /**
   * Define TTL específico para cada tipo de operação
   */
  getTTLForOperation(operation) {
    const ttlMap = {
      'generateGroupPost': 2 * 60 * 60 * 1000,      // 2 horas
      'generatePersonalizedDM': 4 * 60 * 60 * 1000,  // 4 horas
      'generateAttractiveBio': 24 * 60 * 60 * 1000,  // 24 horas
      'generateCampaignContent': 6 * 60 * 60 * 1000,  // 6 horas
      'testConnection': 5 * 60 * 1000                 // 5 minutos
    };
    
    return ttlMap[operation] || this.defaultTTL;
  }

  /**
   * Adiciona item ao cache em memória
   */
  addToMemoryCache(cacheKey, item) {
    // Remove itens mais antigos se necessário
    if (this.memoryCache.size >= this.maxMemoryItems) {
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
    }
    
    this.memoryCache.set(cacheKey, item);
  }

  /**
   * Busca item no cache em disco
   */
  async getFromDisk(cacheKey) {
    // Se cache em disco não está disponível, retorna null
    if (!this.cacheDir) return null;
    
    const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
    
    try {
      if (!fs.existsSync(filePath)) return null;
      
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.warn('Erro ao ler cache do disco', {
        cacheKey: cacheKey.substring(0, 8),
        error: error.message
      });
      return null;
    }
  }

  /**
   * Salva item no cache em disco
   */
  async saveToDisk(cacheKey, item) {
    // Se cache em disco não está disponível, não faz nada
    if (!this.cacheDir) return;
    
    const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
    
    try {
      fs.writeFileSync(filePath, JSON.stringify(item, null, 2));
    } catch (error) {
      logger.error('Erro ao salvar cache no disco', error, {
        cacheKey: cacheKey.substring(0, 8)
      });
    }
  }

  /**
   * Carrega itens válidos do disco para a memória
   */
  loadMemoryCache() {
    try {
      // Se cache em disco não está disponível, não carrega nada
      if (!this.cacheDir || !fs.existsSync(this.cacheDir)) return;
      
      const files = fs.readdirSync(this.cacheDir)
        .filter(file => file.endsWith('.json'))
        .slice(0, this.maxMemoryItems); // Limita quantidade
      
      let loadedCount = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(this.cacheDir, file);
          const data = fs.readFileSync(filePath, 'utf8');
          const item = JSON.parse(data);
          
          if (this.isValidCacheItem(item)) {
            const cacheKey = file.replace('.json', '');
            this.memoryCache.set(cacheKey, item);
            loadedCount++;
          }
        } catch (error) {
          logger.warn(`Erro ao carregar cache: ${file}`, {
            error: error.message
          });
        }
      }
      
      logger.info(`Cache carregado na memória`, {
        itemsLoaded: loadedCount,
        totalFiles: files.length
      });
      
    } catch (error) {
      logger.error('Erro ao carregar cache na memória', error);
    }
  }

  /**
   * Remove itens expirados do cache
   */
  cleanExpiredCache() {
    const startTime = Date.now();
    let memoryCleanedCount = 0;
    let diskCleanedCount = 0;
    
    try {
      // Limpa cache em memória
      for (const [key, item] of this.memoryCache.entries()) {
        if (!this.isValidCacheItem(item)) {
          this.memoryCache.delete(key);
          memoryCleanedCount++;
        }
      }
      
      // Limpa cache em disco
      if (this.cacheDir && fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir)
          .filter(file => file.endsWith('.json'));
        
        for (const file of files) {
          try {
            const filePath = path.join(this.cacheDir, file);
            const data = fs.readFileSync(filePath, 'utf8');
            const item = JSON.parse(data);
            
            if (!this.isValidCacheItem(item)) {
              fs.unlinkSync(filePath);
              diskCleanedCount++;
            }
          } catch (error) {
            // Remove arquivos corrompidos
            const filePath = path.join(this.cacheDir, file);
            fs.unlinkSync(filePath);
            diskCleanedCount++;
          }
        }
      }
      
      const duration = Date.now() - startTime;
      
      if (memoryCleanedCount > 0 || diskCleanedCount > 0) {
        logger.info('Limpeza de cache concluída', {
          memoryItemsCleaned: memoryCleanedCount,
          diskItemsCleaned: diskCleanedCount,
          duration,
          remainingMemoryItems: this.memoryCache.size
        });
      }
      
    } catch (error) {
      logger.error('Erro durante limpeza de cache', error);
    }
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats() {
    try {
      const memorySize = this.memoryCache.size;
      let diskSize = 0;
      let totalDiskSizeBytes = 0;
      
      if (this.cacheDir && fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir)
          .filter(file => file.endsWith('.json'));
        
        diskSize = files.length;
        
        for (const file of files) {
          const filePath = path.join(this.cacheDir, file);
          const stats = fs.statSync(filePath);
          totalDiskSizeBytes += stats.size;
        }
      }
      
      return {
        memory: {
          items: memorySize,
          maxItems: this.maxMemoryItems,
          usage: `${((memorySize / this.maxMemoryItems) * 100).toFixed(1)}%`
        },
        disk: {
          items: diskSize,
          sizeBytes: totalDiskSizeBytes,
          sizeMB: (totalDiskSizeBytes / 1024 / 1024).toFixed(2)
        },
        ttl: {
          default: this.defaultTTL,
          operations: {
            generateGroupPost: '2h',
            generatePersonalizedDM: '4h',
            generateAttractiveBio: '24h',
            generateCampaignContent: '6h',
            testConnection: '5min'
          }
        }
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas do cache', error);
      return { error: error.message };
    }
  }

  /**
   * Limpa todo o cache
   */
  clear() {
    try {
      // Limpa memória
      this.memoryCache.clear();
      
      // Limpa disco
      if (this.cacheDir && fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir)
          .filter(file => file.endsWith('.json'));
        
        for (const file of files) {
          const filePath = path.join(this.cacheDir, file);
          fs.unlinkSync(filePath);
        }
      }
      
      logger.info('Cache limpo completamente');
      return true;
    } catch (error) {
      logger.error('Erro ao limpar cache', error);
      return false;
    }
  }
}

// Singleton instance
const geminiCache = new GeminiCache();

module.exports = geminiCache;