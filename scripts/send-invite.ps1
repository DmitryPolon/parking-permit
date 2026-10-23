param(
  [Parameter(Mandatory = $true)][string]$To,
  [Parameter(Mandatory = $true)][string]$Tenant,
  [Parameter(Mandatory = $true)][string]$Link,
  [string]$Password = ''
)

$ErrorActionPreference = 'Stop'

if ($To -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Enter an email address' }
if ($Tenant.Length -lt 1 -or $Tenant.Length -gt 80) { throw 'Tenant name is not valid' }
if ($Link -notmatch '^https?://[^/\s]+/admin$') { throw 'Sign-in link is not valid' }
if ($Password -and $Password -notmatch '^[A-Za-z0-9]{8,32}$') { throw 'Temporary password is not valid' }

$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'

function Read-EnvValue([string]$name) {
  $line = Get-Content $envFile | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
  if (-not $line) { return '' }
  return $line.Substring($name.Length + 1)
}

$mailHost = Read-EnvValue 'MAIL_HOST'
$mailPort = Read-EnvValue 'MAIL_PORT'
if (-not $mailPort) { $mailPort = '587' }
$mailUser = Read-EnvValue 'MAIL_USER'
$mailPassword = Read-EnvValue 'MAIL_PASSWORD'
$mailFrom = Read-EnvValue 'MAIL_FROM'
if (-not $mailFrom) { throw 'Set MAIL_FROM to send mail' }

$subject = "You are invited to $Tenant"
$body = if ($Password) {
  "You can manage parking permits for $Tenant.`r`n`r`nSign in: $Link`r`nEmail: $To`r`n`r`nTemporary password:`r`n$Password`r`n`r`nChange this password after you sign in."
} else {
  "You can manage parking permits for $Tenant.`r`n`r`nSign in: $Link`r`nEmail: $To`r`n`r`nUse the password you already have."
}

if ($mailHost) {
  if (-not $mailUser -or -not $mailPassword) { throw "Set MAIL_USER and MAIL_PASSWORD to send through $mailHost" }
  $client = [System.Net.Mail.SmtpClient]::new($mailHost, [int]$mailPort)
  $client.EnableSsl = $true
  $client.Credentials = [System.Net.NetworkCredential]::new($mailUser, $mailPassword)
  $message = [System.Net.Mail.MailMessage]::new($mailFrom, $To, $subject, $body)
  try { $client.Send($message) }
  finally {
    $message.Dispose()
    $client.Dispose()
  }
}
else {
  $outlookType = [Type]::GetTypeFromProgID('Outlook.Application')
  if (-not $outlookType) { throw 'Outlook is not installed on this computer.' }
  $outlook = [Activator]::CreateInstance($outlookType)
  try {
    $session = $outlook.GetNamespace('MAPI')
    $session.Logon('Outlook', [Type]::Missing, $false, $true)
    $message = $outlook.CreateItem(0)
    $message.To = $To
    $message.Subject = $subject
    $message.Body = $body
    $accounts = $session.Accounts
    $matched = $false
    for ($index = 1; $index -le $accounts.Count; $index++) {
      $account = $accounts.Item($index)
      if ([string]$account.SmtpAddress -eq $mailFrom) {
        $message.SendUsingAccount = $account
        $matched = $true
        break
      }
    }
    if (-not $matched) { throw "Outlook has no account for $mailFrom" }
    $message.Send()
  }
  finally {
    if ($outlook) { [Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null }
  }
}

Write-Output '{"sent":true}'
