# Teh Tarik Meter - Claude Code status line script (PowerShell version, used when Node.js isn't installed).
#
# Claude Code runs this after each reply and pipes in a JSON object on stdin.
# We keep ONLY the usage limits (rate_limits: five_hour and seven_day) and save
# them next to the app's settings in claude-code-feed.json. Nothing else is saved or sent.
# Then we print your original status line if you had one (chain.json), otherwise a short summary.

$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$appDir = Split-Path -Parent $PSScriptRoot
$feed = Join-Path $appDir 'claude-code-feed.json'
$chain = Join-Path $PSScriptRoot 'chain.json'

function Keep($b) {
  if ($null -eq $b) { return $null }
  return [ordered]@{ used_percentage = $b.used_percentage; resets_at = $b.resets_at }
}

$j = $null
try { $j = $raw | ConvertFrom-Json } catch { $j = $null }
$rl = $null
if ($j) { $rl = $j.rate_limits }
if ($rl -and ($rl.five_hour -or $rl.seven_day)) {
  $out = [ordered]@{
    received_at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    five_hour   = Keep $rl.five_hour
    seven_day   = Keep $rl.seven_day
  }
  $json = $out | ConvertTo-Json -Depth 4 -Compress
  $tmp = "$feed.$PID.tmp"
  try {
    [IO.File]::WriteAllText($tmp, $json)
    Move-Item -Force -LiteralPath $tmp -Destination $feed
  } catch {
    [IO.File]::WriteAllText($feed, $json)
  }
}

$cmd = $null
if (Test-Path -LiteralPath $chain) {
  try { $cmd = (Get-Content -Raw -LiteralPath $chain | ConvertFrom-Json).command } catch { $cmd = $null }
}
if ($cmd) {
  if ($env:SHELL) { $raw | & $env:SHELL -c $cmd } else { $raw | & cmd /c $cmd }
  exit 0
}

$parts = @('Teh tarik')
if ($rl -and $rl.five_hour -and $null -ne $rl.five_hour.used_percentage) {
  $s = [math]::Max(0, [math]::Round(100 - [double]$rl.five_hour.used_percentage))
  $extra = ''
  if ($rl.five_hour.resets_at) {
    $ms = ([double]$rl.five_hour.resets_at * 1000) - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($ms -gt 0) {
      $h = [math]::Floor($ms / 3600000); $m = [math]::Floor(($ms % 3600000) / 60000)
      if ($h -gt 0) { $extra = " (${h}h ${m}m)" } else { $extra = " (${m}m)" }
    }
  }
  $parts += "session $s% left$extra"
}
if ($rl -and $rl.seven_day -and $null -ne $rl.seven_day.used_percentage) {
  $w = [math]::Max(0, [math]::Round(100 - [double]$rl.seven_day.used_percentage))
  $parts += "week $w% left"
}
[Console]::Out.Write(($parts -join ' | '))
