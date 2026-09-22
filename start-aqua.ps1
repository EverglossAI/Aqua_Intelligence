param(
  [int]$Port = 8000
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host "Could not start Aqua on $prefix" -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

Write-Host ""
Write-Host "Aqua Intelligence NRW Cockpit" -ForegroundColor Cyan
Write-Host "Serving: $root"
Write-Host "Open:    $prefix"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

Start-Process $prefix

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".wasm" = "application/wasm"
  ".inp"  = "text/plain; charset=utf-8"
  ".zip"  = "application/zip"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $relative = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }

    $path = Join-Path $root ($relative -replace '/', '\')
    $full = [IO.Path]::GetFullPath($path)

    if (-not $full.StartsWith([IO.Path]::GetFullPath($root))) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }

    if (Test-Path $full -PathType Container) {
      $full = Join-Path $full "index.html"
    }

    if (-not (Test-Path $full -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $ctx.Response.Close()
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
    else { $ctx.Response.ContentType = "application/octet-stream" }

    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.OutputStream.Close()
  } catch {
    if ($listener.IsListening) {
      Write-Host $_.Exception.Message -ForegroundColor Yellow
    }
  }
}
