param(
  [string]$CredentialFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/server-admin-credentials.txt'),
  [string]$SchemaDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/server-schema'),
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/server-public-verification.json')
)
$ErrorActionPreference = 'Stop'
$base = 'http://10.70.223.113'
$projectId = 'P-0529974d-63fe-4ae8-804d-e5efb049f60a'
$checks = [ordered]@{}
function Assert-Status($Response, [int]$Expected, [string]$Name) {
  if ([int]$Response.StatusCode -ne $Expected) { throw "Unexpected HTTP status for $Name; expected $Expected, received $($Response.StatusCode)." }
  $checks[$Name] = [int]$Response.StatusCode
}
function Request-Server([string]$Path, [string]$Method = 'GET', $Body = $null, $Session = $null, $Headers = @{}) {
  $options = @{ Uri=$base+$Path; Method=$Method; NoProxy=$true; SkipHttpErrorCheck=$true; TimeoutSec=20; Headers=$Headers }
  if ($null -ne $Body) { $options.ContentType='application/json; charset=utf-8'; $options.Body=[Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30 -Compress)) }
  if ($null -ne $Session) { $options.WebSession=$Session }
  Invoke-WebRequest @options
}
$root = Request-Server '/'
Assert-Status $root 200 'public_root'
if ($root.Content -notmatch '<div id="root"></div>') { throw 'Public root did not serve the workbench.' }
$viewer = Request-Server '/api/session'
Assert-Status $viewer 200 'viewer_session'
if (($viewer.Content | ConvertFrom-Json).authentication.role -ne 'viewer' -or $viewer.Headers['Set-Cookie']) { throw 'Anonymous read received unexpected privileges or a session cookie.' }
$projects = Request-Server '/api/projects'
Assert-Status $projects 200 'public_projects'
$projectCount = @($projects.Content | ConvertFrom-Json).Count
Assert-Status (Request-Server '/api/projects' 'POST' @{} $null @{'X-Requested-With'='haizhizi'}) 403 'anonymous_project_write'
Assert-Status (Request-Server "/api/projects/$projectId/renewal-strategy" 'POST' @{} $null @{'X-Requested-With'='haizhizi'}) 403 'anonymous_model_generation'
Assert-Status (Request-Server '/api/admin/database-schema') 403 'anonymous_database_schema'
$query = @{ question='二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？'; include_ai=$false; limit=5 }
$retrieved = Request-Server "/api/projects/$projectId/knowledge/retrieve" 'POST' $query $null @{'X-Requested-With'='haizhizi'}
Assert-Status $retrieved 200 'public_original_retrieval'
$hitCount = @((($retrieved.Content | ConvertFrom-Json).hits)).Count
Assert-Status (Request-Server '/api/projects' 'GET' $null $null @{Origin='https://outside.example'}) 403 'untrusted_origin'
Assert-Status (Request-Server '/api/projects' 'GET' $null $null @{Host='outside.example'}) 403 'untrusted_host'
$credentialText = [IO.File]::ReadAllText($CredentialFile)
$passwordMatch = [regex]::Match($credentialText,'(?m)^密码：([^\r\n]+)')
if (-not $passwordMatch.Success) { throw 'Credential file format is not recognized.' }
$adminSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$login = Request-Server '/api/auth/login' 'POST' @{username='zhuhangcheng';password=$passwordMatch.Groups[1].Value} $adminSession @{'X-Requested-With'='haizhizi'}
$credentialText=$null; $passwordMatch=$null
Assert-Status $login 200 'administrator_login'
if (($login.Content | ConvertFrom-Json).authentication.role -ne 'admin') { throw 'Login did not establish administrator permissions.' }
$cookie = [string]$login.Headers['Set-Cookie']
if ($cookie -notmatch 'HttpOnly' -or $cookie -notmatch 'SameSite=Strict') { throw 'Expected session cookie protections are missing.' }
Assert-Status (Request-Server '/api/ready' 'GET' $null $adminSession) 200 'administrator_ready'
Assert-Status (Request-Server '/api/projects' 'POST' @{} $adminSession) 403 'administrator_csrf_guard'
$schemaResponse = Request-Server '/api/admin/database-schema' 'GET' $null $adminSession
Assert-Status $schemaResponse 200 'administrator_database_schema'
$schema = $schemaResponse.Content | ConvertFrom-Json
$null = New-Item -ItemType Directory -Path $SchemaDirectory -Force
[IO.File]::WriteAllText((Join-Path $SchemaDirectory 'schema.json'),$schemaResponse.Content,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $SchemaDirectory 'schema.sql'),$schema.sql,[Text.UTF8Encoding]::new($false))
$counts = [ordered]@{}
foreach($name in @('projects','documents','experience_cards')) { $counts[$name]=($schema.tables | Where-Object name -eq $name).row_count }
if ($counts.projects -ne $projectCount -or $counts.projects -ne 16 -or $counts.documents -ne 21 -or $counts.experience_cards -ne 28) { throw 'Server data inventory differs from the migrated workbench.' }
$reportPath='/deliverables/'+[Uri]::EscapeDataString('求是村_旧改深度调研与行动计划.pdf')
Assert-Status (Request-Server $reportPath 'HEAD') 200 'public_qiushi_report'
$oldCookie = $adminSession.Cookies.GetCookieHeader([Uri]$base)
Assert-Status (Request-Server '/api/auth/logout' 'POST' @{} $adminSession @{'X-Requested-With'='haizhizi'}) 200 'administrator_logout'
Assert-Status (Request-Server '/api/admin/database-schema' 'GET' $null $null @{Cookie=$oldCookie}) 403 'revoked_administrator_cookie'
Assert-Status (Request-Server '/api/projects' 'POST' @{} $null @{Cookie=$oldCookie;'X-Requested-With'='haizhizi'}) 403 'revoked_cookie_write'
$oldCookie=$null; $cookie=$null
$receipt=[ordered]@{
  schema='server-public-administrator-verification/1'; checked_at=(Get-Date).ToUniversalTime().ToString('o'); url=$base
  checks=$checks; public_project_count=$projectCount; original_retrieval_hits=$hitCount; database_counts=$counts
  database_tables=@($schema.tables).Count; database_sequences=@($schema.sequences).Count; database_schema_issues=$schema.issues
  schema_sha256=(Get-FileHash -LiteralPath (Join-Path $SchemaDirectory 'schema.sql') -Algorithm SHA256).Hash.ToLowerInvariant()
  mutation_scope='No project records changed; only login/logout. Data retrieval and schema export are read-only.'
  provider_calls='No DeepSeek or Qwen generation invoked.'
}
[IO.File]::WriteAllText($OutputPath,($receipt | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
Write-Output ([pscustomobject]@{Verified=$true;Url=$base;Projects=$projectCount;Tables=@($schema.tables).Count;SchemaIssues=@($schema.issues).Count;Evidence=$OutputPath})
