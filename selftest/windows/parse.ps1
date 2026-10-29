# Asks PowerShell's own parser about the syntax of the scripts named in a list (one path per line, UTF-8). Runs nothing of them.
param([string]$List)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$result = @()
foreach ($f in (Get-Content -LiteralPath $List -Encoding UTF8)) {
  if (-not $f.Trim()) { continue }
  $tokens = $null; $errors = $null
  try {
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)
    $list = @($errors | ForEach-Object { [pscustomobject]@{ line = $_.Extent.StartLineNumber; col = $_.Extent.StartColumnNumber; message = $_.Message } })
    $result += [pscustomobject]@{ file = $f; errors = $list }
  } catch {
    $result += [pscustomobject]@{ file = $f; errors = @([pscustomobject]@{ line = 0; col = 0; message = $_.Exception.Message }) }
  }
}
ConvertTo-Json -Compress -Depth 5 -InputObject @($result)
