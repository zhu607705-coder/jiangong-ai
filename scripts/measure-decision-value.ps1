param(
  [ValidatePattern('^http://(?:10\.70\.223\.113|127\.0\.0\.1)(?::\d+)?/?$')][string]$BaseUrl='http://10.70.223.113',
  [string]$ProjectId='P-0529974d-63fe-4ae8-804d-e5efb049f60a',
  [int]$ExpectedContextVersion=14,
  [string]$OutputPath='',
  [string]$BaselineEvidencePath='',
  [switch]$SkipDocumentUpdate
)
$ErrorActionPreference='Stop'
$valueRoot=Split-Path -Parent $PSScriptRoot
$valueStarted=[DateTimeOffset]::UtcNow
$valueStamp=$valueStarted.ToString('yyyyMMddTHHmmssfffZ')
if(-not $OutputPath){$OutputPath=Join-Path $valueRoot "research/test_results/decision-value-campus-v$ExpectedContextVersion-$valueStamp.json"}
if(Test-Path -LiteralPath $OutputPath){throw 'Raw evidence already exists; choose a new output path.'}
$valueOldPath=Join-Path $valueRoot 'research/test_results/decision-value-selftest-20261015.json'
$valueOldHash=(Get-FileHash -LiteralPath $valueOldPath -Algorithm SHA256).Hash.ToLowerInvariant()
$valueOld=Get-Content -Raw -LiteralPath $valueOldPath|ConvertFrom-Json
$valueBase=$BaseUrl.TrimEnd('/')
$valueHandler=[Net.Http.HttpClientHandler]::new()
$valueHandler.UseProxy=$false;$valueHandler.UseCookies=$false
$valueClient=[Net.Http.HttpClient]::new($valueHandler)
$valueClient.Timeout=[TimeSpan]::FromSeconds(45)
$valueClient.DefaultRequestHeaders.Add('X-Requested-With','haizhizi')
function Get-ValueSha([string]$Text){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()}
function Read-ValueResponse($Task){
  $valueHttp=$Task.GetAwaiter().GetResult()
  $null=$valueHttp.EnsureSuccessStatusCode()
  return $valueHttp.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json
}
function Test-ValuePatterns([string]$Text,$Patterns){foreach($valuePattern in @($Patterns)){if($Text -notmatch $valuePattern){return $false}};return $true}
function Get-ValueDate($Value){
  if($Value -is [DateTimeOffset]){return $Value.ToUniversalTime().ToString('yyyy-MM-dd')}
  if($Value -is [DateTime]){return $Value.ToUniversalTime().ToString('yyyy-MM-dd')}
  if([string]$Value -match '^\d{4}-\d{2}-\d{2}'){return ([string]$Value).Substring(0,10)}
  return ''
}
try{
  # Inventory downloads happen before the measured task; no source collection/import or login occurs.
  $valueProjectTask=$valueClient.GetAsync("$valueBase/api/projects/$ProjectId")
  $valueDocumentsTask=$valueClient.GetAsync("$valueBase/api/projects/$ProjectId/documents")
  $valueProject=Read-ValueResponse $valueProjectTask
  $valueDocuments=@(Read-ValueResponse $valueDocumentsTask)
  if($valueProject.id -ne $ProjectId -or $valueProject.context_version -ne $ExpectedContextVersion -or $valueProject.input.synthetic){throw 'Project identity/version is not the specified real snapshot.'}
  $valueInputHash=Get-ValueSha ($valueProject.input|ConvertTo-Json -Depth 100 -Compress)
  $valueSourceMap=@{};foreach($valueSource in $valueProject.input.sources){$valueSourceMap[$valueSource.id]=$valueSource}
  $valueDocumentMap=@{};foreach($valueDocument in $valueDocuments){$valueDocumentMap[$valueDocument.id]=$valueDocument}
  # Checks are registered before retrieval. Expected values are never passed into the ranker.
  $valueCases=@(
    @{id='water';title='供水范围与报道阶段';question='二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除，报道时是否已经施工完成？';checks=@(
      @{id='W1';label='29、30、31、48四幢共252户';title='二次供水';text=@('29幢','30幢','31幢','48幢','252户')},
      @{id='W2';label='留博楼因泵房位于居民楼下被排除';title='二次供水';text=@('留博楼','泵房位于居民楼正下方','不纳入改造')},
      @{id='W3';label='2023报道时拟于亚运会后进场，并非竣工';title='二次供水';text=@('亚运会召开之后','进场施工');date='2023-08-18'}
    )},
    @{id='elevator';title='75幢1单元电梯估算与草案';question='求是村75幢1单元加装电梯的投资估算、建设资金来源和公告征求意见阶段分别是什么？';checks=@(
      @{id='E1';label='75幢1单元是草案/征求意见范围';title='75幢1单元.*(草案|征求意见)';text=@()},
      @{id='E2';label='约54万元为投资估算，非结算';title='75幢1单元';text=@('估算总投资约54万元')},
      @{id='E3';label='建设资金来源为市区补助及自筹';title='75幢1单元';text=@('市区补助及自筹')},
      @{id='E4';label='征求意见期限2024-09-18至2024-10-18';title='75幢1单元';text=@('2024年9月18日','2024年10月18日');date='2024-09-18'}
    )},
    @{id='aging';title='社区康养服务与范围';question='浙大求是社区邻里中心的康养服务有哪些，报道记载是启用还是规划，服务对象和设施范围是什么？';checks=@(
      @{id='A1';label='邻里中心报道记载正式揭牌启用';title='康养生活综合体';text=@('正式揭牌启用');date='2025-10-28'},
      @{id='A2';label='长者预防保健区有健身及测量血压服务';title='康养生活综合体';text=@('健身','测量血压')},
      @{id='A3';label='对象为求是社区邻里中心，不转成单幢养老床位数';title='康养生活综合体';text=@('浙大求是社区邻里中心','老年群体')}
    )},
    @{id='parking';title='停车对标及对象范围';question='作为对标依据，已入库的七堡停车场复合更新资料记载多少公交车位？该数据属于求是村还是七堡项目？';checks=@(
      @{id='P1';label='对标公交停保基地设置90个公交车位';title='存量焕新';text=@('90个公交车位')},
      @{id='P2';label='七堡项目城市背景不当作求是村泊位';title='存量焕新';text=@('七堡停车场');source_locator='city_background'}
    )}
  )
  $valueBaseline=$null
  if($BaselineEvidencePath){
    $valueBaseline=Get-Content -Raw -LiteralPath $BaselineEvidencePath|ConvertFrom-Json
    $valueSameQuestions=($valueCases.question|ConvertTo-Json -Compress) -eq ($valueBaseline.runs.question|ConvertTo-Json -Compress)
    $valueCheckSignatures=@(foreach($valueCase in $valueCases){foreach($valueCheck in $valueCase.checks){@($valueCheck.id,$valueCheck.label,$valueCheck.title,(@($valueCheck.text)-join '|'),$valueCheck.date,$valueCheck.source_locator)-join '::'}})
    $valueOldCheckSignatures=@(foreach($valueRun in $valueBaseline.runs){foreach($valueResult in $valueRun.checks){$valueCheck=$valueResult.expected;@($valueCheck.id,$valueCheck.label,$valueCheck.title,(@($valueCheck.text)-join '|'),$valueCheck.date,$valueCheck.source_locator)-join '::'}})
    $valueSameChecks=($valueCheckSignatures|ConvertTo-Json -Compress) -eq ($valueOldCheckSignatures|ConvertTo-Json -Compress)
    if(-not $valueSameQuestions -or -not $valueSameChecks -or $valueBaseline.project_id -ne $ProjectId -or $valueBaseline.context_version -ne $valueProject.context_version -or $valueBaseline.input_snapshot_sha256 -ne $valueInputHash){throw 'Comparison requires the same project, material version/hash, frozen questions and answer checks.'}
  }
  $valuePending=@();$valueContents=@()
  $valueTaskStarted=[DateTimeOffset]::UtcNow
  $valueTaskWatch=[Diagnostics.Stopwatch]::StartNew()
  $valueBatchWatch=[Diagnostics.Stopwatch]::StartNew()
  foreach($valueCase in $valueCases){
    $valueBody=@{question=$valueCase.question;include_ai=$false;source_kind='public_original';limit=5}|ConvertTo-Json -Compress
    $valueContent=[Net.Http.StringContent]::new($valueBody,[Text.Encoding]::UTF8,'application/json')
    $valueContents+=,$valueContent
    $valuePending+=,$valueClient.PostAsync("$valueBase/api/projects/$ProjectId/knowledge/retrieve",$valueContent)
  }
  # Launch the four identical-scope queries together. No sleeps or one-network-request-per-source baseline.
  $null=[Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]$valuePending).GetAwaiter().GetResult()
  $valueBatchWatch.Stop();$valueBatchEnded=[DateTimeOffset]::UtcNow
  $valueRuns=@();$valueTraceable=0;$valueChecks=0;$valueAuditedHits=0;$valueValidHits=0
  for($valueIndex=0;$valueIndex -lt $valueCases.Count;$valueIndex++){
    $valueCase=$valueCases[$valueIndex];$valueResponse=Read-ValueResponse $valuePending[$valueIndex]
    if($valueResponse.project_id -ne $ProjectId -or $valueResponse.fact_writes -ne 0){throw 'Unexpected retrieval project or write contract.'}
    $valueAudits=@();$valueRank=0
    foreach($valueHit in $valueResponse.hits){
      $valueRank++;$valueOriginal='';$valueExpectedVersion='';$valueRegistered=$null
      if($valueHit.evidence_kind -eq 'source_text'){
        $valueRegistered=$valueSourceMap[[string]$valueHit.source.id]
        if($valueRegistered){$valueOriginal=[string]$valueRegistered.untrusted_text;$valueExpectedVersion=if($valueRegistered.hash){$valueRegistered.hash}else{Get-ValueSha $valueOriginal}}
      }else{
        $valueDocument=$valueDocumentMap[[string]$valueHit.document_id]
        $valueRegistered=$valueSourceMap[[string]$valueHit.source.id]
        if($valueDocument){$valueOriginal=[string]$valueDocument.parser_result.text;$valueExpectedVersion=[string]$valueDocument.parser_result.source_hash}
      }
      $valueQuoteMatches=$valueOriginal.Length -gt 0 -and $valueOriginal.Contains([string]$valueHit.text)
      $valueVersionMatches=$valueExpectedVersion -and $valueExpectedVersion -eq $valueHit.version
      $valueScoped=$null -ne $valueRegistered -and $valueHit.source.visibility -eq 'public' -and -not $valueHit.source.synthetic
      $valueValid=$valueQuoteMatches -and $valueVersionMatches -and $valueScoped
      $valueAuditedHits++;if($valueValid){$valueValidHits++}
      $valueAudits+=,[ordered]@{rank=$valueRank;id=$valueHit.id;source_id=$valueHit.source.id;document_id=$valueHit.document_id;title=$valueHit.file_name;locator=$valueHit.locator;url=$valueHit.source.url;content_status=$valueHit.content_status;evidence_kind=$valueHit.evidence_kind;source_date=$valueHit.source_date;version=$valueHit.version;original_text_sha256=(Get-ValueSha $valueOriginal);quote_matches_saved_original=[bool]$valueQuoteMatches;version_matches=[bool]$valueVersionMatches;source_in_current_project=[bool]$valueScoped;valid=[bool]$valueValid;text=$valueHit.text;source_locator=$valueHit.source.locator}
    }
    $valueResults=@()
    foreach($valueCheck in $valueCase.checks){
      $valueChecks++
      $valueMatches=@($valueAudits|Where-Object{ $_.valid -and $_.title -match $valueCheck.title -and (Test-ValuePatterns $_.text $valueCheck.text) -and (-not $valueCheck.date -or $_.source_date -eq $valueCheck.date) -and (-not $valueCheck.source_locator -or $_.source_locator -match $valueCheck.source_locator) })
      if($valueMatches.Count){$valueTraceable++}
      $valueResults+=,[ordered]@{id=$valueCheck.id;label=$valueCheck.label;expected=$valueCheck;traceable=($valueMatches.Count -gt 0);matching_ranks=@($valueMatches|ForEach-Object{$_.rank});matching_source_ids=@($valueMatches|ForEach-Object{$_.source_id});matching_locators=@($valueMatches|ForEach-Object{$_.locator})}
    }
    $valueRuns+=,[ordered]@{id=$valueCase.id;title=$valueCase.title;question=$valueCase.question;request=@{include_ai=$false;source_kind='public_original';limit=5};checks=$valueResults;audited_hits=$valueAudits;response=$valueResponse}
  }
  # Check that the saved material snapshot stayed the same throughout the query and quotation audit.
  $valueAfter=Read-ValueResponse ($valueClient.GetAsync("$valueBase/api/projects/$ProjectId"))
  $valueSnapshotUnchanged=$valueAfter.context_version -eq $valueProject.context_version -and (Get-ValueSha ($valueAfter.input|ConvertTo-Json -Depth 100 -Compress)) -eq $valueInputHash
  $valueTaskWatch.Stop();$valueTaskEnded=[DateTimeOffset]::UtcNow
  if(-not $valueSnapshotUnchanged){throw 'Project material changed during the measured task; do not publish this run as a frozen-snapshot result.'}
  $valueInputSources=@($valueProject.input.sources)
  $valueDistinctBodies=@($valueInputSources|Where-Object{$_.visibility -eq 'public' -and $_.untrusted_text}|ForEach-Object{([string]$_.url)+'|'+(Get-ValueSha ([string]$_.untrusted_text))}|Select-Object -Unique).Count
  # This audit uses the preregistered check words against the saved inventory, outside the timed RAG task.
  # It distinguishes an unavailable source from an available original omitted by top-five retrieval.
  $valueMaterialAudit=@();$valueAvailableChecks=0
  foreach($valueCase in $valueCases){foreach($valueCheck in $valueCase.checks){
    $valueAvailable=@($valueInputSources|Where-Object{
      $_.visibility -eq 'public' -and $_.data_class -eq 'public' -and -not $_.synthetic -and $_.title -match $valueCheck.title -and
      (Test-ValuePatterns ([string]$_.untrusted_text) $valueCheck.text) -and
      (-not $valueCheck.date -or (Get-ValueDate $_.published_at) -eq $valueCheck.date) -and
      (-not $valueCheck.source_locator -or $_.locator -match $valueCheck.source_locator)
    }|Select-Object -First 1)
    if($valueAvailable.Count){$valueAvailableChecks++}
    $valueMaterialAudit+=,[ordered]@{check_id=$valueCheck.id;label=$valueCheck.label;present_in_saved_inventory=($valueAvailable.Count -gt 0);evidence=@($valueAvailable|ForEach-Object{@{source_id=$_.id;title=$_.title;url=$_.url;locator=$_.locator;content_status=$_.content_status;published_at=$_.published_at;quote=$_.untrusted_text;body_sha256=(Get-ValueSha ([string]$_.untrusted_text))}})}
  }}
  $valueOut=[ordered]@{
    schema='decision-value-campus-selftest/2';started_at=$valueStarted.ToString('o');ended_at=[DateTimeOffset]::UtcNow.ToString('o');endpoint=$valueBase;project_id=$ProjectId;context_version=$valueProject.context_version
    script=@{path='scripts/measure-decision-value.ps1';sha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();powershell_version=$PSVersionTable.PSVersion.ToString()};access=@{anonymous=$true;cookies=$false;explicit_proxy=$false;issued_model_generation_requests=0;issued_project_write_requests=0}
    operator='Codex automated public API operation and deterministic quotation/version audit';question_count=$valueCases.Count;source_registry_entries=$valueInputSources.Count;documents=$valueDocuments.Count;distinct_public_bodies_by_url_and_text_sha256=$valueDistinctBodies
    execution_condition='Single batch with services already running and materials parsed; inventory read before timing; no cache flush or forced cold start; no fastest-run selection.'
    input_snapshot_sha256=$valueInputHash;snapshot_hash_method='SHA-256 of UTF-8 PowerShell ConvertTo-Json project.input, depth 100, compressed; saved-body hashes are computed separately without JSON conversion.';snapshot_unchanged=$valueSnapshotUnchanged;source_status_counts=@($valueInputSources|Group-Object content_status|ForEach-Object{@{status=$_.Name;count=$_.Count}})
    measured_task=@{started_at=$valueTaskStarted.ToString('o');ended_at=$valueTaskEnded.ToString('o');elapsed_ms=[math]::Round($valueTaskWatch.Elapsed.TotalMilliseconds,3);scope='Four concurrent public RAG requests, response decoding, saved-original quote/version checks and final project-snapshot readback; excludes question design, source acquisition/import and human reading time.'}
    retrieval_batch=@{started_at=$valueTaskStarted.ToString('o');ended_at=$valueBatchEnded.ToString('o');elapsed_ms=[math]::Round($valueBatchWatch.Elapsed.TotalMilliseconds,3);concurrency=4;request_count=4;scope='Client wall-clock from launching four requests until all four HTTP response bodies arrived; not sum of serial latency and not human task time.'}
    correctness=@{factual_checks=$valueChecks;traceable_checks=$valueTraceable;omitted_checks=$valueChecks-$valueTraceable;audited_hits=$valueAuditedHits;quote_and_version_verified_hits=$valueValidHits;standard='Each check needs a top-five hit with current project source binding, same saved body/document version, a literal quote from that saved original and the registered scope/stage words. This checks traceability against saved texts/excerpts, not renewed publisher acquisition.'}
    saved_inventory_audit=@{performed_after_timing=$true;available_checks=$valueAvailableChecks;checks=$valueMaterialAudit;method='Direct saved-inventory text/metadata consistency audit using the same preregistered check words. This is not a blind retrieval baseline or human timing.'}
    runs=$valueRuns;prior_evidence=@{path='research/test_results/decision-value-selftest-20261015.json';sha256=$valueOldHash;automated_document_path_seconds=$valueOld.ui_operation.manual.seconds;automated_workbench_path_seconds=$valueOld.ui_operation.assisted.seconds;local_api_total_ms=$valueOld.total_service_ms;scope='Old two-document/two-question automated browser comparison; filter correction included in assisted path; no human participant.'}
    limitations=@('Single project and one batch; repeated/mirrored source registrations are not independent originals.','54万元 is checked against the already saved official-attachment excerpt; this run does not redownload or authenticate the original DOC.','Aging material refers to the Qiushi community neighborhood center; no bed count or single-building service effect is inferred.','Parking quantity belongs to the Qibao comparison project, not Qiushi village; no Qiushi parking-space total is established.','No human paired trial or human-hours saving is inferred; no model generation, login or project write is used.')
    source_inventory=@($valueInputSources|ForEach-Object{@{id=$_.id;title=$_.title;url=$_.url;locator=$_.locator;content_status=$_.content_status;published_at=$_.published_at;text_chars=([string]$_.untrusted_text).Length;registered_hash=$_.hash;text_sha256=(Get-ValueSha ([string]$_.untrusted_text))}})
    document_inventory=@($valueDocuments|ForEach-Object{@{id=$_.id;file_name=$_.file_name;parse_status=$_.parser_result.status;source_hash=$_.parser_result.source_hash;text_chars=([string]$_.parser_result.text).Length;text_sha256=(Get-ValueSha ([string]$_.parser_result.text))}})
  }
  if($valueBaseline){
    $valueOut.comparison=[ordered]@{baseline_path=$BaselineEvidencePath.Replace('\','/');baseline_sha256=(Get-FileHash -LiteralPath $BaselineEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant();same_frozen_questions=$true;same_material_snapshot=$true;before_traceable_checks=$valueBaseline.correctness.traceable_checks;after_traceable_checks=$valueTraceable;check_count=$valueChecks;before_batch_ms=$valueBaseline.retrieval_batch.elapsed_ms;after_batch_ms=$valueOut.retrieval_batch.elapsed_ms;interpretation='Same four-question single-project before/after record; not human performance, overall retrieval accuracy or a time-saving estimate.'}
  }
  $valueOut|ConvertTo-Json -Depth 100|Set-Content -LiteralPath $OutputPath -Encoding utf8
  if((Get-FileHash -LiteralPath $valueOldPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $valueOldHash){throw 'Prior raw evidence changed unexpectedly.'}
  if(-not $SkipDocumentUpdate){
    $valueRelative=([IO.Path]::GetRelativePath($valueRoot,[IO.Path]::GetFullPath($OutputPath))).Replace('\','/')
    $valueBatchSeconds=($valueOut.retrieval_batch.elapsed_ms/1000).ToString('F3',[Globalization.CultureInfo]::InvariantCulture)
    $valueTaskSeconds=($valueOut.measured_task.elapsed_ms/1000).ToString('F3',[Globalization.CultureInfo]::InvariantCulture)
    $valueCurrent="2026年10月15日，在校园服务器公开工作台的求是村资料v$($valueProject.context_version)上，面对$($valueInputSources.Count)条来源登记与$($valueDocuments.Count)份解析文档，固定供水、电梯、社区康养和停车对标四个问题。四请求并发返回前五条定位的批次耗时$valueBatchSeconds 秒；连同原文逐字核对、版本检查和项目快照复查，自动初核流程耗时$valueTaskSeconds 秒。预登记的$valueChecks 项范围、金额与阶段检查中，前五条命中支持$valueTraceable 项，另$($valueChecks-$valueTraceable)项未进入本次检索结果；$valueValidHits/$valueAuditedHits 条返回均通过当前项目原文与版本核对。来源登记含重复镜像，不能视为同等数量的独立原件。"
    $valueOmission="计时后按相同核对项直接查看已保存资料清单，$valueAvailableChecks/$valueChecks 项可在登记原文或摘录中找到。前五未命中项仍按检索遗漏记录，不改记为材料缺失，也不把计时后的已知词汇核对当作盲测或人工对照。"
    $valueComparison=if($valueBaseline){"同四问、同资料快照的前测支持$($valueBaseline.correctness.traceable_checks)/$valueChecks 项，本轮支持$valueTraceable/$valueChecks 项；前测记录原样保留。这一对照只描述该组问题的定位和遗漏变化，不外推为一般检索准确率。"}else{''}
    $valueScope='其中，252户仅对应29、30、31、48四幢的供水改造；54万元为75幢1单元电梯草案的估算摘录，不是结算。康养设施属于求是社区邻里中心；90个公交车位属于七堡对标项目，不转记为求是村泊位。该流程未重新采集或认证远端原件，材料获取真实性仍按原有来源记录核查。'
    $valueOldText="同日较早的两文档、两问题自动浏览器自测保留原记录：逐份查看耗时$($valueOld.ui_operation.manual.seconds)秒，工作台路径耗时$($valueOld.ui_operation.assisted.seconds)秒，后者包含一次筛选条件纠正；两次本地接口响应合计$($valueOld.total_service_ms)毫秒。两轮测量的资料范围、端点及操作不同，分别陈列，不用接口响应或自动操作时间推算人工节时率。人工配对任务仍需同问题、同资料包和同答案标准，并平衡操作次序。"
    $valueEvidence="本轮脚本为\path{scripts/measure-decision-value.ps1}；四问、预登记核对项、返回原文定位与版本及起止时间见\path{$valueRelative}，旧记录见\path{research/test_results/decision-value-selftest-20261015.json}。"
    if($valueBaseline){$valueBaselineRelative=([IO.Path]::GetRelativePath($valueRoot,[IO.Path]::GetFullPath($BaselineEvidencePath))).Replace('\','/');$valueEvidence+=" 同题前测见\path{$valueBaselineRelative}。"}
    $valueBrief="2026年10月15日，在校园服务器求是村资料v$($valueProject.context_version)的$($valueInputSources.Count)条来源登记、$($valueDocuments.Count)份解析文档上，固定供水、电梯、社区康养和停车对标四个问题、$valueChecks 项核对标准。服务已运行、资料已解析且未清缓存的单批次中，四请求并发定位耗时$valueBatchSeconds 秒；加上原文逐字核对、版本检查和资料快照复查，自动流程耗时$valueTaskSeconds 秒，前五条结果支持$valueTraceable/$valueChecks 项核对，返回的$valueValidHits/$valueAuditedHits 条片段可回到当前资料版本。"
    $valueBriefComparison=if($valueBaseline){"相同问题与资料快照的前测为$($valueBaseline.correctness.traceable_checks)/$valueChecks 项，本轮为$valueTraceable/$valueChecks 项，前后原始记录及遗漏项保留在附录。"}else{'问题、核对清单及未命中项保留在附录。'}
    $valueTiming="\subsection{公开工作台四主题资料初核自测}`n$valueBrief`n`n$valueBriefComparison 该数值为自动流程自测；人工配对评测按上表执行。`n"
    [IO.File]::WriteAllText((Join-Path $valueRoot 'docs/generated/decision-value-timing.tex'),$valueTiming,[Text.UTF8Encoding]::new($false))
    $valueAppendix=Join-Path $valueRoot 'docs/generated/decision-science-appendix.tex'
    $valueAppendixText=[IO.File]::ReadAllText($valueAppendix)
    $valuePattern='(?s)\\subsection\{操作自测口径与原始计时\}.*?(?=\\subsection\{)'
    if(-not [regex]::IsMatch($valueAppendixText,$valuePattern)){throw 'Timing subsection anchor missing; do not modify other appendix sections.'}
    $valueReplacement="\subsection{操作自测口径与原始计时}`n`n$valueCurrent`n`n$valueComparison`n$valueOmission`n`n$valueScope`n`n$valueOldText`n`n$valueEvidence`n`n"
    [IO.File]::WriteAllText($valueAppendix,[regex]::Replace($valueAppendixText,$valuePattern,[Text.RegularExpressions.MatchEvaluator]{param($valueMatch)$valueReplacement},1),[Text.UTF8Encoding]::new($false))
  }
  $valueRuns|ForEach-Object{Write-Output "$($_.title): $(@($_.checks|Where-Object{$_.traceable}).Count)/$($_.checks.Count) checks traceable; $($_.audited_hits.Count) returned hits"}
  Write-Output "Batch=$($valueOut.retrieval_batch.elapsed_ms) ms; query+audit=$($valueOut.measured_task.elapsed_ms) ms; checks=$valueTraceable/$valueChecks; literal/version hits=$valueValidHits/$valueAuditedHits"
  Write-Output "Evidence: $OutputPath"
}finally{foreach($valueContent in $valueContents){$valueContent.Dispose()};$valueClient.Dispose();$valueHandler.Dispose()}
