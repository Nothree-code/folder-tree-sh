# folder-tree-sh 一键发布脚本
# 用法（在仓库目录 D:\folder-tree-sh 下）:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Message "修复 xxx"
# 不带 -Message 时自动用当前时间作为提交信息。
# 作用: 把插件源目录同步到本仓库 -> git 提交 -> 推送到 GitHub。
# 注意: README.md / LICENSE / .gitignore 在仓库里维护, 不会被源目录覆盖。

param([string]$Message = "")

$ErrorActionPreference = 'Stop'
$src = 'C:\Users\SangHao\.dsh\profiles\web\packages\dsh-ftree'
$repo = $PSScriptRoot

if (-not (Test-Path $src)) {
    Write-Host "源目录不存在: $src" -ForegroundColor Red
    exit 1
}

$files = @('package.json', 'lib\index.js', 'lib\client.js', 'sync.ps1')
foreach ($f in $files) {
    $from = Join-Path $src $f
    $to = Join-Path $repo $f
    if (-not (Test-Path $from)) { Write-Host "源文件缺失: $from" -ForegroundColor Red; exit 1 }
    Copy-Item $from $to -Force
    $same = (Get-FileHash $from).Hash -eq (Get-FileHash $to).Hash
    if (-not $same) { Write-Host "复制校验失败: $f" -ForegroundColor Red; exit 1 }
}
Write-Host "文件已同步: $($files -join ', ')" -ForegroundColor Green

git -C $repo add -A
$changed = git -C $repo status --porcelain
if (-not $changed) {
    Write-Host '无改动，无需提交' -ForegroundColor Yellow
    exit 0
}

$msg = if ($Message.Trim()) { $Message.Trim() } else { 'update: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
git -C $repo commit -m $msg
if ($LASTEXITCODE -ne 0) { Write-Host '提交失败' -ForegroundColor Red; exit 1 }

Write-Host "正在推送到 GitHub..." -ForegroundColor Cyan
git -C $repo push
if ($LASTEXITCODE -ne 0) { Write-Host '推送失败（首次使用会弹出 GitHub 登录窗口）' -ForegroundColor Red; exit 1 }

Write-Host "已推送到 https://github.com/Nothree-code/folder-tree-sh （提交: $msg）" -ForegroundColor Green
