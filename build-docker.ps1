# Script PowerShell para Build Docker com Fallbacks
# Resolve automaticamente problemas de conectividade do Docker Hub

param(
    [string]$ImageName = "telegram-bot",
    [string]$Tag = "latest",
    [switch]$UseOptimized = $false,
    [switch]$CleanCache = $false
)

Write-Host "🐳 Script de Build Docker com Fallbacks" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Função para verificar se Docker está rodando
function Test-DockerRunning {
    try {
        docker version | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

# Função para limpar cache
function Clear-DockerCache {
    Write-Host "🧹 Limpando cache do Docker..." -ForegroundColor Yellow
    try {
        docker builder prune -f
        docker system prune -f
        Write-Host "✅ Cache limpo com sucesso" -ForegroundColor Green
    }
    catch {
        Write-Host "⚠️ Erro ao limpar cache: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Função para fazer build com fallback
function Build-DockerWithFallback {
    param(
        [string]$DockerfilePath,
        [string]$ImageName,
        [string]$Tag
    )
    
    $registries = @(
        @{ Name = "Docker Hub"; From = "node:18-alpine" },
        @{ Name = "Microsoft Container Registry"; From = "mcr.microsoft.com/node:18-alpine" },
        @{ Name = "Quay.io"; From = "quay.io/node:18-alpine" },
        @{ Name = "GitLab Registry"; From = "registry.gitlab.com/node:18-alpine" }
    )
    
    foreach ($registry in $registries) {
        Write-Host "🔄 Tentando build com $($registry.Name)..." -ForegroundColor Yellow
        
        # Criar Dockerfile temporário com registry alternativo
        $tempDockerfile = "Dockerfile.temp"
        $content = Get-Content $DockerfilePath
        $content = $content -replace "FROM node:18-alpine", "FROM $($registry.From)"
        $content | Set-Content $tempDockerfile
        
        try {
            # Tentar build
            $buildResult = docker build -f $tempDockerfile -t "${ImageName}:${Tag}" . 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Build realizado com sucesso usando $($registry.Name)!" -ForegroundColor Green
                Remove-Item $tempDockerfile -Force
                return $true
            }
            else {
                Write-Host "❌ Falha no build com $($registry.Name)" -ForegroundColor Red
                Write-Host "Erro: $buildResult" -ForegroundColor Red
            }
        }
        catch {
            Write-Host "❌ Erro durante build com $($registry.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
        
        # Limpar arquivo temporário
        if (Test-Path $tempDockerfile) {
            Remove-Item $tempDockerfile -Force
        }
        
        Write-Host "⏳ Aguardando 5 segundos antes da próxima tentativa..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    
    return $false
}

# Verificar se Docker está rodando
if (-not (Test-DockerRunning)) {
    Write-Host "❌ Docker não está rodando. Por favor, inicie o Docker Desktop." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Docker está rodando" -ForegroundColor Green

# Limpar cache se solicitado
if ($CleanCache) {
    Clear-DockerCache
}

# Determinar qual Dockerfile usar
$dockerfilePath = if ($UseOptimized) {
    if (Test-Path "Dockerfile.optimized") {
        Write-Host "📦 Usando Dockerfile otimizado" -ForegroundColor Cyan
        "Dockerfile.optimized"
    }
    else {
        Write-Host "⚠️ Dockerfile.optimized não encontrado, usando Dockerfile padrão" -ForegroundColor Yellow
        "Dockerfile"
    }
}
else {
    "Dockerfile"
}

# Verificar se Dockerfile existe
if (-not (Test-Path $dockerfilePath)) {
    Write-Host "❌ Dockerfile não encontrado: $dockerfilePath" -ForegroundColor Red
    exit 1
}

Write-Host "🔨 Iniciando build da imagem ${ImageName}:${Tag}" -ForegroundColor Cyan

# Tentar build com fallbacks
$success = Build-DockerWithFallback -DockerfilePath $dockerfilePath -ImageName $ImageName -Tag $Tag

if ($success) {
    Write-Host "" -ForegroundColor Green
    Write-Host "🎉 BUILD CONCLUÍDO COM SUCESSO!" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host "📦 Imagem criada: ${ImageName}:${Tag}" -ForegroundColor Green
    Write-Host "" -ForegroundColor Green
    Write-Host "🚀 Para executar o container:" -ForegroundColor Cyan
    Write-Host "   docker run -d -p 3000:3000 --name telegram-bot ${ImageName}:${Tag}" -ForegroundColor White
    Write-Host "" -ForegroundColor Green
    Write-Host "🐳 Para usar com docker-compose:" -ForegroundColor Cyan
    Write-Host "   docker-compose up -d" -ForegroundColor White
    
    # Mostrar informações da imagem
    Write-Host "" -ForegroundColor Green
    Write-Host "📊 Informações da imagem:" -ForegroundColor Cyan
    docker images $ImageName
}
else {
    Write-Host "" -ForegroundColor Red
    Write-Host "❌ FALHA NO BUILD" -ForegroundColor Red
    Write-Host "=========================================" -ForegroundColor Red
    Write-Host "💡 Soluções alternativas:" -ForegroundColor Yellow
    Write-Host "   1. Aguarde alguns minutos e tente novamente" -ForegroundColor White
    Write-Host "   2. Verifique sua conexão com a internet" -ForegroundColor White
    Write-Host "   3. Use: .\build-docker.ps1 -CleanCache" -ForegroundColor White
    Write-Host "   4. Use: .\build-docker.ps1 -UseOptimized" -ForegroundColor White
    Write-Host "   5. Consulte DOCKER_TROUBLESHOOTING.md" -ForegroundColor White
    Write-Host "   6. Deploy direto no Railway: railway up" -ForegroundColor White
    exit 1
}

Write-Host "" -ForegroundColor Green
Write-Host "📚 Para mais informações sobre problemas de Docker:" -ForegroundColor Cyan
Write-Host "   Consulte: DOCKER_TROUBLESHOOTING.md" -ForegroundColor White