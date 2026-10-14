param(
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$Voice = 'Microsoft Huihui Desktop',
    [ValidateRange(-10,10)][int]$Rate = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$videoNarrationPlan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
$videoNarrationRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $videoNarrationRoot -Force | Out-Null
$videoSpeaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$videoSynthesisRows = @()
try {
    $videoSpeaker.SelectVoice($Voice)
    $videoSpeaker.Rate = $Rate
    $videoSpeaker.Volume = 100
    foreach ($videoUtterance in $videoNarrationPlan.utterances) {
        if ($videoUtterance.id -notmatch '^[A-Za-z0-9_-]+$') { throw 'Narration id must be a local safe filename.' }
        if ([string]::IsNullOrWhiteSpace($videoUtterance.text)) { throw 'Narration text cannot be empty.' }
        $videoWavPath = Join-Path $videoNarrationRoot ($videoUtterance.id + '.wav')
        $videoSpeaker.SetOutputToWaveFile($videoWavPath)
        $videoSpeaker.Speak([string]$videoUtterance.text)
        $videoSpeaker.SetOutputToNull()
        $videoSynthesisRows += [pscustomobject]@{id=$videoUtterance.id; text=$videoUtterance.text; file=$videoWavPath}
    }
    [pscustomobject]@{voice=$Voice; rate=$Rate; network_used=$false; utterances=$videoSynthesisRows} |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $videoNarrationRoot 'synthesis.json') -Encoding UTF8
    Write-Output ('SYNTHESIZED ' + $videoSynthesisRows.Count + ' local utterances with ' + $Voice)
}
finally { $videoSpeaker.Dispose() }
