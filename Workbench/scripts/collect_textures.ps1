# 收纳入库：把浏览器下载目录中 EkkoPBR 导出的 PBR 贴图按命名规范归位到 Assets\Textures\<名称>\
param(
    [string]$SourceDir = (Join-Path $env:USERPROFILE "Downloads"),
    [string]$TargetRoot = "E:\00_AI\UE_GZT\Assets\Textures"
)

$suffixes = @('_BaseColor','_Normal','_Roughness','_Metalness','_Metallic','_Height','_AO','_AmbientOcclusion','_Displacement','_Specular')
$exts = @('*.png','*.jpg','*.jpeg','*.tif','*.tiff','*.webp','*.tga','*.exr')
$cutoff = (Get-Date).AddHours(-12)

if (-not (Test-Path -LiteralPath $SourceDir)) {
    Write-Output "源目录不存在: $SourceDir"
    exit 1
}

$files = @()
foreach ($e in $exts) {
    $files += Get-ChildItem -Path (Join-Path $SourceDir '*') -Filter $e -File -ErrorAction SilentlyContinue
}
$files = $files | Where-Object { $_.LastWriteTime -gt $cutoff } | Select-Object -Unique

$moved = 0
$manifest = @()

foreach ($f in $files) {
    $base = $f.BaseName
    $suffix = $null
    foreach ($s in $suffixes) {
        if ($base -like "*$s") { $suffix = $s; break }
    }
    if (-not $suffix) { continue }

    $prefix = $base.Substring(0, $base.Length - $suffix.Length).TrimEnd('_')
    if (-not $prefix) { $prefix = "未命名_$(Get-Date -Format 'HHmmss')" }
    $destDir = Join-Path $TargetRoot $prefix
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null

    $destFile = Join-Path $destDir $f.Name
    Copy-Item -LiteralPath $f.FullName -Destination $destFile -Force
    $manifest += "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $($f.Name) | 来源: $($f.FullName)"
    $moved++
}

if ($moved -gt 0) {
    $mf = Join-Path $TargetRoot "_manifest.txt"
    Add-Content -LiteralPath $mf -Value ($manifest -join "`r`n") -Encoding UTF8
}

Write-Output "collected=$moved target=$TargetRoot"
