param(
  [string]$OutputDir = "",
  [switch]$OpenAIOnly,
  [switch]$GitHubOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Net.Http

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $PSScriptRoot "..\tmp-smoke"
}

$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

function Get-GitHubModelsToken {
  if (-not [string]::IsNullOrWhiteSpace($env:COURSEFORGE_GITHUB_TOKEN)) {
    return $env:COURSEFORGE_GITHUB_TOKEN.Trim()
  }

  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    return $env:GITHUB_TOKEN.Trim()
  }

  try {
    $token = gh auth token 2>$null
    if (-not [string]::IsNullOrWhiteSpace($token)) {
      return $token.Trim()
    }
  } catch {
    return ""
  }

  return ""
}

function New-SmokeImage {
  param(
    [string]$TargetPath
  )

  Add-Type -AssemblyName System.Drawing

  $bitmap = New-Object System.Drawing.Bitmap 1400, 900
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::FromArgb(250, 244, 235))

    $titleFont = New-Object System.Drawing.Font("Segoe UI", 38, [System.Drawing.FontStyle]::Bold)
    $subtitleFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Regular)
    $metaFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $bodyBrush = [System.Drawing.Brushes]::Black
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(196, 68, 21))

    $graphics.FillEllipse($accentBrush, 880, 120, 320, 320)
    $graphics.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(32, 32, 40))), 80, 580, 1240, 210)
    $graphics.DrawString("Student Edition", $metaFont, $bodyBrush, 930, 70)
    $graphics.DrawString("Inspire Physical Science", $titleFont, [System.Drawing.Brushes]::White, 120, 630)
    $graphics.DrawString("with Earth Science", $subtitleFont, [System.Drawing.Brushes]::White, 125, 705)
    $graphics.DrawString("McGraw Hill", $metaFont, [System.Drawing.Brushes]::White, 124, 760)
    $graphics.DrawString("CourseForge OCR smoke test image", $metaFont, $bodyBrush, 80, 60)

    $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Convert-ImageToDataUrl {
  param(
    [string]$ImagePath
  )

  $bytes = [System.IO.File]::ReadAllBytes($ImagePath)
  $base64 = [System.Convert]::ToBase64String($bytes)
  return "data:image/png;base64,$base64"
}

function Get-ResponseSnippet {
  param(
    [string]$Body
  )

  if ([string]::IsNullOrWhiteSpace($Body)) {
    return ""
  }

  try {
    $parsed = $Body | ConvertFrom-Json -ErrorAction Stop
    if ($parsed.error -and $parsed.error.message) {
      return [string]$parsed.error.message
    }
    if ($parsed.message) {
      return [string]$parsed.message
    }
  } catch {
  }

  if ($Body.Length -gt 240) {
    return $Body.Substring(0, 240)
  }

  return $Body
}

function Test-UsableText {
  param(
    [string]$Text
  )

  $expectedKeywords = @("Inspire", "Physical", "Science", "Earth", "Student")
  $matches = @($expectedKeywords | Where-Object { $Text -match [Regex]::Escape($_) })
  return $matches.Count -ge 3
}

