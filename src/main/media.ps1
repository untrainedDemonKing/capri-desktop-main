# What's playing, so Capri can bob her head to it, comment on it, and skip it if she's bored of it.
# Prints one JSON line whenever it changes: the app playing (its id), the title, the artist and
# whether it's playing, as Windows itself shows in its volume flyout (any player that reports to
# Windows: Spotify, a browser, Yandex Music, AIMP...). If Windows can't say, Spotify's window title.
#
#   powershell -File media.ps1 <capri pid>

param([int]$ParentPid = 0)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$mgr = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(3000)) { return $null }
    return $task.Result
  }
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $Manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $Props = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $mgr = Await ($Manager::RequestAsync()) $Manager
} catch {
  $mgr = $null
}

function Now-Playing {
  if ($mgr) {
    $s = $mgr.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $Props
      $info = $s.GetPlaybackInfo()
      return [pscustomobject]@{
        app = [string]$s.SourceAppUserModelId
        title = [string]$p.Title
        artist = [string]$p.Artist
        status = [string]$info.PlaybackStatus
      }
    }
    return $null
  }
  # no media controls to ask: Spotify's own window says "Artist - Title" while it plays
  $sp = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if ($sp) {
    $t = $sp.MainWindowTitle
    if ($t -match '^(.+?) - (.+)$') {
      return [pscustomobject]@{ app = 'Spotify.exe'; title = $Matches[2]; artist = $Matches[1]; status = 'Playing' }
    }
    return [pscustomobject]@{ app = 'Spotify.exe'; title = ''; artist = ''; status = 'Paused' }
  }
  return $null
}

$last = ''
$tick = 0
while ($true) {
  $tick++
  if ($ParentPid -and ($tick % 10 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  $now = Now-Playing
  $line = if ($now) { $now | ConvertTo-Json -Compress } else { '{}' }
  if ($line -ne $last) {
    $last = $line
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
  }
  Start-Sleep -Seconds 3
}
