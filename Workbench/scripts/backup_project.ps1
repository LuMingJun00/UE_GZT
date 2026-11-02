# 工程快照备份：把 SceneWorkbench 的 Content + Config + uproject 打包为带日期 ZIP
param(
    [string]$ProjectRoot = "E:\00_AI\UE_GZT\SceneWorkbench",
    [string]$BackupDir = "E:\00_AI\UE_GZT\Backups"
)

if (-not (Test-Path -LiteralPath $ProjectRoot)) {
    Write-Output "工程目录不存在: $ProjectRoot"
    exit 1
}
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$zip = Join-Path $BackupDir "SceneWorkbench_$stamp.zip"

$contentDir = Join-Path $ProjectRoot "Content"
$configDir = Join-Path $ProjectRoot "Config"
$uproject = Join-Path $ProjectRoot "SceneWorkbench.uproject"

$items = @()
if (Test-Path -LiteralPath $contentDir) { $items += $contentDir }
if (Test-Path -LiteralPath $configDir) { $items += $configDir }
if (Test-Path -LiteralPath $uproject) { $items += $uproject }

Compress-Archive -Path $items -DestinationPath $zip -CompressionLevel Optimal -Force

Write-Output "backup=$zip"
