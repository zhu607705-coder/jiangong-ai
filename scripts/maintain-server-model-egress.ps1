[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
  [Parameter(ParameterSetName = 'Run')][switch]$Run,
  [Parameter(ParameterSetName = 'Install')][switch]$Install
)
$ErrorActionPreference = 'Stop'
if (-not $Run -and -not $Install) { Write-Output 'Use -Run to maintain the approved SSH forward, or -Install for current-user logon startup.'; return }

# This is the single approved server/proxy pair, not a general tunnel launcher.
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scriptFile = [IO.Path]::GetFullPath($PSCommandPath)
$knownHosts = [IO.Path]::GetFullPath((Join-Path $workspace '.cache/haizhizi-known-hosts'))
if ($knownHosts -ne 'D:\建工ai\.cache\haizhizi-known-hosts') { throw 'This script is scoped to the verified D:\建工ai workspace.' }
if (-not (Test-Path -LiteralPath $knownHosts -PathType Leaf)) { throw 'The previously verified SSH known-hosts file is required.' }
$sshExe = Join-Path ([Environment]::GetFolderPath('System')) 'OpenSSH/ssh.exe'
$sshKeygen = Join-Path ([Environment]::GetFolderPath('System')) 'OpenSSH/ssh-keygen.exe'
$hostKeys = & $sshKeygen -F 10.70.223.113 -f $knownHosts
if ($LASTEXITCODE -ne 0) { throw 'The approved host is missing from known-hosts.' }
$fingerprints = $hostKeys | & $sshKeygen -lf -
if ($LASTEXITCODE -ne 0 -or -not ($fingerprints -match [regex]::Escape('SHA256:cSL1ZahVyJgkLnPl0aLtu3AIs9/wvvJDP+GdiAA/1mk'))) { throw 'SSH host fingerprint mismatch.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'Haizhizi.ModelEgress'

if ($Install) {
  # The logon task must outlive Codex's disposable bundled runtime directory.
  $powerShellExe = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell/v1.0/powershell.exe'
  if (-not (Test-Path -LiteralPath $powerShellExe -PathType Leaf)) { throw 'The stable Windows PowerShell launcher is required.' }
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $scriptFile + '" -Run'
  $existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
  if ($existing -and (@($existing.Actions).Count -ne 1 -or $existing.Actions[0].Arguments -ne $arguments -or $existing.Principal.UserId -notin @($identity.Name, $identity.User.Value))) { throw 'A different task already uses this name; it was not replaced.' }
  $action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments -WorkingDirectory $workspace
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
  $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $null = Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Approved loopback-only SSH model egress for the Haizhizi server; requires this user and local proxy online.' -Force
  Start-ScheduledTask -TaskName $taskName -TaskPath '\'
  Write-Output "Installed current-user task $taskName. No password is stored; it runs only in this user's logged-on session."
  return
}

$mutex = [Threading.Mutex]::new($false, ('Global\HaizhiziModelEgress-' + $identity.User.Value))
$ownsMutex = $false
$tunnelProcess = $null
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { Write-Output 'The model-egress maintainer is already running for this user.'; return }
  $logDirectory = Join-Path $workspace '.cache/server-model-egress'
  $null = New-Item -ItemType Directory -Path $logDirectory -Force
  $statusLog = Join-Path $logDirectory 'status.log'
  function Write-EgressStatus([string]$Message) {
    if ((Test-Path -LiteralPath $statusLog) -and (Get-Item -LiteralPath $statusLog).Length -gt 1MB) {
      $recent = Get-Content -LiteralPath $statusLog -Tail 200
      Set-Content -LiteralPath $statusLog -Value $recent -Encoding utf8
    }
    Add-Content -LiteralPath $statusLog -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $Message) -Encoding utf8
  }
  function Test-LocalProxy {
    $client = [Net.Sockets.TcpClient]::new()
    try {
      $connection = $client.ConnectAsync('127.0.0.1', 7897)
      if (-not $connection.Wait(1500)) { return $false }
      $connection.GetAwaiter().GetResult()
      return $true
    } catch { return $false } finally { $client.Dispose() }
  }
  $sshArguments = @('-N', '-T', '-F', 'none', '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$knownHosts", '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ForwardAgent=no', '-o', 'PermitLocalCommand=no',
    '-R', '127.0.0.1:17897:127.0.0.1:7897', 'zhuhangcheng@10.70.223.113')
  $retrySeconds = 15
  Write-EgressStatus "Maintainer started; pid=$PID; fixed server loopback 17897 -> local loopback 7897."
  while ($true) {
    if (Test-LocalProxy) {
      $started = Get-Date
      try {
        $tunnelProcess = Start-Process -FilePath $sshExe -ArgumentList $sshArguments -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $logDirectory 'ssh-error.log') -RedirectStandardOutput (Join-Path $logDirectory 'ssh-output.log')
        Write-EgressStatus "SSH started; child_pid=$($tunnelProcess.Id). Port availability is not a model-health result."
        $tunnelProcess.WaitForExit()
        Write-EgressStatus "SSH exited; code=$($tunnelProcess.ExitCode)."
        if (((Get-Date) - $started).TotalSeconds -ge 60) { $retrySeconds = 15 }
      } catch { Write-EgressStatus 'SSH could not start; details remain in the local SSH error log.' }
      finally { if ($tunnelProcess) { if (-not $tunnelProcess.HasExited) { $tunnelProcess.Kill() }; $tunnelProcess.Dispose(); $tunnelProcess = $null } }
    } else { Write-EgressStatus 'Local proxy 127.0.0.1:7897 is unavailable; no SSH connection was started.' }
    Write-EgressStatus "Retry in $retrySeconds seconds."
    Start-Sleep -Seconds $retrySeconds
    $retrySeconds = [Math]::Min(60, $retrySeconds * 2)
  }
} finally {
  # Only a child created by this invocation may be stopped; existing SSH sessions are untouched.
  if ($tunnelProcess) { if (-not $tunnelProcess.HasExited) { $tunnelProcess.Kill() }; $tunnelProcess.Dispose() }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
