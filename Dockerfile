# Use Node.js LTS como base
# Em caso de erro 500 do Docker Hub, use registries alternativos:
# FROM quay.io/node:18-alpine
# FROM mcr.microsoft.com/node:18-alpine
FROM node:18-alpine

# Instalar dependências do sistema com limpeza de cache
RUN apk add --no-cache \
    sqlite \
    tzdata \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Definir timezone
ENV TZ=America/Sao_Paulo

# Criar usuário não-root primeiro (melhor prática de segurança)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001 -G nodejs

# Criar diretório da aplicação
WORKDIR /app

# Copiar arquivos de dependências primeiro (otimização de cache)
COPY --chown=botuser:nodejs package*.json ./

# Instalar dependências com otimizações
RUN npm ci --only=production --no-audit --no-fund && \
    npm cache clean --force

# Copiar código da aplicação
COPY --chown=botuser:nodejs . .

# Criar diretórios necessários
RUN mkdir -p /app/data /app/data/backups /app/logs /app/cache && \
    chown -R botuser:nodejs /app/data /app/logs /app/cache

# Definir variáveis de ambiente
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/database.sqlite
ENV PORT=3000

# Expor porta
EXPOSE 3000

# Mudar para usuário não-root
USER botuser

# Health check otimizado
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Usar dumb-init para melhor handling de sinais
ENTRYPOINT ["dumb-init", "--"]

# Comando para iniciar a aplicação
CMD ["npm", "start"]