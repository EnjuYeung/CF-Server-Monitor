$ErrorActionPreference = "Stop"
$DownloadUrl = ""
$ReportUrl = ""
$InstallVersion = "latest"
$AutoUpdateEnabled = $false
$needValueFor = ""
foreach ($arg in $args) {
    if ($needValueFor) {
        switch ($needValueFor) {
            "download" { $DownloadUrl = $arg }
            "report" { $ReportUrl = $arg }
            "version" { $InstallVersion = $arg }
            "auto_update" { $AutoUpdateEnabled = ($arg -eq "1") }
        }
        $needValueFor = ""
        continue
    }
    switch -Regex ($arg) {
        "^--?download-url=(.*)$" { $DownloadUrl = $Matches[1] }
        "^--?download-url$" { $needValueFor = "download" }
        "^--?url=(.*)$" { $ReportUrl = $Matches[1] }
        "^--?url$" { $needValueFor = "report" }
        "^--install-version=(.*)$" { $InstallVersion = $Matches[1] }
        "^--install-version$" { $needValueFor = "version" }
        "^-auto[_-]update=(.*)$" { $AutoUpdateEnabled = ($Matches[1] -eq "1") }
        "^-auto[_-]update$" { $needValueFor = "auto_update" }
    }
}
if ($needValueFor) { throw "missing value for $needValueFor" }
if (!$DownloadUrl) {
    if (!$ReportUrl) { throw "provide -url=CONTROLLER_URL or --download-url=CONTROLLER_BASE/agent" }
    $controller = [System.UriBuilder]::new($ReportUrl)
    $controller.Query = ""
    $controller.Fragment = ""
    $controller.Path = ($controller.Path.TrimEnd('/') -replace '/update$', '') + '/agent'
    $DownloadUrl = $controller.Uri.AbsoluteUri
}
$source = [System.Uri]$DownloadUrl
if (!$source.IsAbsoluteUri -or $source.Scheme -notin @("http", "https") -or $source.UserInfo -or $source.Query -or $source.Fragment) {
    throw "download URL must be an HTTP(S) base URL without credentials, query or fragment"
}
$DownloadUrl = $DownloadUrl.TrimEnd('/')
function Get-ArchName {
    $nativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($nativeArch) {
        "AMD64" { "amd64"; break }
        "ARM64" { "arm64"; break }
        "x86" { "386"; break }
        default { throw "unsupported architecture: $nativeArch" }
    }
}
$command = if ($args.Count -gt 0) { $args[0] } else { "install" }
$payloadArgs = @($args)
if ($command -in @("uninstall", "remove", "delete", "purge")) { $payloadArgs = @($command) }
$asset = "cf-probe-windows-$(Get-ArchName).exe"
if ($InstallVersion -eq "latest") {
    $InstallVersion = (Invoke-WebRequest -Uri "$DownloadUrl/latest" -UseBasicParsing).Content.Trim()
}
if ($InstallVersion -notmatch '^(v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?|Snapshot-\d+)$') { throw "invalid Agent version" }
$base = "$DownloadUrl/$InstallVersion"
$tmp = Join-Path $env:TEMP "cf-probe-bootstrap-$([Guid]::NewGuid().ToString('N')).exe"
Write-Host "Server Monitor native Agent bootstrap: $InstallVersion / $asset"
if ($AutoUpdateEnabled) {
    Write-Warning "Windows auto update downloads and executes cf-probe-update.exe. Antivirus software may block this behavior."
}
try {
    $checksums = (Invoke-WebRequest -Uri "$base/checksums.txt" -UseBasicParsing).Content
    $pattern = '(?m)^([a-f0-9]{64})\s+' + [Regex]::Escape($asset) + '\s*$'
    $match = [Regex]::Match($checksums, $pattern)
    if (!$match.Success) { throw "missing checksum for $asset" }
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $tmp -UseBasicParsing
    if ((Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLowerInvariant() -ne $match.Groups[1].Value) {
        throw "SHA-256 mismatch for $asset"
    }
    if ($args.Count -eq 0) { & $tmp install } else { & $tmp @payloadArgs }
    exit $LASTEXITCODE
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
