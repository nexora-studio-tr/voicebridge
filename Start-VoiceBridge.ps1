param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeCandidates = @()
if ($env:VOICEBRIDGE_NODE) { $nodeCandidates += $env:VOICEBRIDGE_NODE }
$systemNode = Get-Command node -ErrorAction SilentlyContinue
if ($systemNode) { $nodeCandidates += $systemNode.Source }
# Optional local Codex-bundled runtime; ordinary installations use their own Node.
$nodeCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$voicebridgeNode = $null
foreach ($candidate in $nodeCandidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $version = & $candidate -p 'process.versions.node'
    if ($version -match '^24\.(\d+)\.' -and [int]$Matches[1] -ge 17) { $voicebridgeNode = $candidate; break }
}
if (-not $voicebridgeNode) { throw 'Install Node.js 24.17+ (24.x), or set VOICEBRIDGE_NODE to its executable.' }
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath 'dist/server/main.js')) { throw 'Build first: npm ci --ignore-scripts, then npm run build.' }
if ($Demo) { & $voicebridgeNode --env-file-if-exists=.env.demo dist/server/main.js --demo }
else { & $voicebridgeNode --env-file-if-exists=.env dist/server/main.js }
exit $LASTEXITCODE
