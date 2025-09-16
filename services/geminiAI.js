const { GoogleGenerativeAI } = require('@google/generative-ai');
const database = require('../db');
const logger = require('../utils/logger');
const geminiCache = require('../utils/geminiCache');

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
    const startTime = Date.now();
    const cacheParams = { theme, targetAudience };
    
    try {
      // Verifica cache primeiro
      const cachedContent = await geminiCache.get('generateGroupPost', cacheParams);
      if (cachedContent) {
        logger.performance('generateGroupPost_cache_hit', Date.now() - startTime, {
          theme,
          targetAudience,
          cacheSource: cachedContent.cacheSource
        });
        return cachedContent;
      }
      
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

      logger.geminiApiCall('generateGroupPost', prompt, {
        theme,
        targetAudience,
        promptLength: prompt.length
      });

      const result = await this.executeWithRetry(async () => {
        return await this.model.generateContent(prompt);
      }, 'generateGroupPost');
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
      
      const finalContent = {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'group_post'
      };
      
      // Salva no cache
      await geminiCache.set('generateGroupPost', cacheParams, finalContent);
      
      const duration = Date.now() - startTime;
      logger.performance('generateGroupPost', duration, {
        theme,
        targetAudience,
        contentLength: JSON.stringify(content).length
      });
      
      return finalContent;
      
    } catch (error) {
      logger.geminiApiFallback('generateGroupPost', error.message, {
        theme,
        targetAudience,
        duration: Date.now() - startTime
      });
      
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
    const startTime = Date.now();
    const userName = user.first_name || user.username || 'amigo(a)';
    const cacheParams = { 
      campaignType, 
      userStatus: user.status || 'novo',
      userType: user.is_premium ? 'premium' : 'regular'
    };
    
    try {
      // Verifica cache primeiro
      const cachedContent = await geminiCache.get('generatePersonalizedDM', cacheParams);
      if (cachedContent) {
        // Personaliza o nome do usuário no conteúdo cacheado
        const personalizedContent = {
          ...cachedContent,
          message: cachedContent.message.replace(/amigo\(a\)|querido\(a\)|amor/gi, userName),
          userName,
          userId: user.telegram_id,
          cached: true
        };
        
        logger.performance('generatePersonalizedDM_cache_hit', Date.now() - startTime, {
          userId: user.telegram_id,
          campaignType,
          cacheSource: cachedContent.cacheSource
        });
        
        return personalizedContent;
      }
      
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

      logger.geminiApiCall('generatePersonalizedDM', prompt, {
        userId: user.telegram_id,
        userName,
        campaignType,
        userStatus: user.status
      });

      const result = await this.executeWithRetry(async () => {
        return await this.model.generateContent(prompt);
      }, 'generatePersonalizedDM');
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
      
      const finalContent = {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'dm_message',
        userId: user.telegram_id
      };
      
      // Salva no cache (sem o nome personalizado para reutilização)
      const cacheableContent = {
        ...content,
        campaignType,
        generatedAt: new Date().toISOString(),
        type: 'dm_message'
      };
      await geminiCache.set('generatePersonalizedDM', cacheParams, cacheableContent);
      
      const duration = Date.now() - startTime;
      logger.performance('generatePersonalizedDM', duration, {
        userId: user.telegram_id,
        campaignType,
        contentLength: JSON.stringify(content).length
      });
      
      return finalContent;
      
    } catch (error) {
      logger.geminiApiFallback('generatePersonalizedDM', error.message, {
        userId: user.telegram_id,
        campaignType,
        duration: Date.now() - startTime
      });
      
      // Fallback
      return this.getFallbackDMContent(user);
    }
  }

  /**
   * Gera bio/descrição atraente
   * @param {string} purpose - Propósito da bio
   * @param {string} platform - Plataforma de destino
   * @param {string} style - Estilo da bio
   * @returns {Object} Bio gerada
   */
  async generateAttractiveBio(purpose = 'perfil premium', platform = 'telegram', style = 'seductive') {
    const startTime = Date.now();
    const cacheParams = { purpose, platform, style };
    
    try {
      // Verifica cache primeiro
      const cachedContent = await geminiCache.get('generateAttractiveBio', cacheParams);
      if (cachedContent) {
        logger.performance('generateAttractiveBio_cache_hit', Date.now() - startTime, {
          purpose,
          platform,
          style,
          cacheSource: cachedContent.cacheSource
        });
        return cachedContent;
      }
      
      const prompt = `
Crie uma biografia atrativa e provocante para perfil de criadora de conteúdo adulto.

Propósito: ${purpose}
Plataforma: ${platform}
Estilo: ${style}

Diretrizes:
- Tom sedutor e misterioso
- Use emojis estratégicos
- Crie curiosidade
- Inclua call-to-action sutil
- Máximo 150 caracteres para ${platform}
- Foque em exclusividade
- Adapte ao estilo ${style}

Formato de resposta JSON:
{
  "bio": "biografia completa",
  "mood": "descrição do tom",
  "appeal": "principal atrativo"
}

Gere bio única:`;

      logger.geminiApiCall('generateAttractiveBio', prompt, {
        purpose,
        platform,
        style,
        promptLength: prompt.length
      });

      const result = await this.executeWithRetry(async () => {
        return await this.model.generateContent(prompt);
      }, 'generateAttractiveBio');
      const response = await result.response;
      const text = response.text();
      
      // Parse do JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Resposta não contém JSON válido');
      }
      
      const content = JSON.parse(jsonMatch[0]);
      
      const finalContent = {
        ...content,
        purpose,
        platform,
        style,
        generatedAt: new Date().toISOString(),
        type: 'bio'
      };
      
      // Salva no cache
      await geminiCache.set('generateAttractiveBio', cacheParams, finalContent);
      
      const duration = Date.now() - startTime;
      logger.performance('generateAttractiveBio', duration, {
        purpose,
        platform,
        style,
        contentLength: JSON.stringify(content).length
      });
      
      return finalContent;
      
    } catch (error) {
      logger.geminiApiFallback('generateAttractiveBio', error.message, {
        purpose,
        platform,
        style,
        duration: Date.now() - startTime
      });
      return this.getFallbackBio(platform, style);
    }
  }

  /**
   * Gera conteúdo para campanha específica
   * @param {string} campaignName - Nome da campanha
   * @param {Object} params - Parâmetros da campanha
   * @returns {Object} Conteúdo da campanha
   */
  async generateCampaignContent(campaignName, params = {}) {
    const startTime = Date.now();
    const cacheParams = { campaignName, params };
    
    try {
      // Verifica cache primeiro
      const cachedContent = await geminiCache.get('generateCampaignContent', cacheParams);
      if (cachedContent) {
        logger.performance('generateCampaignContent_cache_hit', Date.now() - startTime, {
          campaignName,
          paramsCount: Object.keys(params).length,
          cacheSource: cachedContent.cacheSource
        });
        return cachedContent;
      }
      
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

      logger.geminiApiCall('generateCampaignContent', prompt, {
        campaignName,
        paramsCount: Object.keys(params).length,
        promptLength: prompt.length
      });

      const result = await this.executeWithRetry(async () => {
        return await this.model.generateContent(prompt);
      }, 'generateCampaignContent');
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
      
      const finalContent = {
        ...content,
        generatedAt: new Date().toISOString(),
        type: 'campaign',
        name: campaignName
      };
      
      // Salva no cache
      await geminiCache.set('generateCampaignContent', cacheParams, finalContent);
      
      const duration = Date.now() - startTime;
      logger.performance('generateCampaignContent', duration, {
        campaignName,
        paramsCount: Object.keys(params).length,
        contentLength: JSON.stringify(content).length
      });
      
      return finalContent;
      
    } catch (error) {
      logger.geminiApiFallback('generateCampaignContent', error.message, {
        campaignName,
        duration: Date.now() - startTime
      });
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
  
  getFallbackGroupContent(theme = 'assinatura premium', targetAudience = 'adultos') {
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Conteúdo baseado no horário
    const timeBasedContent = {
      morning: [
        {
          title: "🌅 Bom Dia Premium +18!",
          description: "☀️ Comece o dia com conteúdo adulto exclusivo! Acesso VIP disponível! 🔥💋",
          callToAction: "📩 Chame agora para despertar seus sentidos!",
          hashtags: ["#BomDia18", "#Premium", "#ConteudoMatinal"]
        },
        {
          title: "☕ Manhã Sensual Premium!",
          description: "🌞 Café da manhã especial com conteúdo adulto provocante! Experiência única! 💎🔞",
          callToAction: "💬 DM para acesso matinal exclusivo!",
          hashtags: ["#ManhaSensual", "#Premium18", "#AssinaturaVIP"]
        }
      ],
      afternoon: [
        {
          title: "🌤️ Tarde Quente Premium +18!",
          description: "⏰ Pausa especial com conteúdo adulto provocante! Esquente sua tarde! 🔥💋",
          callToAction: "📩 Chame para uma tarde inesquecível!",
          hashtags: ["#TardeQuente", "#Premium18", "#ConteudoExclusivo"]
        },
        {
          title: "🌆 Afternoon Premium Sensual!",
          description: "💫 Tarde perfeita para conteúdo adulto exclusivo! Prazer garantido! 🔞💎",
          callToAction: "💬 DM para acesso VIP da tarde!",
          hashtags: ["#TardeSensual", "#Premium", "#AssinaturaVIP"]
        }
      ],
      evening: [
        {
          title: "🌙 Noite Íntima Premium +18!",
          description: "🌃 Termine o dia com conteúdo adulto sedutor! Noite especial te aguarda! 💋🔥",
          callToAction: "📩 Chame para uma noite provocante!",
          hashtags: ["#NoiteIntima", "#Premium18", "#ConteudoNoturno"]
        },
        {
          title: "✨ Evening Premium Sensual!",
          description: "🌟 Noite perfeita para experiências adultas únicas! Acesso VIP disponível! 🔞💎",
          callToAction: "💬 DM para noite inesquecível!",
          hashtags: ["#NoiteSensual", "#Premium", "#AssinaturaVIP"]
        }
      ]
    };
    
    // Conteúdo especial para fim de semana
    const weekendContent = [
      {
        title: "🎉 Weekend Premium +18!",
        description: "🏖️ Fim de semana especial com conteúdo adulto exclusivo! Desconto VIP! 💸🔥",
        callToAction: "📩 Aproveite a oferta de weekend!",
        hashtags: ["#WeekendPremium", "#Desconto18", "#OfertaVIP"]
      },
      {
        title: "🥳 Final de Semana Sensual!",
        description: "🎊 Weekend perfeito para conteúdo adulto provocante! Acesso premium liberado! 💋🔞",
        callToAction: "💬 DM para weekend inesquecível!",
        hashtags: ["#WeekendSensual", "#Premium18", "#FinalDeSemana"]
      }
    ];
    
    let selectedContent;
    
    // Prioriza conteúdo de fim de semana
    if (isWeekend && Math.random() < 0.4) {
      selectedContent = weekendContent;
    } else {
      // Seleciona baseado no horário
      if (currentHour >= 6 && currentHour < 12) {
        selectedContent = timeBasedContent.morning;
      } else if (currentHour >= 12 && currentHour < 18) {
        selectedContent = timeBasedContent.afternoon;
      } else {
        selectedContent = timeBasedContent.evening;
      }
    }
    
    const random = selectedContent[Math.floor(Math.random() * selectedContent.length)];
    
    console.log(`📋 Usando fallback dinâmico: tema=${theme}, público=${targetAudience}, horário=${currentHour}h, weekend=${isWeekend}`);
    
    return {
      ...random,
      generatedAt: new Date().toISOString(),
      type: 'group_post',
      fallback: true,
      timeContext: {
        hour: currentHour,
        isWeekend: isWeekend,
        theme: theme,
        audience: targetAudience
      }
    };
  }
  
  getFallbackDMContent(user, campaignType = 'subscription') {
    const userName = user.first_name || user.username || 'querido(a)';
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Templates baseados no tipo de campanha
    const campaignTemplates = {
      subscription: {
        morning: [
          `Bom dia ${userName}! ☀️ Que tal começar o dia com conteúdo premium exclusivo? Acesso VIP disponível! 💎🔥`,
          `Oi ${userName}! 🌅 Manhã perfeita para descobrir nossa assinatura premium! Conteúdo adulto único! 💋✨`
        ],
        afternoon: [
          `Oi ${userName}! 🌤️ Pausa especial com nossa assinatura premium! Conteúdo provocante te aguarda! 🔥💎`,
          `${userName}, que tal uma tarde especial? Assinatura VIP com conteúdo exclusivo! 💋🌟`
        ],
        evening: [
          `Boa noite ${userName}! 🌙 Termine o dia com nossa assinatura premium! Conteúdo íntimo disponível! 💋🔥`,
          `${userName}, noite perfeita para conteúdo adulto exclusivo! Assinatura VIP liberada! 🌟💎`
        ]
      },
      promotion: {
        morning: [
          `${userName}! 🎉 Promoção matinal especial! Desconto na assinatura premium! Aproveite! 💸🔥`,
          `Bom dia ${userName}! ☀️ Oferta única: 50% OFF na assinatura premium! Conteúdo adulto exclusivo! 💋💎`
        ],
        afternoon: [
          `${userName}! 🚨 Promoção relâmpago! Assinatura premium com desconto! Últimas vagas! 💸⚡`,
          `Oi ${userName}! 🎯 Oferta especial da tarde! Acesso VIP com preço promocional! 🔥💎`
        ],
        evening: [
          `${userName}! 🌙 Última chance! Promoção noturna da assinatura premium! Não perca! 💸🔥`,
          `Boa noite ${userName}! ✨ Oferta especial: assinatura VIP com desconto! Conteúdo exclusivo! 💋💎`
        ]
      },
      retention: [
        `${userName}, sentimos sua falta! 💔 Que tal voltar com nossa assinatura premium? Conteúdo novo te aguarda! 🔥💎`,
        `Oi ${userName}! 🌟 Oferta especial de retorno! Assinatura premium com benefícios únicos! 💋✨`,
        `${userName}, volta para nós! 💫 Assinatura VIP com conteúdo ainda mais provocante! 🔥💎`
      ]
    };
    
    // Templates especiais para fim de semana
    const weekendTemplates = [
      `${userName}! 🎉 Weekend especial! Assinatura premium com desconto de fim de semana! 💸🔥`,
      `Oi ${userName}! 🏖️ Final de semana perfeito para conteúdo premium! Oferta VIP disponível! 💋💎`,
      `${userName}! 🥳 Weekend sensual! Assinatura premium liberada com preço especial! 🔥✨`
    ];
    
    let selectedTemplates;
    
    // Prioriza templates de fim de semana
    if (isWeekend && Math.random() < 0.3) {
      selectedTemplates = weekendTemplates;
    } else if (campaignType === 'retention') {
      selectedTemplates = campaignTemplates.retention;
    } else {
      const timeOfDay = currentHour >= 6 && currentHour < 12 ? 'morning' :
                       currentHour >= 12 && currentHour < 18 ? 'afternoon' : 'evening';
      
      selectedTemplates = campaignTemplates[campaignType]?.[timeOfDay] || campaignTemplates.subscription[timeOfDay];
    }
    
    const randomTemplate = selectedTemplates[Math.floor(Math.random() * selectedTemplates.length)];
    
    console.log(`📩 Usando DM fallback: usuário=${userName}, campanha=${campaignType}, horário=${currentHour}h, weekend=${isWeekend}`);
    
    return {
      message: randomTemplate,
      offer: "Acesso VIP premium +18 com desconto exclusivo",
      urgency: "Oferta sensual válida por tempo limitado!",
      generatedAt: new Date().toISOString(),
      type: 'dm_message',
      fallback: true,
      context: {
        userName,
        campaignType,
        hour: currentHour,
        isWeekend,
        timeOfDay: currentHour >= 6 && currentHour < 12 ? 'morning' :
                  currentHour >= 12 && currentHour < 18 ? 'afternoon' : 'evening'
      }
    };
  }
  
  getFallbackBio(platform = 'telegram', style = 'seductive') {
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Templates baseados no estilo
    const styleTemplates = {
      seductive: {
        short: [
          "🔥 Conteúdo adulto exclusivo | 💎 Acesso VIP | 🌟 +18 apenas",
          "💋 Experiência premium sensual | 🔞 Material íntimo | ✨ Assinatura VIP",
          "🌟 Criadora +18 | 💎 Conteúdo exclusivo | 🔥 Acesso premium"
        ],
        medium: [
          "🔥 Criadora de conteúdo adulto exclusivo 💎\n🌟 Experiência premium personalizada\n💋 Acesso VIP disponível | +18 apenas",
          "💫 Conteúdo íntimo e provocante 🔞\n🔥 Material exclusivo premium\n💎 Assinatura VIP | Experiência única",
          "🌟 Conteúdo adulto de alta qualidade 💋\n🔥 Acesso exclusivo premium\n💎 Experiência sensual personalizada"
        ],
        long: [
          "🔥 Criadora de conteúdo adulto premium 💎\n🌟 Experiência sensual personalizada\n💋 Material íntimo exclusivo\n🔞 Acesso VIP disponível\n✨ Assinatura com benefícios únicos",
          "💫 Conteúdo adulto de alta qualidade 🔥\n🌟 Experiência premium personalizada\n💎 Material exclusivo e provocante\n💋 Acesso VIP liberado\n🔞 Assinatura com desconto especial"
        ]
      },
      professional: {
        short: [
          "📸 Content Creator | 💎 Premium Access | 🔞 Adult Content",
          "🌟 Digital Creator | 🔥 Exclusive Material | 💋 VIP Subscription",
          "💎 Premium Creator | 🔞 Adult Content | ✨ Exclusive Access"
        ],
        medium: [
          "📸 Professional Content Creator 💎\n🔞 Premium Adult Material\n🌟 VIP Access Available | Exclusive Content",
          "💫 Digital Content Creator 🔥\n🔞 High-Quality Adult Content\n💎 Premium Subscription | Exclusive Access"
        ],
        long: [
          "📸 Professional Adult Content Creator 💎\n🌟 Premium Digital Experience\n🔞 High-Quality Exclusive Material\n💋 VIP Subscription Available\n✨ Personalized Content & Benefits"
        ]
      },
      playful: {
        short: [
          "😈 Travessa digital | 🔥 Conteúdo picante | 💎 Acesso VIP",
          "🥵 Criadora safadinha | 💋 Material quente | 🌟 Premium +18",
          "😏 Conteúdo provocante | 🔥 Experiência única | 💎 VIP access"
        ],
        medium: [
          "😈 Sua criadora favorita 🔥\n🥵 Conteúdo picante e exclusivo\n💎 Acesso VIP | Material provocante +18",
          "😏 Travessa digital premium 💋\n🔥 Conteúdo quente e personalizado\n🌟 Assinatura VIP | Experiência única"
        ],
        long: [
          "😈 Sua criadora safadinha favorita 🔥\n🥵 Conteúdo picante e exclusivo\n💋 Material provocante personalizado\n🌟 Acesso VIP premium\n💎 Experiência única e inesquecível"
        ]
      }
    };
    
    // Templates especiais para fim de semana
    const weekendTemplates = [
      "🎉 Weekend especial! 🔥 Conteúdo premium | 💎 Oferta VIP | 🌟 +18",
      "🏖️ Final de semana sensual | 💋 Material exclusivo | 🔥 Acesso premium",
      "🥳 Weekend provocante | 🔞 Conteúdo VIP | 💎 Experiência única"
    ];
    
    // Determina o tamanho da bio baseado na plataforma
    const bioSize = platform === 'instagram' ? 'short' : 
                   platform === 'twitter' ? 'short' :
                   platform === 'telegram' ? (Math.random() < 0.5 ? 'medium' : 'short') :
                   'medium';
    
    let selectedTemplate;
    
    // Prioriza templates de fim de semana
    if (isWeekend && Math.random() < 0.2) {
      selectedTemplate = weekendTemplates[Math.floor(Math.random() * weekendTemplates.length)];
    } else {
      const templates = styleTemplates[style]?.[bioSize] || styleTemplates.seductive[bioSize];
      selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
    }
    
    console.log(`📝 Usando bio fallback: plataforma=${platform}, estilo=${style}, tamanho=${bioSize}, weekend=${isWeekend}`);
    
    return {
      bio: selectedTemplate,
      mood: "misterioso e atraente",
      generatedAt: new Date().toISOString(),
      type: 'bio',
      fallback: true,
      context: {
        platform,
        style,
        bioSize,
        hour: currentHour,
        isWeekend,
        characterCount: selectedTemplate.length
      }
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
   * Retorna conteúdo fallback baseado na operação
   * @param {string} operationName - Nome da operação
   * @param {Array} args - Argumentos da operação original
   * @returns {Object} Conteúdo fallback
   */
  getFallbackContent(operationName, args) {
    switch (operationName) {
      case 'generateGroupPost':
        const [theme, targetAudience] = args[0] || ['assinatura premium', 'adultos'];
        return this.getFallbackGroupContent(theme, targetAudience);
      
      case 'generatePersonalizedDM':
        const [user, campaignType] = args[0] || [{}, 'subscription'];
        return this.getFallbackDMContent(user, campaignType);
      
      case 'generateAttractiveBio':
        const [purpose, platform, style] = args[0] || ['perfil premium', 'telegram', 'seductive'];
        return this.getFallbackBio(platform, style);
      
      case 'generateCampaignContent':
        const [campaignName] = args[0] || ['new_member'];
        return this.getFallbackCampaign(campaignName);
      
      case 'testConnection':
        return { success: false, fallbackMode: true, message: 'Usando modo fallback devido a limite de quota' };
      
      default:
        return this.getFallbackGroupContent('assinatura premium', 'adultos');
    }
  }

  /**
   * Método genérico para gerar conteúdo
   * @param {Object} params - Parâmetros para geração
   * @returns {Object} Conteúdo gerado
   */
  async generateContent(params = {}) {
    try {
      const startTime = Date.now();
      const { type = 'promotional', topic = 'conteúdo premium', style = 'engaging' } = params;
      
      const prompt = `
Gere um conteúdo ${type} sobre "${topic}" com estilo ${style}.
O conteúdo deve ser atrativo, profissional e adequado para marketing digital.
Responda apenas com o texto do conteúdo, sem explicações adicionais.`;
      
      const result = await this.executeWithRetry(async () => {
        return await this.model.generateContent(prompt);
      });
      
      const response = await result.response;
      const text = response.text();
      
      // Validação para evitar erro de split em texto undefined/null
      if (!text || typeof text !== 'string') {
        throw new Error('Texto gerado pela IA está vazio ou inválido');
      }
      
      const generationTime = Date.now() - startTime;
      const wordCount = text.trim().split(' ').filter(word => word.length > 0).length;
      
      return {
        text: text.trim(),
        type: type,
        wordCount: wordCount,
        generationTime: generationTime,
        quality: Math.min(10, Math.max(1, Math.floor(wordCount / 10)))
      };
      
    } catch (error) {
      console.error('Erro ao gerar conteúdo:', error);
      return {
        text: 'Conteúdo de exemplo gerado automaticamente.',
        type: params.type || 'promotional',
        wordCount: 5,
        generationTime: 0,
        quality: 5
      };
    }
  }

  /**
   * Executa uma operação com retry e backoff exponencial
   * @param {Function} operation - Função a ser executada
   * @param {string} operationName - Nome da operação para logs
   * @param {number} maxRetries - Número máximo de tentativas
   * @param {number} baseDelay - Delay base em ms
   * @returns {Promise} Resultado da operação
   */
  async executeWithRetry(operation, operationName = 'unknown', maxRetries = 3, baseDelay = 1000) {
    const startTime = Date.now();
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const operationStartTime = Date.now();
        const result = await operation();
        const operationDuration = Date.now() - operationStartTime;
        const totalDuration = Date.now() - startTime;
        
        logger.geminiApiSuccess(operationName, result?.length || 0, operationDuration, {
          attempt: attempt + 1,
          totalDuration,
          maxRetries: maxRetries + 1
        });
        
        if (attempt > 0) {
          logger.performance(`${operationName}_retry_success`, totalDuration, {
            attempts: attempt + 1,
            finalAttempt: attempt + 1
          });
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        const isRetryableError = error.status === 503 || error.status === 429;
        const isLastAttempt = attempt === maxRetries;
        
        logger.geminiApiError(operationName, error, attempt + 1, maxRetries + 1, {
          isRetryableError,
          isLastAttempt,
          totalDuration: Date.now() - startTime
        });
        
        // Se é erro de quota (429), ativa modo fallback imediatamente
        if (error.status === 429) {
          logger.warn(`⚠️ Gemini AI não conectado, usando conteúdo fallback`, {
            fallbackMode: true,
            impact: 'Conteúdo será gerado usando templates pré-definidos'
          });
          
          // Retorna conteúdo fallback baseado na operação
          return this.getFallbackContent(operationName, arguments);
        }
        
        // Se não é erro 503, não tenta novamente
        if (error.status !== 503) {
          logger.error(`❌ Erro no teste de conexão Gemini`, {
            operation: operationName,
            critical: true,
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
              status: error.status,
              statusText: error.statusText,
              errorDetails: error.errorDetails
            }
          });
          throw error;
        }
        
        // Se é a última tentativa, lança o erro
        if (isLastAttempt) {
          logger.error(`Falha definitiva na operação Gemini: ${operationName}`, {
            totalAttempts: attempt + 1,
            totalDuration: Date.now() - startTime,
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
              status: error.status,
              statusText: error.statusText,
              errorDetails: error.errorDetails
            }
          });
          throw error;
        }
        
        // Calcula delay com backoff exponencial + jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        
        logger.info(`Aguardando retry para ${operationName}`, {
          attempt: attempt + 1,
          delay: Math.round(delay),
          nextAttempt: attempt + 2,
          maxRetries: maxRetries + 1
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Testa a conexão com Gemini AI
   * @returns {boolean} Status da conexão
   */
  async testConnection() {
    try {
      logger.geminiApiCall('testConnection', 'Teste de conexão. Responda apenas: OK', { purpose: 'connection_test' });
      
      const result = await this.executeWithRetry(async () => {
        return await this.model.generateContent('Teste de conexão. Responda apenas: OK');
      }, 'testConnection', 2, 500); // 2 tentativas com delay menor para teste
      
      const response = await result.response;
      const text = response.text();
      
      logger.info('Conexão Gemini AI estabelecida com sucesso');
      return text.includes('OK');
    } catch (error) {
      logger.error('Erro no teste de conexão Gemini', error, {
        operation: 'testConnection',
        critical: true
      });
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