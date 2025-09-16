#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Cores para o console
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
    title: (msg) => console.log(`${colors.cyan}${colors.bright}🚀 ${msg}${colors.reset}`)
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function setup() {
    console.clear();
    log.title('SETUP DO BOT TELEGRAM - SISTEMA COMPLETO');
    console.log('\n' + '='.repeat(60) + '\n');
    
    log.info('Este script irá configurar seu bot Telegram automaticamente.');
    log.info('Certifique-se de ter:');
    console.log('  • Token do bot (obtido via @BotFather)');
    console.log('  • Seu ID do Telegram (obtido via @userinfobot)');
    console.log('  • MySQL instalado e rodando\n');
    
    const continuar = await question('Deseja continuar? (s/n): ');
    if (continuar.toLowerCase() !== 's') {
        log.warning('Setup cancelado.');
        process.exit(0);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Verificar se .env já existe
    if (fs.existsSync('.env')) {
        log.warning('Arquivo .env já existe!');
        const sobrescrever = await question('Deseja sobrescrever? (s/n): ');
        if (sobrescrever.toLowerCase() !== 's') {
            log.info('Mantendo arquivo .env existente.');
            rl.close();
            return;
        }
    }
    
    // Coletar informações
    log.title('CONFIGURAÇÃO DO BOT');
    const botToken = await question('🤖 Token do Bot Telegram: ');
    const adminId = await question('👤 Seu ID do Telegram: ');
    
    log.title('CONFIGURAÇÃO DO BANCO DE DADOS');
    const dbHost = await question('🗄️  Host do MySQL (localhost): ') || 'localhost';
    const dbUser = await question('👤 Usuário do MySQL (root): ') || 'root';
    const dbPassword = await question('🔐 Senha do MySQL: ');
    const dbName = await question('📊 Nome do banco (telegram_bot): ') || 'telegram_bot';
    const dbPort = await question('🔌 Porta do MySQL (3306): ') || '3306';
    
    log.title('CONFIGURAÇÕES OPCIONAIS');
    const serverPort = await question('🌐 Porta do servidor (3000): ') || '3000';
    const geminiKey = await question('🤖 Chave do Gemini AI (opcional): ') || '';
    
    // Criar arquivo .env
    const envContent = `# === CONFIGURAÇÕES DO BOT TELEGRAM ===
TELEGRAM_BOT_TOKEN=${botToken}
ADMIN_IDS=${adminId}

# === CONFIGURAÇÕES DO SERVIDOR ===
PORT=${serverPort}
NODE_ENV=production

# === CONFIGURAÇÕES INFINITEPAY ===
INFINITEPAY_CLIENT_ID=seu_client_id
INFINITEPAY_CLIENT_SECRET=seu_client_secret
INFINITEPAY_WEBHOOK_SECRET=seu_webhook_secret
INFINITEPAY_BASE_URL=https://api.infinitepay.io

# === CONFIGURAÇÕES DO BANCO DE DADOS ===
DB_HOST=${dbHost}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
DB_NAME=${dbName}
DB_PORT=${dbPort}

# === CONFIGURAÇÕES DE ASSINATURA ===
SUBSCRIPTION_PRICE_WEEK=1500
SUBSCRIPTION_PRICE_MONTH=4500
SUBSCRIPTION_PRICE_YEAR=45000

# === CONFIGURAÇÕES DE MÍDIA ===
MEDIA_FOLDER=./media
MAX_FILE_SIZE=20971520

# === CONFIGURAÇÕES DE AUTO-POST ===
AUTO_POST_INTERVAL=3600000
AUTO_POST_ENABLED=true

# === CONFIGURAÇÕES DE GEMINI AI ===
GEMINI_API_KEY=${geminiKey}

# === CONFIGURAÇÕES DE CACHE ===
CACHE_TTL=3600

# === CONFIGURAÇÕES DE LOGS ===
LOG_LEVEL=info
LOG_FILE=./logs/bot.log`;
    
    try {
        fs.writeFileSync('.env', envContent);
        log.success('Arquivo .env criado com sucesso!');
    } catch (error) {
        log.error('Erro ao criar arquivo .env: ' + error.message);
        process.exit(1);
    }
    
    // Criar pastas necessárias
    const folders = ['media', 'logs', 'backups'];
    folders.forEach(folder => {
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
            log.success(`Pasta ${folder}/ criada`);
        }
    });
    
    // Instalar dependências
    console.log('\n' + '='.repeat(60) + '\n');
    log.title('INSTALANDO DEPENDÊNCIAS');
    
    const instalar = await question('Deseja instalar as dependências agora? (s/n): ');
    if (instalar.toLowerCase() === 's') {
        try {
            log.info('Instalando dependências...');
            execSync('npm install', { stdio: 'inherit' });
            log.success('Dependências instaladas com sucesso!');
        } catch (error) {
            log.error('Erro ao instalar dependências: ' + error.message);
        }
    }
    
    // Finalização
    console.log('\n' + '='.repeat(60) + '\n');
    log.title('SETUP CONCLUÍDO!');
    console.log('\n📋 Próximos passos:');
    console.log('\n1. Certifique-se de que o MySQL está rodando');
    console.log('2. Execute: node server.js');
    console.log('3. Procure seu bot no Telegram e digite /start');
    console.log('4. Use /admin para acessar o painel administrativo');
    console.log('\n🎯 Funcionalidades disponíveis:');
    console.log('  • Sistema completo de botões interativos');
    console.log('  • Postagem manual (grupos + DM)');
    console.log('  • Captura automática de membros');
    console.log('  • Upload e gerenciamento de mídia');
    console.log('  • Auto-post programado');
    console.log('  • Painel administrativo completo');
    console.log('  • Sistema de backup e logs');
    console.log('\n📖 Consulte CONFIGURACAO_COMPLETA.md para mais detalhes.');
    console.log('\n' + '='.repeat(60));
    
    rl.close();
}

// Executar setup
setup().catch(error => {
    log.error('Erro durante o setup: ' + error.message);
    process.exit(1);
});