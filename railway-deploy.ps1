# Deploy script สำหรับ Railway
# ใช้ครั้งแรก: npm install -g @railway/cli && railway login

Write-Host "=== TikTok Gift Jar - Railway Deploy ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host "[!] Railway CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @railway/cli
}

Write-Host "[1] Checking Railway login..." -ForegroundColor Green
railway whoami
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Please login first: railway login" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2] Deploying to Railway..." -ForegroundColor Green
railway up

Write-Host ""
Write-Host "[3] Done! Next steps:" -ForegroundColor Cyan
Write-Host "   - Set env vars in Railway Dashboard (Variables tab)"
Write-Host "   - Generate domain: Settings > Networking > Generate Domain"
Write-Host "   - Add Volume at /data (optional, for persistent user data)"
Write-Host "   - Update Google OAuth with your Railway URL"