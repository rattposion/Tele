const { GoogleGenerativeAI } = require('@google/generative-ai');
const database = require('../db');

class GeminiAIService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    this.lastGeneratedContent = new Map(); // Cache para evitar repetições
  }

  /**
   * Gera conteúdo para postagem em grupo
   * @param {string} theme - Tema da postagem (opcional)
   * @param {string} targetAudience - Público alvo
   * @returns {Object} Conteúdo gerado
   */
  async generateGroupPost(theme = 'assinatura premium', targetAudience = 'adultos') {
    try {
      const prompt = `
Você é um assistente de marketing especializado em conteúdo adulto +18 para Telegram. Gere um anúncio ÚNICO e chamativo para grupos de vendas de assinaturas premium de conteúdo adulto.

Requisitos:
1. Título provocante e impactante (máximo 50 caracteres)
2. Descrição sedutora e persuasiva (100-200 caracteres)
3. Emojis estratégicos para aumentar engajamento (🔥💋🔞💎)
4. Tom sensual, provocante mas elegante
5. Call-to-action irresistível
6. Conteúdo SEMPRE diferente e nunca repetitivo
7. Foco em exclusividade e conteúdo premium adulto

Tema: ${theme}
Público: ${targetAudience}

Formato de resposta (JSON):
{
  "title": "título aqui",
  "description": "descrição aqui",
  "callToAction": "ação aqui",
  "hashtags": ["#ConteudoExclusivo", "#Premium18", "#AssinaturaVIP"]
}

Gere conteúdo único e provocante:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Extrai JSON da resposta
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Formato de resposta inválido do Gemini');
      }
      
      const content = JSON.parse(jsonMatch[0]);
      
      // Verifica se o conteúdo não é repetitivo
      const contentHash = this.generateContentHash(content);
      if (this.lastGeneratedContent.has(contentHash)) {
        // Regenera se for muito similar
        return await this.generateGroupPost(theme + ' variação', targetAudience);
      }
      
      this.lastGeneratedContent.set(contentHash, Date.now());
      
      // Limpa cache antigo (mais de 24h)
      this.cleanOldCache();
      
      // Salva no banco para histórico
      await database.saveActionLog('ai_content_generated', 'group_post', null, {
        content,
        theme,
        targetAudience,
        timestamp: new Date().toISOString()
      });
      
      return {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'group_post'
      };
      
    } catch (error) {
      console.error('Erro ao gerar conteúdo para grupo:', error);
      
      // Fallback com conteúdo pré-definido
      return this.getFallbackGroupContent();
    }
  }

  /**
   * Gera mensagem personalizada para DM
   * @param {Object} user - Dados do usuário
   * @param {string} campaignType - Tipo de campanha
   * @returns {Object} Mensagem personalizada
   */
  async generatePersonalizedDM(user, campaignType = 'subscription') {
    try {
      const userName = user.first_name || user.username || 'amigo(a)';
      
      const prompt = `
Você é um assistente de marketing para mensagens privadas de conteúdo adulto +18 no Telegram. Gere uma mensagem DM personalizada, sedutora e persuasiva.

Dados do usuário:
- Nome: ${userName}
- Interagiu recentemente: ${user.last_interaction ? 'sim' : 'não'}
- Status: ${user.status || 'novo'}

Requisitos:
1. Mensagem personalizada com o nome do usuário
2. Tom sedutor, íntimo mas elegante
3. Oferta irresistível de conteúdo premium adulto
4. Emojis provocantes estratégicos (🔥💋🔞💎)
5. Call-to-action irresistível
6. Máximo 300 caracteres
7. Conteúdo único e não repetitivo
8. Foco em exclusividade e prazer

Tipo de campanha: ${campaignType}

Formato de resposta (JSON):
{
  "message": "mensagem sedutora personalizada aqui",
  "offer": "oferta especial exclusiva",
  "urgency": "elemento de urgência provocante"
}

Gere mensagem única e provocante:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Formato de resposta inválido do Gemini');
      }
      
      const content = JSON.parse(jsonMatch[0]);
      
      // Salva no banco
      await database.saveActionLog('ai_content_generated', 'dm_message', user.telegram_id, {
        content,
        campaignType,
        userName,
        timestamp: new Date().toISOString()
      });
      
      return {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'dm_message',
        userId: user.telegram_id
      };
      
    } catch (error) {
      console.error('Erro ao gerar DM personalizada:', error);
      
      // Fallback
      return this.getFallbackDMContent(user);
    }
  }

  /**
   * Gera bio/descrição atraente
   * @param {string} purpose - Propósito da bio
   * @returns {Object} Bio gerada
   */
  async generateAttractiveBio(purpose = 'perfil premium') {
    try {
      const prompt = `
Gere uma bio/descrição super atraente e chamativa para ${purpose}.

Requisitos:
1. Máximo 150 caracteres
2. Tom sexy e misterioso
3. Emojis estratégicos
4. Desperte curiosidade
5. Seja única e criativa

Formato JSON:
{
  "bio": "bio aqui",
  "mood": "humor/tom da bio"
}

Gere bio única:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Formato de resposta inválido');
      }
      
      const content = JSON.parse(jsonMatch[0]);
      
      return {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'bio'
      };
      
    } catch (error) {
      console.error('Erro ao gerar bio:', error);
      return this.getFallbackBio();
    }
  }

  /**
   * Gera conteúdo para campanha específica
   * @param {string} campaignName - Nome da campanha
   * @param {Object} params - Parâmetros da campanha
   * @returns {Object} Conteúdo da campanha
   */
  async generateCampaignContent(campaignName, params = {}) {
    try {
      const prompt = `
Gere conteúdo completo para a campanha "${campaignName}".

Parâmetros:
${JSON.stringify(params, null, 2)}

Gere:
1. Título da campanha
2. Mensagem principal
3. Mensagem para DM
4. Call-to-action
5. Hashtags relevantes

Formato JSON:
{
  "campaignTitle": "título",
  "mainMessage": "mensagem principal",
  "dmMessage": "mensagem DM",
  "callToAction": "CTA",
  "hashtags": ["tags"],
  "duration": "duração sugerida"
}

Gere conteúdo criativo:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Formato inválido');
      }
      
      const content = JSON.parse(jsonMatch[0]);
      
      // Salva campanha no banco
      await database.saveActionLog('campaign_generated', campaignName, null, {
        content,
        params,
        timestamp: new Date().toISOString()
      });
      
      return {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'campaign',
        name: campaignName
      };
      
    } catch (error) {
      console.error('Erro ao gerar campanha:', error);
      return this.getFallbackCampaign(campaignName);
    }
  }

  // === MÉTODOS AUXILIARES ===
  
  generateContentHash(content) {
    return Buffer.from(JSON.stringify(content)).toString('base64').slice(0, 16);
  }
  
  cleanOldCache() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [hash, timestamp] of this.lastGeneratedContent.entries()) {
      if (timestamp < oneDayAgo) {
        this.lastGeneratedContent.delete(hash);
      }
    }
  }
  
  getFallbackGroupContent() {
    const fallbacks = [
      {
        title: "🔥 Conteúdo Adulto Exclusivo +18!",
        description: "💋 Acesso VIP a conteúdos íntimos e provocantes. Experiência única para adultos! 🔞💎",
        callToAction: "📩 Chame no privado para acesso exclusivo!",
        hashtags: ["#ConteudoExclusivo", "#Premium18", "#AssinaturaVIP"]
      },
      {
        title: "💎 Assinatura Premium +18 Liberada!",
        description: "🌟 Conteúdo adulto personalizado e sedutor só para você. Prazer garantido! 🔥💋",
        callToAction: "💬 Mande DM para acesso imediato!",
        hashtags: ["#ConteudoExclusivo", "#Premium18", "#AssinaturaVIP"]
      }
    ];
    
    const random = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    return {
      ...random,
      generatedAt: new Date().toISOString(),
      type: 'group_post',
      fallback: true
    };
  }
  
  getFallbackDMContent(user) {
    const userName = user.first_name || user.username || 'querido(a)';
    return {
      message: `Oi ${userName}! 💋 Vi que você tem interesse em conteúdo adulto exclusivo. Tenho algo muito especial e provocante só para você! 🔥🔞`,
      offer: "Acesso VIP premium +18 com desconto exclusivo",
      urgency: "Oferta sensual válida por tempo limitado!",
      generatedAt: new Date().toISOString(),
      type: 'dm_message',
      fallback: true
    };
  }
  
  getFallbackBio() {
    const bios = [
      "🔞 Conteúdo adulto exclusivo e provocante 🔥 Acesso VIP +18 disponível 💎",
      "💋 Experiências íntimas únicas te esperando 💫 Venha se deliciar! 🔥",
      "💎 Premium adult content creator 🔞 Seu prazer vai mudar! 🌟💋"
    ];
    
    const random = bios[Math.floor(Math.random() * bios.length)];
    return {
      bio: random,
      mood: "misterioso e atraente",
      generatedAt: new Date().toISOString(),
      type: 'bio',
      fallback: true
    };
  }
  
  getFallbackCampaign(name) {
    return {
      campaignTitle: `Campanha ${name} - Oferta Especial`,
      mainMessage: "🔥 Oportunidade única! Conteúdo premium com acesso exclusivo. Não perca! ✨",
      dmMessage: "Oi! Tenho uma oferta especial que vai te interessar. Vamos conversar? 😊",
      callToAction: "📩 Chame no privado!",
      hashtags: ["#Oferta", "#Premium", "#Exclusivo"],
      duration: "7 dias",
      generatedAt: new Date().toISOString(),
      type: 'campaign',
      fallback: true
    };
  }

  /**
   * Testa a conexão com Gemini AI
   * @returns {boolean} Status da conexão
   */
  async testConnection() {
    try {
      const result = await this.model.generateContent('Teste de conexão. Responda apenas: OK');
      const response = await result.response;
      const text = response.text();
      
      return text.includes('OK');
    } catch (error) {
      console.error('Erro no teste de conexão Gemini:', error);
      return false;
    }
  }

  /**
   * Obtém estatísticas de uso da IA
   * @returns {Object} Estatísticas
   */
  async getUsageStats() {
    try {
      const logs = await database.all(`
        SELECT action_type, COUNT(*) as count, DATE(created_at) as date
        FROM action_logs 
        WHERE action_type LIKE 'ai_%' 
        AND created_at >= datetime('now', '-30 days')
        GROUP BY action_type, DATE(created_at)
        ORDER BY created_at DESC
      `);
      
      return {
        totalGenerations: logs.reduce((sum, log) => sum + log.count, 0),
        byType: logs.reduce((acc, log) => {
          acc[log.action_type] = (acc[log.action_type] || 0) + log.count;
          return acc;
        }, {}),
        dailyStats: logs,
        cacheSize: this.lastGeneratedContent.size
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas:', error);
      return { error: error.message };
    }
  }
}

module.exports = GeminiAIService;