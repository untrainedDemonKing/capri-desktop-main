# Makes a wav (16 kHz, 16 bit, mono: the shape Capri's ears send to the recogniser) of a line of text with a Windows voice of the
# language asked for (ru or en). The text comes as base64 so that it needs no particular encoding. Prints "OK <voice>" or "NOVOICE".
param([string]$Out, [string]$TextB64, [string]$Language)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $Language } | Select-Object -First 1
if (-not $voice) { Write-Output 'NOVOICE'; exit 3 }
$s.SelectVoice($voice.VoiceInfo.Name)
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $format)
$s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextB64)))
$s.Dispose()
Write-Output ('OK ' + $voice.VoiceInfo.Name)
