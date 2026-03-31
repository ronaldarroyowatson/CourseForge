param(
  [string]$ImagePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

if ([string]::IsNullOrWhiteSpace($ImagePath) -or -not (Test-Path $ImagePath)) {
  throw "ImagePath is required and must exist."
}

function Get-GitHubModelsToken {
  if (-not [string]::IsNullOrWhiteSpace($env:COURSEFORGE_GITHUB_TOKEN)) { return $env:COURSEFORGE_GITHUB_TOKEN.Trim() }
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) { return $env:GITHUB_TOKEN.Trim() }
  try { $token = gh auth token 2>$null; if (-not [string]::IsNullOrWhiteSpace($token)) { return $token.Trim() } } catch {}
  return ""
}

function Invoke-MetadataAgent {
  param(
    [string]$ProviderId,
    [string]$Endpoint,
    [string]$Model,
    [string]$Token,
    [hashtable]$ExtraHeaders,
    [string]$ImageDataUrl
  )

  $result = [ordered]@{ providerId = $ProviderId; success = $false; status = $null; message = $null; metadata = $null }
  if ([string]::IsNullOrWhiteSpace($Token)) {
    $result.message = "missing_token"
    return $result
  }

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(90)
  try {
    $schemaText = @(
      "Extract textbook metadata from this image. Return JSON with these fields (all as strings except confidence, or null if not found):",
      "title, subtitle, edition, publisher, publisherLocation, series, gradeLevel, subject, copyrightYear, isbn, platformUrl, mhid, rawText, confidence",
      "Rules:",
      "- For copyrightPage images, prioritize copyright year, ISBN, publisher address, URL/domain, and identifier lines.",
      "- Preserve meaningful line breaks in rawText.",
      "- Return strict JSON only."
    ) -join "\n"

    $payload = @{
      model = $Model
      response_format = @{ type = "json_object" }
      messages = @(
        @{ role = "system"; content = "You are a specialized textbook metadata extractor. Extract textbook metadata from cover and copyright-page images with high precision. Return strict JSON only, no markdown fences or extra text." },
        @{ role = "user"; content = @(
            @{ type = "text"; text = $schemaText },
            @{ type = "image_url"; image_url = @{ url = $ImageDataUrl; detail = "high" } }
          ) }
      )
      temperature = 0
      max_tokens = 1200
    } | ConvertTo-Json -Depth 12

    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $Endpoint)
    $req.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
    foreach ($h in $ExtraHeaders.Keys) {
      $req.Headers.TryAddWithoutValidation($h, [string]$ExtraHeaders[$h]) | Out-Null
    }
    $req.Content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, "application/json")

    $resp = $client.SendAsync($req).GetAwaiter().GetResult()
    $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $result.status = [int]$resp.StatusCode

    if (-not $resp.IsSuccessStatusCode) {
      $result.message = $body
      return $result
    }

    $parsed = $body | ConvertFrom-Json
    $content = [string]$parsed.choices[0].message.content
    if ([string]::IsNullOrWhiteSpace($content)) {
      $result.message = "empty_content"
      return $result
    }

    try {
      $result.metadata = $content | ConvertFrom-Json
      $result.success = $true
      $result.message = "ok"
      return $result
    } catch {
      $result.message = "invalid_json_content: " + $_.Exception.Message
      return $result
    }
  } finally {
    $client.Dispose()
  }
}

$bytes = [System.IO.File]::ReadAllBytes($ImagePath)
$imageDataUrl = "data:image/png;base64," + [Convert]::ToBase64String($bytes)

$openAiToken = if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { "" } else { $env:OPENAI_API_KEY.Trim() }
$gitHubToken = Get-GitHubModelsToken

$openAiResult = Invoke-MetadataAgent -ProviderId "openai_gpt4o_mini" -Endpoint "https://api.openai.com/v1/chat/completions" -Model "gpt-4o-mini" -Token $openAiToken -ExtraHeaders @{} -ImageDataUrl $imageDataUrl
$githubResult = Invoke-MetadataAgent -ProviderId "github_openai_gpt41" -Endpoint "https://models.github.ai/inference/chat/completions" -Model "openai/gpt-4.1" -Token $gitHubToken -ExtraHeaders @{ "Accept" = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2026-03-10" } -ImageDataUrl $imageDataUrl

$summary = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  imagePath = [System.IO.Path]::GetFullPath($ImagePath)
  openai = $openAiResult
  github = $githubResult
}

$reportPath = Join-Path (Split-Path -Parent $ImagePath) ("live-metadata-agent-report-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "METADATA_AGENT_REPORT: $reportPath"
Write-Host "OPENAI_STATUS: success=$($openAiResult.success) status=$($openAiResult.status)"
Write-Host "GITHUB_STATUS: success=$($githubResult.success) status=$($githubResult.status)"

if ($openAiResult.success -and $openAiResult.metadata) {
  $m = $openAiResult.metadata
  Write-Host "OPENAI_FIELDS: isbn=$($m.isbn) copyrightYear=$($m.copyrightYear) platformUrl=$($m.platformUrl) gradeLevel=$($m.gradeLevel)"
}
if ($githubResult.success -and $githubResult.metadata) {
  $m = $githubResult.metadata
  Write-Host "GITHUB_FIELDS: isbn=$($m.isbn) copyrightYear=$($m.copyrightYear) platformUrl=$($m.platformUrl) gradeLevel=$($m.gradeLevel)"
}

exit 0
