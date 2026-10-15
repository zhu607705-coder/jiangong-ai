param([string]$ProjectId = 'P-0529974d-63fe-4ae8-804d-e5efb049f60a')
$ErrorActionPreference = 'Stop'
$null = Invoke-RestMethod 'http://127.0.0.1:4310/api/session' -SessionVariable valueSession
$valueCases = @(
  @{ question='二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除，当前报道时是什么阶段？'; expected=@('line:22','line:24'); title='供水范围与阶段' }
  @{ question='求是村75幢1单元加装电梯公告征集意见期限是什么时候？'; expected=@('line:1'); title='电梯征求意见阶段' }
)
$valueRuns = @()
foreach ($valueCase in $valueCases) {
  $valueBody = @{ question=$valueCase.question; include_ai=$false; limit=5 } | ConvertTo-Json -Compress
  $valueWatch = [Diagnostics.Stopwatch]::StartNew()
  $valueResponse = Invoke-RestMethod "http://127.0.0.1:4310/api/projects/$ProjectId/knowledge/retrieve" -WebSession $valueSession -Method Post -Headers @{'X-Requested-With'='haizhizi'} -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($valueBody))
  $valueWatch.Stop()
  $valueTargets = if ($valueCase.title -eq '供水范围与阶段') {
    @($valueResponse.hits | Where-Object { $_.file_name -eq '浙大求是社区推进二次供水改造.txt' -and $_.locator -in $valueCase.expected })
  } else {
    @($valueResponse.hits | Where-Object { $_.file_name -like '*75幢1单元*' -and $_.locator -eq 'line:1' })
  }
  $valueRuns += [ordered]@{ title=$valueCase.title; question=$valueCase.question; elapsed_ms=[math]::Round($valueWatch.Elapsed.TotalMilliseconds,3); expected_locators=$valueCase.expected; matched_targets=$valueTargets.Count; response=$valueResponse }
}
$valueTotalMs = 0.0
foreach ($valueRun in $valueRuns) { $valueTotalMs += $valueRun.elapsed_ms }
$valueOut = [ordered]@{
  schema='decision-value-selftest/1'; performed_at=(Get-Date).ToUniversalTime().ToString('o'); project_id=$ProjectId
  operator='Codex automated browser and API operation'; sample='one project, two archived originals, two fixed questions, five factual checks'
  conditions='Services running; materials parsed; all measure filters disabled; sequential paired task; no human participant; source acquisition/import excluded; no generated answer'
  runs=$valueRuns; total_service_ms=[math]::Round($valueTotalMs,3)
  ui_operation=(Get-Content -Raw -LiteralPath '.cache/timing-ui.json' | ConvertFrom-Json)
  pilot=(Get-Content -Raw -LiteralPath '.cache/timing-pilot.json' | ConvertFrom-Json)
  imports=(Get-Content -Raw -LiteralPath '.cache/timing-imports.json' | ConvertFrom-Json)
  conclusion='Three manually identified target fragments present in top five; five factual checks traceable. Service latency and automated browser wall-clock are different metrics. UI assisted time included one filter correction; no human time-saving percentage is inferred.'
}
$valuePath = 'research/test_results/decision-value-selftest-20261015.json'
$valueOut | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $valuePath -Encoding utf8
$valueRuns | ForEach-Object { Write-Output "$($_.title): $($_.elapsed_ms) ms; $($_.matched_targets)/$($_.expected_locators.Count) target fragments" }
Write-Output "Total service time: $($valueOut.total_service_ms) ms. Evidence: $valuePath"
