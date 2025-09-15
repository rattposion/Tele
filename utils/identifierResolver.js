/**
 * Utilitário para resolver identificadores de usuários e grupos do Telegram
 * Suporta:
 * - @username para usuários
 * - @groupname para grupos
 * - https://t.me/groupname para grupos
 * - IDs numéricos diretos
 */

class IdentifierResolver {
  constructor(bot) {
    this.bot = bot;
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutos
  }

  /**
   * Resolve um identificador de usuário
   * @param {string} identifier - @username, ID numérico ou nome
   * @returns {Promise<Object|null>} Informações do usuário ou null
   */
  async resolveUser(identifier) {
    try {
      // Remove @ se presente
      const cleanIdentifier = identifier.replace(/^@/, '');
      
      // Verifica cache primeiro
      const cacheKey = `user_${cleanIdentifier}`;
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.data;
        }
      }

      let userInfo = null;

      // Se é um ID numérico
      if (/^\d+$/.test(cleanIdentifier)) {
        try {
          const chat = await this.bot.getChat(cleanIdentifier);
          if (chat.type === 'private') {
            userInfo = {
              id: chat.id,
              username: chat.username,
              first_name: chat.first_name,
              last_name: chat.last_name,
              type: 'user'
            };
          }
        } catch (error) {
          console.warn(`⚠️ Usuário ${cleanIdentifier} não encontrado por ID`);
        }
      } else {
        // Tenta resolver por username
        try {
          const chat = await this.bot.getChat(`@${cleanIdentifier}`);
          if (chat.type === 'private') {
            userInfo = {
              id: chat.id,
              username: chat.username,
              first_name: chat.first_name,
              last_name: chat.last_name,
              type: 'user'
            };
          }
        } catch (error) {
          console.warn(`⚠️ Usuário @${cleanIdentifier} não encontrado`);
        }
      }

      // Salva no cache
      if (userInfo) {
        this.cache.set(cacheKey, {
          data: userInfo,
          timestamp: Date.now()
        });
      }

      return userInfo;
    } catch (error) {
      console.error('❌ Erro ao resolver usuário:', error.message);
      return null;
    }
  }

  /**
   * Resolve um identificador de grupo
   * @param {string} identifier - @groupname, https://t.me/groupname, ID numérico
   * @returns {Promise<Object|null>} Informações do grupo ou null
   */
  async resolveGroup(identifier) {
    try {
      let cleanIdentifier = identifier;

      // Remove prefixos de link
      if (identifier.includes('t.me/')) {
        cleanIdentifier = identifier.split('t.me/')[1].split('?')[0];
      }
      
      // Remove @ se presente
      cleanIdentifier = cleanIdentifier.replace(/^@/, '');
      
      // Verifica cache primeiro
      const cacheKey = `group_${cleanIdentifier}`;
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.data;
        }
      }

      let groupInfo = null;

      // Se é um ID numérico (pode ser negativo para grupos)
      if (/^-?\d+$/.test(cleanIdentifier)) {
        try {
          const chat = await this.bot.getChat(cleanIdentifier);
          if (['group', 'supergroup', 'channel'].includes(chat.type)) {
            groupInfo = {
              id: chat.id,
              title: chat.title,
              username: chat.username,
              type: chat.type,
              member_count: await this.getMemberCount(chat.id)
            };
          }
        } catch (error) {
          console.warn(`⚠️ Grupo ${cleanIdentifier} não encontrado por ID`);
        }
      } else {
        // Tenta resolver por username
        try {
          const chat = await this.bot.getChat(`@${cleanIdentifier}`);
          if (['group', 'supergroup', 'channel'].includes(chat.type)) {
            groupInfo = {
              id: chat.id,
              title: chat.title,
              username: chat.username,
              type: chat.type,
              member_count: await this.getMemberCount(chat.id)
            };
          }
        } catch (error) {
          console.warn(`⚠️ Grupo @${cleanIdentifier} não encontrado`);
        }
      }

      // Salva no cache
      if (groupInfo) {
        this.cache.set(cacheKey, {
          data: groupInfo,
          timestamp: Date.now()
        });
      }

      return groupInfo;
    } catch (error) {
      console.error('❌ Erro ao resolver grupo:', error.message);
      return null;
    }
  }

  /**
   * Obtém o número de membros de um grupo
   * @param {string|number} chatId - ID do chat
   * @returns {Promise<number>} Número de membros
   */
  async getMemberCount(chatId) {
    try {
      const count = await this.bot.getChatMemberCount(chatId);
      return count;
    } catch (error) {
      console.warn(`⚠️ Não foi possível obter contagem de membros para ${chatId}`);
      return 0;
    }
  }

  /**
   * Valida se um identificador é válido
   * @param {string} identifier - Identificador a ser validado
   * @param {string} type - 'user' ou 'group'
   * @returns {boolean} Se é válido
   */
  isValidIdentifier(identifier, type = 'any') {
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }

    const cleanIdentifier = identifier.replace(/^@/, '').replace(/^https:\/\/t\.me\//, '');

    // ID numérico
    if (/^-?\d+$/.test(cleanIdentifier)) {
      return true;
    }

    // Username válido (5-32 caracteres, apenas letras, números e underscore)
    if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(cleanIdentifier)) {
      return true;
    }

    // Link do Telegram
    if (identifier.includes('t.me/') && type !== 'user') {
      return true;
    }

    return false;
  }

  /**
   * Formata um identificador para exibição
   * @param {Object} resolvedInfo - Informações resolvidas
   * @returns {string} Identificador formatado
   */
  formatIdentifier(resolvedInfo) {
    if (!resolvedInfo) {
      return 'Desconhecido';
    }

    if (resolvedInfo.type === 'user') {
      const name = resolvedInfo.first_name || 'Usuário';
      const username = resolvedInfo.username ? `@${resolvedInfo.username}` : `ID: ${resolvedInfo.id}`;
      return `${name} (${username})`;
    } else {
      const title = resolvedInfo.title || 'Grupo';
      const username = resolvedInfo.username ? `@${resolvedInfo.username}` : `ID: ${resolvedInfo.id}`;
      return `${title} (${username})`;
    }
  }

  /**
   * Limpa o cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Cache de identificadores limpo');
  }

  /**
   * Obtém estatísticas do cache
   * @returns {Object} Estatísticas
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp < this.cacheExpiry) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      total: this.cache.size,
      valid: validEntries,
      expired: expiredEntries
    };
  }
}

module.exports = IdentifierResolver;