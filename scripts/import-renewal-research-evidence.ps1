param(
  [Parameter(Mandatory=$true)][string]$SourceFile,
  [string]$ProjectId = 'P-0529974d-63fe-4ae8-804d-e5efb049f60a',
  [string]$CredentialFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/server-admin-credentials.txt'),
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'research/test_results/renewal-research-import-20261015.json')
)
$ErrorActionPreference='Stop'
$base='http://10.70.223.113'
$session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
function Request-Workbench([string]$Path,$Body=$null) {
  $options=@{Uri=$base+$Path;WebSession=$session;NoProxy=$true;TimeoutSec=30;Headers=@{'X-Requested-With'='haizhizi'}}
  if($null-ne$Body){$options.Method='POST';$options.ContentType='application/json; charset=utf-8';$options.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 80 -Compress))}
  Invoke-RestMethod @options
}
$records=Get-Content -LiteralPath $SourceFile -Raw | ConvertFrom-Json
$items=if($records.items){@($records.items)}elseif($records.records){@($records.records)}elseif($records.sources){@($records.sources)}else{throw 'Expected items, records or sources in the evidence file.'}
$rows=[Collections.Generic.List[object]]::new()
try {
  $text=[IO.File]::ReadAllText($CredentialFile)
  $password=[regex]::Match($text,'(?m)^密码：([^\r\n]+)').Groups[1].Value
  if(-not$password){throw 'Credential file format is not recognized.'}
  $null=Request-Workbench '/api/auth/login' @{username='zhuhangcheng';password=$password}
  $text=$null;$password=$null
  $before=Request-Workbench "/api/projects/$ProjectId"
  $backup=Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/renewal-import-project-before.json'
  if(-not(Test-Path -LiteralPath $backup)){[IO.File]::WriteAllText($backup,($before|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))}
  foreach($item in $items){
    $source=if($item.source){$item.source}else{$item}
    if($source.visibility-ne'public'-or$source.data_class-ne'public'-or$source.synthetic-or-not$source.url-or-not$source.untrusted_text){throw 'Only source-backed public original text may be imported.'}
    $ingested=Request-Workbench '/api/intelligence/intake' @{source=$source}
    $projectIndex=Request-Workbench '/api/intelligence/projects'
    $current=@(foreach($candidate in $projectIndex){if($candidate.id -eq $ProjectId){$candidate}})
    if(@($current).Count-ne1){throw 'Expected one current target project.'}
    $attached=Request-Workbench "/api/intelligence/items/$($ingested.id)/attach" @{version=$ingested.version;project_id=$ProjectId;expected_input_hash=$current.input_hash}
    $rows.Add([ordered]@{source_id=$source.id;title=$source.title;url=$source.url;material_id=$ingested.id;version=$ingested.version;created=$ingested.created;attachment_status=$attached.status;attached_source_id=$attached.source_id})
  }
  $after=Request-Workbench "/api/projects/$ProjectId"
  if(($before.input.facts|ConvertTo-Json -Depth 100 -Compress)-ne($after.input.facts|ConvertTo-Json -Depth 100 -Compress)){throw 'Material import must not change project facts.'}
  $receipt=[ordered]@{checked_at=(Get-Date).ToUniversalTime().ToString('o');project_id=$ProjectId;source_file=$SourceFile;source_file_sha256=(Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256).Hash.ToLowerInvariant();context_version_before=$before.context_version;context_version_after=$after.context_version;source_count_before=@($before.input.sources).Count;source_count_after=@($after.input.sources).Count;fact_count=@($after.input.facts).Count;fact_writes=0;provider_calls=0;items=$rows}
  [IO.File]::WriteAllText($OutputPath,($receipt|ConvertTo-Json -Depth 40),[Text.UTF8Encoding]::new($false))
  [pscustomobject]@{Imported=$rows.Count;SourcesBefore=@($before.input.sources).Count;SourcesAfter=@($after.input.sources).Count;FactWrites=0;Evidence=$OutputPath}
} finally {
  $text=$null;$password=$null
  try{$null=Request-Workbench '/api/auth/logout' @{}}catch{Write-Warning 'Temporary import session will expire automatically.'}
}
