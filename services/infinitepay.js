const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class InfinitePayService {
  constructor() {
    // Configuração para Links de Pagamento (não requer API)
    this.paymentLinkBase = process.env.INFINITEPAY_PAYMENT_LINK_BASE || 'https://pay.infinitepay.io';
    this.merchantId = process.env.INFINITEPAY_MERCHANT_ID || 'merchant_placeholder';
    
    console.log('💳 InfinitePay configurado para Links de Pagamento');
    console.log('ℹ️ Nota: APIs e webhooks não estão disponíveis no momento');
  }

  // Gera Link de Pagamento personalizado
  generatePaymentLink(chargeData) {
    const params = new URLSearchParams({
      merchant_id: this.merchantId,
      amount: chargeData.amount,
      currency: chargeData.currency || 'BRL',
      description: chargeData.description,
      external_id: chargeData.externalId || uuidv4(),
      customer_name: chargeData.customerName || '',
      return_url: chargeData.returnUrl || '',
      cancel_url: chargeData.cancelUrl || ''
    });
    
    return `${this.paymentLinkBase}?${params.toString()}`;
  }

  // Gera Link de Pagamento PIX
  generatePixPaymentLink(chargeData) {
    const params = new URLSearchParams({
      merchant_id: this.merchantId,
      payment_method: 'pix',
      amount: chargeData.amount,
      currency: chargeData.currency || 'BRL',
      description: chargeData.description,
      external_id: chargeData.externalId || uuidv4(),
      customer_name: chargeData.customerName || ''
    });
    
    return `${this.paymentLinkBase}/pix?${params.toString()}`;
  }

  // Cria Link de Pagamento PIX
  createPixCharge(chargeData) {
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

      console.log('💳 Gerando Link de Pagamento PIX...', {
        amount: amount,
        description: description,
        external_id: externalId || uuidv4()
      });

      const paymentLink = this.generatePixPaymentLink(chargeData);
      const chargeId = externalId || uuidv4();
      
      console.log('✅ Link de Pagamento PIX gerado:', chargeId);
      
      return {
        success: true,
        id: chargeId,
        status: 'pending',
        amount: amount,
        currency: 'BRL',
        description: description,
        external_id: chargeId,
        payment_url: paymentLink,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        created_at: new Date().toISOString(),
        message: 'Link de pagamento gerado. Cliente deve acessar o link para completar o pagamento.'
      };
    } catch (error) {
      console.error('❌ Erro ao gerar Link de Pagamento PIX:', error.message);
      
      return {
        success: false,
        error: error.message,
        details: 'Erro na geração do link de pagamento'
      };
    }
  }

  // Consulta status de uma cobrança (simulado - requer verificação manual)
  getChargeStatus(chargeId) {
    console.log(`🔍 Consultando status da cobrança: ${chargeId}`);
    console.log('ℹ️ Nota: Verificação de status requer consulta manual no painel da InfinitePay');
    
    return {
      id: chargeId,
      status: 'pending',
      message: 'Status deve ser verificado manualmente no painel da InfinitePay',
      manual_check_required: true,
      panel_url: 'https://dashboard.infinitepay.io'
    };
  }

  // Cancela uma cobrança (simulado - requer ação manual)
  cancelCharge(chargeId) {
    console.log(`❌ Solicitando cancelamento da cobrança: ${chargeId}`);
    console.log('ℹ️ Nota: Cancelamento requer ação manual no painel da InfinitePay');
    
    return {
      id: chargeId,
      status: 'cancel_requested',
      message: 'Cancelamento deve ser feito manualmente no painel da InfinitePay',
      manual_action_required: true,
      panel_url: 'https://dashboard.infinitepay.io'
    };
  }

  // Processa notificações manuais de pagamento
  processManualPaymentNotification(paymentData) {
    try {
      console.log('📨 Processando notificação manual de pagamento:', paymentData.chargeId);
      console.log('ℹ️ Nota: Webhooks automáticos não estão disponíveis no momento');
      
      const { chargeId, status, amount, externalId, paidAt } = paymentData;
      
      switch (status) {
        case 'paid':
          console.log('💰 Pagamento confirmado manualmente:', chargeId);
          return {
            type: 'payment_confirmed',
            chargeId: chargeId,
            amount: amount,
            externalId: externalId,
            paidAt: paidAt || new Date().toISOString(),
            manual_confirmation: true
          };
          
        case 'failed':
          console.log('❌ Pagamento falhou (confirmação manual):', chargeId);
          return {
            type: 'payment_failed',
            chargeId: chargeId,
            externalId: externalId,
            manual_confirmation: true
          };
          
        case 'expired':
          console.log('⏰ Pagamento expirou (confirmação manual):', chargeId);
          return {
            type: 'payment_expired',
            chargeId: chargeId,
            externalId: externalId,
            manual_confirmation: true
          };
          
        default:
          console.log('❓ Status de pagamento desconhecido:', status);
          return {
            type: 'unknown',
            originalStatus: status,
            chargeId: chargeId,
            manual_confirmation: true
          };
      }
    } catch (error) {
      console.error('❌ Erro ao processar notificação manual:', error.message);
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

  // Testa configuração para Links de Pagamento
  testConnection() {
    try {
      console.log('🔄 Testando configuração de Links de Pagamento...');
      
      // Gera um link de teste para verificar configuração
      const testData = {
        amount: 1000, // R$ 10,00
        description: 'Teste de configuração',
        externalId: 'test_' + Date.now()
      };
      
      const testLink = this.generatePaymentLink(testData);
      
      console.log('✅ Configuração de Links de Pagamento OK');
      console.log('🔗 Link de teste gerado:', testLink);
      
      return {
        success: true,
        testLink: testLink,
        message: 'Links de Pagamento configurados corretamente'
      };
    } catch (error) {
      console.error('❌ Erro na configuração de Links de Pagamento:', error.message);
      
      return {
        success: false,
        error: error.message,
        message: 'Erro na configuração de Links de Pagamento'
      };
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