function Invoke-OcrProviderSmoke {
  param(
    [hashtable]$Provider,
    [string]$ImageDataUrl
  )

  $result = [ordered]@{
    providerId = $Provider.ProviderId
    providerLabel = $Provider.ProviderLabel
    endpoint = $Provider.Endpoint
    model = $Provider.Model
    success = $false
    reasonCode = $null
    message = $null
    httpStatus = $null
    extractedText = $null
    stage = [ordered]@{
      requestPrepared = $false
      requestSent = $false
      responseReceived = $false
      providerExecuted = $false
      responseParsed = $false
      usableTextValidated = $false
    }
  }

  if ([string]::IsNullOrWhiteSpace($Provider.Token)) {
    $result.reasonCode = "missing_token"
    $result.message = $Provider.MissingTokenMessage
    return $result
  }

  $payload = @{
    model = $Provider.Model
    messages = @(
      @{
        role = "system"
        content = "You perform OCR from educational screenshots. Return only the extracted text with original line breaks, no commentary."
      },
      @{
        role = "user"
        content = @(
          @{
            type = "text"
            text = "Extract all readable text from this screenshot. Return plain text only."
          },
          @{
            type = "image_url"
            image_url = @{
              url = $ImageDataUrl
              detail = "high"
            }
          }
        )
      }
    )
    max_tokens = 1200
    temperature = 0
  } | ConvertTo-Json -Depth 10

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(60)
  try {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $Provider.Endpoint)
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Provider.Token)
    foreach ($headerName in $Provider.Headers.Keys) {
      $request.Headers.TryAddWithoutValidation($headerName, [string]$Provider.Headers[$headerName]) | Out-Null
    }

    $request.Content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, "application/json")
    $result.stage.requestPrepared = $true
    $result.stage.requestSent = $true

    try {
      $response = $client.SendAsync($request).GetAwaiter().GetResult()
    } catch {
      $result.reasonCode = "request_failed"
      $result.message = $_.Exception.Message
      return $result
    }

    $result.stage.responseReceived = $true
    $result.stage.providerExecuted = $true
    $result.httpStatus = [int]$response.StatusCode
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
      $result.reasonCode = if ($result.httpStatus -eq 401 -or $result.httpStatus -eq 403) {
        "auth_failed"
      } elseif ($result.httpStatus -eq 429) {
        "rate_limited"
      } elseif ($result.httpStatus -eq 422) {
        "request_rejected"
      } else {
        "provider_error"
      }
      $result.message = Get-ResponseSnippet -Body $body
      return $result
    }

    try {
      $parsed = $body | ConvertFrom-Json -ErrorAction Stop
      $result.stage.responseParsed = $true
    } catch {
      $result.reasonCode = "invalid_json"
      $result.message = $_.Exception.Message
      return $result
    }

    $text = [string]$parsed.choices[0].message.content
    if ([string]::IsNullOrWhiteSpace($text)) {
      $result.reasonCode = "empty_text"
      $result.message = "Provider returned empty OCR text."
      return $result
    }

    $trimmedText = $text.Trim()
    $result.extractedText = $trimmedText
    if (-not (Test-UsableText -Text $trimmedText)) {
      $result.reasonCode = "unusable_text"
      $result.message = "Provider returned text, but it did not contain the expected textbook keywords."
      return $result
    }

    $result.stage.usableTextValidated = $true
    $result.success = $true
    $result.reasonCode = "ok"
    $result.message = "Provider returned usable OCR text."
    return $result
  } finally {
    $client.Dispose()
  }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$imagePath = Join-Path $resolvedOutputDir "ocr-smoke-$timestamp.png"
New-SmokeImage -TargetPath $imagePath
$imageDataUrl = Convert-ImageToDataUrl -ImagePath $imagePath

$openAiToken = if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { "" } else { $env:OPENAI_API_KEY.Trim() }
$gitHubToken = Get-GitHubModelsToken

$providers = @(
  [ordered]@{
    ProviderId = "cloud_openai_vision"
    ProviderLabel = "Cloud OCR (OpenAI Vision)"
    Endpoint = "https://api.openai.com/v1/chat/completions"
    Model = "gpt-4o-mini"
    Token = $openAiToken
    MissingTokenMessage = "OPENAI_API_KEY is missing from the local environment."
    Headers = @{}
  },
  [ordered]@{
    ProviderId = "cloud_github_models_vision"
    ProviderLabel = "Cloud OCR (GitHub Models Vision)"
    Endpoint = "https://models.github.ai/inference/chat/completions"
    Model = "openai/gpt-4.1"
    Token = $gitHubToken
    MissingTokenMessage = "COURSEFORGE_GITHUB_TOKEN, GITHUB_TOKEN, or gh auth token is missing for GitHub Models."
    Headers = @{
      Accept = "application/vnd.github+json"
      "X-GitHub-Api-Version" = "2026-03-10"
    }
  }
)

if ($OpenAIOnly) {
  $providers = @($providers | Where-Object { $_.ProviderId -eq "cloud_openai_vision" })
}

if ($GitHubOnly) {
  $providers = @($providers | Where-Object { $_.ProviderId -eq "cloud_github_models_vision" })
}

$results = @()
foreach ($provider in $providers) {
  $results += Invoke-OcrProviderSmoke -Provider $provider -ImageDataUrl $imageDataUrl
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  imagePath = $imagePath
  providers = $results
}

$reportPath = Join-Path $resolvedOutputDir "ocr-smoke-report-$timestamp.json"
$report | ConvertTo-Json -Depth 10 | Set-Content -Path $reportPath -Encoding UTF8

foreach ($result in $results) {
  $statusText = if ($null -eq $result.httpStatus) { "n/a" } else { [string]$result.httpStatus }
  Write-Host ("[{0}] success={1} status={2} reason={3}" -f $result.providerId, $result.success, $statusText, $result.reasonCode)
  if ($result.message) {
    Write-Host ("  {0}" -f $result.message)
  }
}

Write-Host ("Smoke report: {0}" -f $reportPath)

if (($results | Where-Object { -not $_.success }).Count -gt 0) {
  exit 1
}

exit 0