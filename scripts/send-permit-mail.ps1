param(
  [Parameter(Mandatory = $true)][string]$Code
)

$ErrorActionPreference = 'Stop'

if ($Code -notmatch '^[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$') {
  throw "Permit code is not valid"
}

$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'

function Read-EnvValue([string]$name) {
  $line = Get-Content $envFile | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
  if (-not $line) { return '' }
  $value = $line.Substring($name.Length + 1).Trim()
  if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Get-PgArgs {
  $direct = Read-EnvValue 'DATABASE_URL_UNPOOLED'
  if ($direct -match '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)') {
    $env:PGPASSWORD = [Uri]::UnescapeDataString($Matches[2])
    $env:PGSSLMODE = 'require'
    $pgPort = if ($Matches[4]) { $Matches[4] } else { '5432' }
    return @('-h', $Matches[3], '-p', $pgPort, '-U', [Uri]::UnescapeDataString($Matches[1]), '-d', $Matches[5])
  }
  $env:PGPASSWORD = Read-EnvValue 'PGPASSWORD'
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  return @('-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', 'parking')
}

$pg = Get-PgArgs
$mailHost = Read-EnvValue 'MAIL_HOST'
$mailPort = Read-EnvValue 'MAIL_PORT'
if (-not $mailPort) { $mailPort = '587' }
$mailUser = Read-EnvValue 'MAIL_USER'
$mailPassword = Read-EnvValue 'MAIL_PASSWORD'
$mailFrom = Read-EnvValue 'MAIL_FROM'
if (-not $mailFrom) { throw 'Set MAIL_FROM to send mail' }
$psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
$safeCode = $Code.ToUpper()

$query = @"
SELECT json_build_object(
  'email', m.email,
  'sent', m.sent_at IS NOT NULL,
  'image', encode(m.image, 'base64'),
  'event', e.name,
  'name', p.first_name || ' ' || p.last_name,
  'code', p.code
)
FROM permit_mail m
JOIN permits p ON p.id = m.permit_id
JOIN events e ON e.id = p.event_id
WHERE p.code = '$safeCode';
"@

$json = & $psql @pg -t -A -c $query
if (-not $json) { throw "No email copy is saved for this permit" }
$row = $json | ConvertFrom-Json
if ($row.sent) {
  Write-Output '{"sent":true,"already":true}'
  exit 0
}

$path = Join-Path $env:TEMP "permit-$safeCode.png"
[IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($row.image))
$subject = "Parking permit $($row.code)"
$body = "$($row.name), your parking permit for $($row.event) is attached.`r`n`r`nCode: $($row.code)"

try {
  if ($mailHost) {
    if (-not $mailUser -or -not $mailPassword) { throw "Set MAIL_USER and MAIL_PASSWORD to send through $mailHost" }
    $client = [System.Net.Mail.SmtpClient]::new($mailHost, [int]$mailPort)
    $client.EnableSsl = $true
    $client.Credentials = [System.Net.NetworkCredential]::new($mailUser, $mailPassword)
    $message = [System.Net.Mail.MailMessage]::new($mailFrom, [string]$row.email, $subject, $body)
    $message.Attachments.Add($path) | Out-Null
    try { $client.Send($message) }
    finally {
      $message.Dispose()
      $client.Dispose()
    }
  }
  else {
    $outlookType = [Type]::GetTypeFromProgID('Outlook.Application')
    if (-not $outlookType) { throw "Outlook is not installed on this computer." }
    $outlook = [Activator]::CreateInstance($outlookType)
    try {
      $session = $outlook.GetNamespace('MAPI')
      $session.Logon('Outlook', [Type]::Missing, $false, $true)
      $message = $outlook.CreateItem(0)
      $message.To = [string]$row.email
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
      $message.Attachments.Add($path) | Out-Null
      $message.Send()
    }
    finally {
      if ($outlook) { [Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null }
    }
  }
}
finally {
  Remove-Item $path -ErrorAction SilentlyContinue
}

$update = "UPDATE permit_mail m SET sent_at = now() FROM permits p WHERE p.id = m.permit_id AND p.code = '$safeCode' AND m.sent_at IS NULL;"
& $psql @pg -c $update | Out-Null
Write-Output '{"sent":true,"already":false}'
