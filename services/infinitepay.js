const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class InfinitePayService {
  constructor() {
    this.apiKey = process.env.INFINITEPAY_API_KEY;
    this.secretKey = process.env.INFINITEPAY_SECRET_KEY;
    this.baseURL = process.env.INFINITEPAY_BASE_URL || 'https://api.infinitepay.io/v2';
    this.webhookSecret = process.env.INFINITEPAY_WEBHOOK_SECRET;
    
    if (!this.apiKey || !this.secretKey) {
      throw new Error('❌ Credenciais da InfinitePay não configuradas');
    }
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramSubscriptionBot/1.0'
      },
      timeout: 30000
    });
  }

  // Gera assinatura para webhook
  generateSignature(payload, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  // Verifica assinatura do webhook
  verifyWebhookSignature(payload, signature) {
    if (!this.webhookSecret) {
      console.warn('⚠️ Webhook secret não configurado');
      return true; // Em desenvolvimento, pode pular verificação
    }
    
    const expectedSignature = this.generateSignature(payload, this.webhookSecret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // Cria cobrança Pix
  async createPixCharge(chargeData) {
    try {
      const {
        amount,
        description,
        customerName,
        customerDocument,
        customerEmail,
        externalId,
        expiresIn = 86400 // 24 horas em segundos
      } = chargeData;

      // Validações básicas
      if (!amount || amount <= 0) {
        throw new Error('Valor da cobrança deve ser maior que zero');
      }

      if (!description) {
        throw new Error('Descrição da cobrança é obrigatória');
      }

      const payload = {
        amount: Math.round(amount), // Valor em centavos
        currency: 'BRL',
        description: description,
        external_id: externalId || uuidv4(),
        payment_method: 'pix',
        expires_in: expiresIn,
        customer: {
          name: customerName,
          document: customerDocument,
          email: customerEmail
        },
        notification_url: `${process.env.TELEGRAM_WEBHOOK_URL}/webhook/infinitepay`,
        return_url: null // Para bot do Telegram não precisamos de return_url
      };

      console.log('📤 Criando cobrança Pix:', {
        amount: payload.amount,
        description: payload.description,
        external_id: payload.external_id
      });

      const response = await this.client.post('/charges', payload);
      
      if (response.data && response.data.id) {
        console.log('✅ Cobrança Pix criada:', response.data.id);
        
        return {
          id: response.data.id,
          status: response.data.status,
          amount: response.data.amount,
          currency: response.data.currency,
          description: response.data.description,
          external_id: response.data.external_id,
          pix_code: response.data.pix?.qr_code || response.data.pix_code,
          qr_code_url: response.data.pix?.qr_code_url || response.data.qr_code_url,
          expires_at: response.data.expires_at,
          created_at: response.data.created_at
        };
      } else {
        throw new Error('Resposta inválida da API InfinitePay');
      }
    } catch (error) {
      console.error('❌ Erro ao criar cobrança Pix:', error.message);
      
      if (error.response) {
        console.error('Detalhes do erro:', {
          status: error.response.status,
          data: error.response.data
        });
        
        // Trata erros específicos da API
        if (error.response.status === 401) {
          throw new Error('Credenciais da InfinitePay inválidas');
        } else if (error.response.status === 400) {
          const errorMsg = error.response.data?.message || 'Dados da cobrança inválidos';
          throw new Error(`Erro na cobrança: ${errorMsg}`);
        } else if (error.response.status >= 500) {
          throw new Error('Erro interno da InfinitePay. Tente novamente.');
        }
      }
      
      throw error;
    }
  }

  // Consulta status de uma cobrança
  async getChargeStatus(chargeId) {
    try {
      console.log('🔍 Consultando status da cobrança:', chargeId);
      
      const response = await this.client.get(`/charges/${chargeId}`);
      
      if (response.data) {
        return {
          id: response.data.id,
          status: response.data.status,
          amount: response.data.amount,
          paid_at: response.data.paid_at,
          external_id: response.data.external_id
        };
      } else {
        throw new Error('Cobrança não encontrada');
      }
    } catch (error) {
      console.error('❌ Erro ao consultar cobrança:', error.message);
      
      if (error.response?.status === 404) {
        throw new Error('Cobrança não encontrada');
      }
      
      throw error;
    }
  }

  // Cancela uma cobrança
  async cancelCharge(chargeId) {
    try {
      console.log('❌ Cancelando cobrança:', chargeId);
      
      const response = await this.client.post(`/charges/${chargeId}/cancel`);
      
      return {
        id: response.data.id,
        status: response.data.status,
        cancelled_at: response.data.cancelled_at
      };
    } catch (error) {
      console.error('❌ Erro ao cancelar cobrança:', error.message);
      throw error;
    }
  }

  // Processa webhook da InfinitePay
  processWebhook(webhookData) {
    try {
      const { event, data } = webhookData;
      
      console.log('📥 Webhook recebido:', {
        event,
        charge_id: data?.id,
        status: data?.status
      });

      // Eventos suportados
      const supportedEvents = [
        'charge.paid',
        'charge.expired',
        'charge.cancelled',
        'charge.refunded'
      ];

      if (!supportedEvents.includes(event)) {
        console.log('ℹ️ Evento não processado:', event);
        return null;
      }

      return {
        event,
        charge_id: data.id,
        status: data.status,
        amount: data.amount,
        paid_at: data.paid_at,
        external_id: data.external_id,
        raw_data: data
      };
    } catch (error) {
      console.error('❌ Erro ao processar webhook:', error.message);
      throw error;
    }
  }

  // Formata valor para exibição
  formatCurrency(amountInCents) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amountInCents / 100);
  }

  // Gera dados para cobrança de assinatura
  generateSubscriptionCharge(user, subscriptionPrice) {
    const amount = parseInt(subscriptionPrice) || parseInt(process.env.SUBSCRIPTION_PRICE) || 4990;
    const description = process.env.SUBSCRIPTION_DESCRIPTION || 'Assinatura Premium';
    
    return {
      amount,
      description,
      customerName: user.first_name + (user.last_name ? ` ${user.last_name}` : ''),
      customerDocument: null, // Telegram não fornece CPF
      customerEmail: null, // Telegram não fornece email
      externalId: `subscription_${user.telegram_id}_${Date.now()}`
    };
  }

  // Testa conectividade com a API
  async testConnection() {
    try {
      console.log('🔄 Testando conexão com InfinitePay...');
      
      // Faz uma requisição simples para testar as credenciais
      const response = await this.client.get('/charges?limit=1');
      
      console.log('✅ Conexão com InfinitePay OK');
      return true;
    } catch (error) {
      console.error('❌ Erro na conexão com InfinitePay:', error.message);
      
      if (error.response?.status === 401) {
        console.error('🔑 Credenciais inválidas');
      }
      
      return false;
    }
  }
}

// Instância singleton
const infinitePayService = new InfinitePayService();

// Testa conexão se executado diretamente
if (require.main === module) {
  (async () => {
    try {
      await infinitePayService.testConnection();
      console.log('🚀 Serviço InfinitePay inicializado com sucesso!');
    } catch (error) {
      console.error('❌ Erro ao inicializar InfinitePay:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = infinitePayService;