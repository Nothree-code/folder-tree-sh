# folder-tree-sh 一键同步脚本
# 用法：在 packages\dsh-ftree 目录下执行  powershell -ExecutionPolicy Bypass -File sync.ps1
# 作用：把源文件同步到 node_modules 的实体拷贝（两处必须一致，否则改动不生效）
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$dst = Join-Path $here '..\..\node_modules\folder-tree-sh'

if (-not (Test-Path $dst)) {
    Write-Host "目标不存在: $dst" -ForegroundColor Red
    Write-Host '请先在 profiles\web 目录执行: pnpm add "file:./packages/dsh-ftree"' -ForegroundColor Yellow
    exit 1
}

$files = @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js')
foreach ($f in $files) {
    $src = Join-Path $here $f
    if (-not (Test-Path $src)) { Write-Host "源缺失: $src" -ForegroundColor Red; continue }
    try {
        Copy-Item $src (Join-Path $dst $f) -Force -ErrorAction Stop
        $same = (Get-FileHash $src).Hash -eq (Get-FileHash (Join-Path $dst $f)).Hash
        Write-Host ("{0,-14} {1}" -f $f, $(if ($same) { 'OK' } else { 'MISMATCH!' })) -ForegroundColor $(if ($same) { 'Green' } else { 'Red' })
    } catch {
        Write-Host ("{0,-14} 被占用，跳过（关闭 dsh web 后再同步，或重新 pnpm add）" -f $f) -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '同步完成。若 package.json 有改动（名称/版本/dsh.client），建议再执行一次:'
Write-Host '  cd ..\.. && pnpm add "file:./packages/dsh-ftree"'
Write-Host '最后必须重启 dsh web 生效。' -ForegroundColor Yellow
