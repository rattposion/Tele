# 🐳 Guia de Solução de Problemas Docker

## 🚨 Problema: Erro 500 Internal Server Error do Docker Hub

### Sintomas
```
ERROR: failed to build: failed to solve: node:18-alpine: failed to resolve source metadata for docker.io/library/node:18-alpine: failed to authorize: failed to fetch oauth token: unexpected status from POST request to `https://auth.docker.io/token:` 500 Internal Server Error
```

### Causas Comuns
1. **Instabilidade temporária do Docker Hub**
2. **Problemas de conectividade de rede**
3. **Rate limiting do Docker Hub**
4. **Problemas de DNS**
5. **Firewall/Proxy corporativo**

### Soluções

#### 1. 🔄 Aguardar e Tentar Novamente
```bash
# Aguarde alguns minutos e tente novamente
docker build -t telegram-bot .
```

#### 2. 🌐 Usar Registries Alternativos

**Opção A: Microsoft Container Registry**
```dockerfile
# No Dockerfile, substitua:
FROM node:18-alpine
# Por:
FROM mcr.microsoft.com/node:18-alpine
```

**Opção B: Quay.io**
```dockerfile
FROM quay.io/node:18-alpine
```

**Opção C: GitLab Registry**
```dockerfile
FROM registry.gitlab.com/node:18-alpine
```

#### 3. 🧹 Limpar Cache do Docker
```bash
# Limpar cache de build
docker builder prune -a

# Limpar todas as imagens não utilizadas
docker system prune -a

# Reiniciar Docker Desktop (Windows)
# Clique com botão direito no ícone do Docker > Restart
```

#### 4. 🔧 Configurar DNS Alternativo
```bash
# Configurar DNS do Google no Docker Desktop
# Settings > Docker Engine > Adicionar:
{
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

#### 5. 📦 Usar Imagem Local
```bash
# Baixar imagem manualmente
docker pull node:18-alpine

# Ou usar uma imagem já baixada
docker images | grep node
```

## 🛠️ Dockerfile Otimizado

O projeto já inclui um `Dockerfile.optimized` com as seguintes melhorias:

### ✅ Recursos Implementados
- **Registries alternativos** comentados para uso rápido
- **Cache otimizado** com layers bem estruturadas
- **Segurança aprimorada** com usuário não-root
- **Health check robusto** com tratamento de erros
- **dumb-init** para melhor handling de sinais
- **Limpeza de cache** para imagens menores

### 🚀 Como Usar o Dockerfile Otimizado
```bash
# Renomear o arquivo atual
mv Dockerfile Dockerfile.backup

# Usar a versão otimizada
mv Dockerfile.optimized Dockerfile

# Fazer build
docker build -t telegram-bot .
```

## 🔍 Diagnóstico de Problemas

### Verificar Status do Docker
```bash
# Verificar se Docker está rodando
docker version

# Verificar informações do sistema
docker system info

# Verificar conectividade
docker run --rm alpine ping -c 3 docker.io
```

### Logs Detalhados
```bash
# Build com logs verbosos
docker build --progress=plain -t telegram-bot .

# Verificar logs do container
docker logs telegram-subscription-bot
```

## 🌐 Alternativas de Deploy

### Railway (Recomendado)
```bash
# O projeto já está configurado para Railway
# Arquivo railway.json já configurado
railway up
```

### Docker Compose Local
```bash
# Subir todos os serviços
docker-compose up -d

# Verificar status
docker-compose ps

# Logs em tempo real
docker-compose logs -f
```

### Heroku
```bash
# Instalar Heroku CLI
# Fazer login
heroku login

# Criar app
heroku create seu-bot-telegram

# Deploy
git push heroku main
```

## 🔧 Configurações de Rede

### Proxy Corporativo
```dockerfile
# Adicionar no Dockerfile se necessário
ENV HTTP_PROXY=http://proxy.empresa.com:8080
ENV HTTPS_PROXY=http://proxy.empresa.com:8080
ENV NO_PROXY=localhost,127.0.0.1
```

### Docker Desktop Settings
```json
{
  "registry-mirrors": [
    "https://mirror.gcr.io",
    "https://daocloud.io",
    "https://c.163.com"
  ],
  "insecure-registries": [],
  "debug": true,
  "experimental": false
}
```

## 📞 Suporte

Se os problemas persistirem:

1. **Verificar status do Docker Hub**: https://status.docker.com/
2. **Usar modo offline**: Trabalhar com imagens já baixadas
3. **Considerar alternativas**: Podman, containerd
4. **Deploy direto**: Usar Railway, Heroku ou VPS

## 🎯 Checklist de Solução Rápida

- [ ] Aguardar 5-10 minutos e tentar novamente
- [ ] Limpar cache do Docker (`docker system prune -a`)
- [ ] Usar registry alternativo (MCR, Quay.io)
- [ ] Verificar conectividade de rede
- [ ] Reiniciar Docker Desktop
- [ ] Usar Dockerfile otimizado
- [ ] Deploy direto no Railway

---

**💡 Dica**: O erro 500 do Docker Hub é geralmente temporário. Na maioria dos casos, aguardar alguns minutos resolve o problema.