# Use Node.js LTS como base
FROM node:18-alpine

# Instalar dependências do sistema
RUN apk add --no-cache \
    sqlite \
    tzdata

# Definir timezone
ENV TZ=America/Sao_Paulo

# Criar diretório da aplicação
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production && npm cache clean --force

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Copiar código da aplicação
COPY --chown=botuser:nodejs . .

# Criar diretório para banco de dados
RUN mkdir -p /app/data && chown botuser:nodejs /app/data

# Definir variáveis de ambiente
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/database.sqlite

# Expor porta
EXPOSE 3000

# Mudar para usuário não-root
USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Comando para iniciar a aplicação
CMD ["npm", "start"]