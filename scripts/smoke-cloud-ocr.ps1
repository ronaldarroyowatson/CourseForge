param(
  [string]$OutputDir = "",
  [string]$CopyrightImagePath = "",
  [string]$TocImagePath = "",
  [string]$TocImagePath2 = "",
  [switch]$OpenAIOnly,
  [switch]$GitHubOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $PSScriptRoot "..\tmp-smoke"
}

function Resolve-AbsolutePathSafe {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    throw "Path value cannot be empty."
  }

  $normalized = $PathValue.Trim()
  if ($normalized.StartsWith('"') -and $normalized.EndsWith('"') -and $normalized.Length -gt 1) {
    $normalized = $normalized.Substring(1, $normalized.Length - 2)
  }

  return [System.IO.Path]::GetFullPath($normalized)
}

$resolvedOutputDir = Resolve-AbsolutePathSafe -PathValue $OutputDir
New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

function Get-GitHubModelsToken {
  if (-not [string]::IsNullOrWhiteSpace($env:COURSEFORGE_GITHUB_TOKEN)) { return $env:COURSEFORGE_GITHUB_TOKEN.Trim() }
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) { return $env:GITHUB_TOKEN.Trim() }
  try {
    $token = gh auth token 2>$null
    if (-not [string]::IsNullOrWhiteSpace($token)) { return $token.Trim() }
  } catch {}
  return ""
}

function Convert-ImageToDataUrl {
  param([string]$ImagePath)
  $bytes = [System.IO.File]::ReadAllBytes($ImagePath)
  $base64 = [System.Convert]::ToBase64String($bytes)
  return "data:image/png;base64,$base64"
}

function Get-ResponseSnippet {
  param([string]$Body)
  if ([string]::IsNullOrWhiteSpace($Body)) { return "" }

  try {
    $parsed = $Body | ConvertFrom-Json -ErrorAction Stop
    if ($parsed.error -and $parsed.error.message) { return [string]$parsed.error.message }
    if ($parsed.message) { return [string]$parsed.message }
  } catch {}

  if ($Body.Length -gt 300) { return $Body.Substring(0, 300) }
  return $Body
}

function Normalize-Isbn {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  return ($Value -replace "[^0-9Xx]", "").ToUpperInvariant()
}

function New-CopyrightSampleImage {
  param([string]$TargetPath)

  $bitmap = New-Object System.Drawing.Bitmap 2400, 2200
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::FromArgb(242, 242, 242))

    $body = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Regular)
    $title = New-Object System.Drawing.Font("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)

    $leftLines = @(
      "mheducation.com/prek-12",
      "Mc",
      "Graw",
      "Hill Copyright © 2021 McGraw-Hill Education",
      "All rights reserved. No part of this publication may be reproduced or distributed in any form or by any means, or stored in a database or retrieval system, without the prior written consent of McGraw-Hill Education, including, but not limited to, network storage or transmission, or broadcast for distance learning.",
      "",
      "Send all inquiries to:",
      "McGraw-Hill Education",
      "STEM Learning Solutions Center",
      "8787 Orion Place",
      "Columbus, OH 43240",
      "",
      "ISBN: 978-0-07-671685-2",
      "MHID: 0-07-671685-6",
      "",
      "Printed in the United States of America.",
      "3 4 5 6 7 8 LWI 24 23 22 21"
    )

    $rightLines = @(
      "STEM",
      "McGraw-Hill is committed to providing instructional materials in",
      "Science, Technology, Engineering, and Mathematics (STEM) that",
      "give all students a solid foundation, one that prepares them for",
      "college and careers in the 21st century."
    )

    $leftColumnX = 70
    $leftColumnWidth = 1140
    $rightColumnX = 1320
    $rightColumnWidth = 980

    $y = 70
    foreach ($line in $leftLines) {
      if ($line -eq "") { $y += 34; continue }
      $lineSize = $graphics.MeasureString($line, $body, $leftColumnWidth)
      $lineRect = New-Object System.Drawing.RectangleF -ArgumentList @(
        [single]$leftColumnX,
        [single]$y,
        [single]$leftColumnWidth,
        [single]([Math]::Ceiling($lineSize.Height) + 8)
      )
      $graphics.DrawString($line, $body, [System.Drawing.Brushes]::Black, $lineRect)
      $y += [Math]::Ceiling($lineSize.Height) + 10
    }

    $graphics.DrawString($rightLines[0], $title, [System.Drawing.Brushes]::Black, $rightColumnX, 120)
    $rightY = 220
    foreach ($line in $rightLines[1..($rightLines.Length - 1)]) {
      $lineSize = $graphics.MeasureString($line, $body, $rightColumnWidth)
      $lineRect = New-Object System.Drawing.RectangleF -ArgumentList @(
        [single]$rightColumnX,
        [single]$rightY,
        [single]$rightColumnWidth,
        [single]([Math]::Ceiling($lineSize.Height) + 8)
      )
      $graphics.DrawString($line, $body, [System.Drawing.Brushes]::Black, $lineRect)
      $rightY += [Math]::Ceiling($lineSize.Height) + 8
    }

    $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-TocSampleImage {
  param([string]$TargetPath)

  $bitmap = New-Object System.Drawing.Bitmap 2400, 2200
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::FromArgb(245, 245, 245))

    $titleFont = New-Object System.Drawing.Font("Consolas", 48, [System.Drawing.FontStyle]::Bold)
    $bodyFont = New-Object System.Drawing.Font("Consolas", 32, [System.Drawing.FontStyle]::Regular)

    $lines = @(
      "INTRODUCTION TO PHYSICAL SCIENCE",
      "MODULE 1: THE NATURE OF SCIENCE",
      "CER Claim, Evidence, Reasoning ........................................ 3",
      "Lesson 1 The Methods of Science ...................................... 4",
      "Lesson 2 Standards of Measurement ................................... 12",
      "Lesson 3 Communicating with Graphs ................................. 19",
      "Lesson 4 Science and Technology .................................... 24",
      "NATURE OF SCIENCE .................................................. 31",
      "Module Wrap-Up ..................................................... 33",
      "MODULE 2: MOTION",
      "CER Claim, Evidence, Reasoning ....................................... 37",
      "Lesson 1 Describing Motion .......................................... 38",
      "Lesson 2 Velocity and Momentum ...................................... 45",
      "Lesson 3 Acceleration ............................................... 50",
      "Module Wrap-Up ...................................................... 57",
      "MODULE 3: FORCES AND NEWTON'S LAWS",
      "CER Claim, Evidence, Reasoning ....................................... 59",
      "Lesson 1 Forces ..................................................... 60",
      "Lesson 2 Newton's Laws of Motion .................................... 68"
    )

    $graphics.DrawString("TABLE OF CONTENTS", $titleFont, [System.Drawing.Brushes]::Black, 70, 70)
    $y = 170
    foreach ($line in $lines) {
      $graphics.DrawString($line, $bodyFont, [System.Drawing.Brushes]::Black, 70, $y)
      $y += 70
    }

    $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Invoke-VisionOcr {
  param(
    [hashtable]$Provider,
    [string]$ImageDataUrl
  )

  $result = [ordered]@{
    providerId = $Provider.ProviderId
    success = $false
    reasonCode = $null
    message = $null
    httpStatus = $null
    extractedText = $null
  }

  if ([string]::IsNullOrWhiteSpace($Provider.Token)) {
    $result.reasonCode = "missing_token"
    $result.message = $Provider.MissingTokenMessage
    return $result
  }

  $payload = @{
    model = $Provider.OcrModel
    messages = @(
      @{
        role = "system"
        content = "You perform OCR from educational screenshots. Transcribe every readable character from the entire page. Preserve line breaks and include all columns, headers, footers, legal notices, addresses, URLs, ISBN/MHID lines, and image-credit text. For multi-column layouts, read left column top-to-bottom first, then right column top-to-bottom. Do not skip any section. Return plain text only."
      },
      @{
        role = "user"
        content = @(
          @{ type = "text"; text = "Extract ALL readable text from this screenshot. Include all legal text, right-column content, ISBN/MHID, address block, and bottom print codes. Return plain text only." },
          @{ type = "image_url"; image_url = @{ url = $ImageDataUrl; detail = "high" } }
        )
      }
    )
    max_tokens = 2500
    temperature = 0
  } | ConvertTo-Json -Depth 10

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(90)
  try {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $Provider.Endpoint)
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Provider.Token)
    foreach ($headerName in $Provider.Headers.Keys) {
      $request.Headers.TryAddWithoutValidation($headerName, [string]$Provider.Headers[$headerName]) | Out-Null
    }
    $request.Content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, "application/json")

    try {
      $response = $client.SendAsync($request).GetAwaiter().GetResult()
    } catch {
      $result.reasonCode = "request_failed"
      $result.message = $_.Exception.Message
      return $result
    }

    $result.httpStatus = [int]$response.StatusCode
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
      $result.reasonCode = if ($result.httpStatus -eq 401 -or $result.httpStatus -eq 403) {
        "auth_failed"
      } elseif ($result.httpStatus -eq 429) {
        "rate_limited"
      } else {
        "provider_error"
      }
      $result.message = Get-ResponseSnippet -Body $body
      return $result
    }

    try {
      $parsed = $body | ConvertFrom-Json -ErrorAction Stop
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

    $result.extractedText = $text.Trim()
    $result.success = $true
    $result.reasonCode = "ok"
    $result.message = "Provider returned OCR text."
    return $result
  } finally {
    $client.Dispose()
  }
}

function Invoke-MetadataAgent {
  param(
    [hashtable]$Provider,
    [string]$ImageDataUrl
  )

  $result = [ordered]@{
    providerId = $Provider.ProviderId
    success = $false
    reasonCode = $null
    message = $null
    httpStatus = $null
    metadata = $null
  }

  if ([string]::IsNullOrWhiteSpace($Provider.Token)) {
    $result.reasonCode = "missing_token"
    $result.message = $Provider.MissingTokenMessage
    return $result
  }

  $schemaPrompt = @(
    "Extract textbook metadata from this copyright-page image.",
    "Return strict JSON only with fields:",
    "title, subtitle, edition, publisher, publisherLocation, series, gradeLevel, subject, copyrightYear, isbn, platformUrl, mhid, rawText, confidence",
    "Use null for missing values."
  ) -join "`n"

  $payload = @{
    model = $Provider.MetadataModel
    response_format = @{ type = "json_object" }
    messages = @(
      @{ role = "system"; content = "You are a specialized textbook metadata extractor. Return strict JSON only." },
      @{ role = "user"; content = @(
          @{ type = "text"; text = $schemaPrompt },
          @{ type = "image_url"; image_url = @{ url = $ImageDataUrl; detail = "high" } }
        ) }
    )
    max_tokens = 1200
    temperature = 0
  } | ConvertTo-Json -Depth 12

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(90)
  try {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $Provider.Endpoint)
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Provider.Token)
    foreach ($headerName in $Provider.Headers.Keys) {
      $request.Headers.TryAddWithoutValidation($headerName, [string]$Provider.Headers[$headerName]) | Out-Null
    }
    $request.Content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, "application/json")

    try {
      $response = $client.SendAsync($request).GetAwaiter().GetResult()
    } catch {
      $result.reasonCode = "request_failed"
      $result.message = $_.Exception.Message
      return $result
    }

    $result.httpStatus = [int]$response.StatusCode
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
      $result.reasonCode = if ($result.httpStatus -eq 401 -or $result.httpStatus -eq 403) {
        "auth_failed"
      } elseif ($result.httpStatus -eq 429) {
        "rate_limited"
      } else {
        "provider_error"
      }
      $result.message = Get-ResponseSnippet -Body $body
      return $result
    }

    try {
      $parsed = $body | ConvertFrom-Json -ErrorAction Stop
      $content = [string]$parsed.choices[0].message.content
      $metadata = $content | ConvertFrom-Json -ErrorAction Stop
    } catch {
      $result.reasonCode = "invalid_json"
      $result.message = $_.Exception.Message
      return $result
    }

    $result.metadata = $metadata
    $result.success = $true
    $result.reasonCode = "ok"
    $result.message = "Provider returned metadata JSON."
    return $result
  } finally {
    $client.Dispose()
  }
}

function Test-CopyrightOcrCompleteness {
  param([string]$Text)

  $mustContain = @(
    "mheducation.com/prek-12",
    "Copyright",
    "2021",
    "Send all inquiries to:",
    "STEM Learning Solutions Center",
    "8787 Orion Place",
    "Columbus, OH 43240",
    "ISBN: 978-0-07-671685-2",
    "MHID: 0-07-671685-6",
    "Printed in the United States of America",
    "3 4 5 6 7 8 LWI 24 23 22 21",
    "Science, Technology, Engineering, and Mathematics"
  )

  $checks = @()
  foreach ($phrase in $mustContain) {
    $pattern = [Regex]::Escape($phrase).Replace("\\ ", "\\s+")
    $checks += [ordered]@{ phrase = $phrase; found = ($Text -match $pattern) }
  }

  $foundCount = (@($checks | Where-Object { $_.found })).Count
  $pct = [math]::Round(($foundCount / $mustContain.Count) * 100, 2)
  return [ordered]@{
    requiredPhraseCount = $mustContain.Count
    matchedPhraseCount = $foundCount
    completenessPercent = $pct
    checks = $checks
    passed = ($pct -eq 100)
  }
}

function Test-TocOcrCompleteness {
  param([string]$Text)

  $mustContain = @(
    "MODULE 1",
    "THE NATURE OF SCIENCE",
    "Lesson 1 The Methods of Science",
    "Lesson 2 Standards of Measurement",
    "MODULE 2",
    "Lesson 1 Describing Motion",
    "MODULE 3",
    "Lesson 2 Newton's Laws of Motion"
  )

  $checks = @()
  foreach ($phrase in $mustContain) {
    $pattern = [Regex]::Escape($phrase).Replace("\\ ", "\\s+")
    $checks += [ordered]@{ phrase = $phrase; found = ($Text -match $pattern) }
  }

  $foundCount = (@($checks | Where-Object { $_.found })).Count
  $pct = [math]::Round(($foundCount / $mustContain.Count) * 100, 2)
  return [ordered]@{
    requiredPhraseCount = $mustContain.Count
    matchedPhraseCount = $foundCount
    completenessPercent = $pct
    checks = $checks
    passed = ($pct -ge 87.5)
  }
}

function Test-ExpectedMetadata {
  param([object]$Metadata)

  $isbn = Normalize-Isbn -Value ([string]$Metadata.isbn)
  $publisherLocation = [string]$Metadata.publisherLocation
  $copyrightYear = [string]$Metadata.copyrightYear
  $platformUrl = [string]$Metadata.platformUrl
  $gradeLevel = [string]$Metadata.gradeLevel
  $mhid = [string]$Metadata.mhid
  $normalizedPublisherLocation = ($publisherLocation -replace "\s+", " ").Trim()
  $normalizedPlatformUrl = $platformUrl.ToLowerInvariant().Trim()
  $derivedGradeFromUrl = ($platformUrl -match "(?i)mheducation\.com/prek-12|/prek-12")
  $gradeLevelPass = ($gradeLevel -match "(?i)pre\s*-?k\s*-?12") -or $derivedGradeFromUrl

  $checks = @(
    [ordered]@{ field = "isbn"; required = $true; passed = ($isbn -eq "9780076716852"); actual = $isbn; expected = "9780076716852" },
    [ordered]@{ field = "publisherLocation"; required = $false; passed = $normalizedPublisherLocation.Contains("Columbus, OH 43240"); actual = $publisherLocation; expected = "contains Columbus, OH 43240" },
    [ordered]@{ field = "copyrightYear"; required = $true; passed = ($copyrightYear -eq "2021"); actual = $copyrightYear; expected = "2021" },
    [ordered]@{ field = "platformUrl"; required = $true; passed = $normalizedPlatformUrl.Contains("mheducation.com/prek-12"); actual = $platformUrl; expected = "contains mheducation.com/prek-12" },
    [ordered]@{ field = "gradeLevel"; required = $true; passed = $gradeLevelPass; actual = $gradeLevel; expected = "Pre-K-12 (or derivable from /prek-12 URL)" },
    [ordered]@{ field = "mhid"; required = $true; passed = ($mhid -match "0-07-671685-6"); actual = $mhid; expected = "0-07-671685-6" }
  )

  $requiredChecks = @($checks | Where-Object { $_.required -ne $false })

  return [ordered]@{
    passed = ((@($requiredChecks | Where-Object { -not $_.passed })).Count -eq 0)
    checks = $checks
  }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$sampleImagePath = if (-not [string]::IsNullOrWhiteSpace($CopyrightImagePath)) {
  Resolve-AbsolutePathSafe -PathValue $CopyrightImagePath
} else {
  $generatedCopyrightPath = Join-Path $resolvedOutputDir "ocr-smoke-copyright-$timestamp.png"
  New-CopyrightSampleImage -TargetPath $generatedCopyrightPath
  $generatedCopyrightPath
}

if (-not (Test-Path $sampleImagePath)) {
  throw "Copyright image not found: $sampleImagePath"
}

$imageDataUrl = Convert-ImageToDataUrl -ImagePath $sampleImagePath

$tocImagePaths = @()
if (-not [string]::IsNullOrWhiteSpace($TocImagePath)) {
  $tocImagePaths += Resolve-AbsolutePathSafe -PathValue $TocImagePath
}
if (-not [string]::IsNullOrWhiteSpace($TocImagePath2)) {
  $tocImagePaths += Resolve-AbsolutePathSafe -PathValue $TocImagePath2
}

if ($tocImagePaths.Count -eq 0) {
  $generatedTocPath = Join-Path $resolvedOutputDir "ocr-smoke-toc-$timestamp.png"
  New-TocSampleImage -TargetPath $generatedTocPath
  $tocImagePaths += $generatedTocPath
}

foreach ($tocPath in $tocImagePaths) {
  if (-not (Test-Path $tocPath)) {
    throw "TOC image not found: $tocPath"
  }
}

$openAiToken = if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { "" } else { $env:OPENAI_API_KEY.Trim() }
$gitHubToken = Get-GitHubModelsToken

$providers = @(
  [ordered]@{
    ProviderId = "cloud_openai_vision"
    ProviderLabel = "Cloud OCR + Metadata (OpenAI)"
    Endpoint = "https://api.openai.com/v1/chat/completions"
    OcrModel = "gpt-4o-mini"
    MetadataModel = "gpt-4o-mini"
    Token = $openAiToken
    MissingTokenMessage = "OPENAI_API_KEY is missing from local environment."
    Headers = @{}
  },
  [ordered]@{
    ProviderId = "cloud_github_models_vision"
    ProviderLabel = "Cloud OCR + Metadata (GitHub Models)"
    Endpoint = "https://models.github.ai/inference/chat/completions"
    OcrModel = "openai/gpt-4.1"
    MetadataModel = "openai/gpt-4.1"
    Token = $gitHubToken
    MissingTokenMessage = "COURSEFORGE_GITHUB_TOKEN/GITHUB_TOKEN/gh token missing."
    Headers = @{ Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2026-03-10" }
  }
)

if ($OpenAIOnly) { $providers = @($providers | Where-Object { $_.ProviderId -eq "cloud_openai_vision" }) }
if ($GitHubOnly) { $providers = @($providers | Where-Object { $_.ProviderId -eq "cloud_github_models_vision" }) }

$providerResults = @()
foreach ($provider in $providers) {
  $ocr = Invoke-VisionOcr -Provider $provider -ImageDataUrl $imageDataUrl
  $ocrCompleteness = $null
  if ($ocr.success -and -not [string]::IsNullOrWhiteSpace($ocr.extractedText)) {
    $ocrCompleteness = Test-CopyrightOcrCompleteness -Text $ocr.extractedText
  }

  $metadataAgent = Invoke-MetadataAgent -Provider $provider -ImageDataUrl $imageDataUrl
  $metadataChecks = $null
  if ($metadataAgent.success -and $metadataAgent.metadata) {
    $metadataChecks = Test-ExpectedMetadata -Metadata $metadataAgent.metadata
  }

  $tocSamples = @()
  foreach ($tocPath in $tocImagePaths) {
    $tocImageDataUrl = Convert-ImageToDataUrl -ImagePath $tocPath
    $tocBaseName = [System.IO.Path]::GetFileNameWithoutExtension($tocPath)
    $isSpreadViewSample = $tocBaseName -match "(?i)spread-view"
    $requiredForCompletenessGate = -not $isSpreadViewSample
    $requiredForParserGate = -not $isSpreadViewSample
    $tocOcr = Invoke-VisionOcr -Provider $provider -ImageDataUrl $tocImageDataUrl
    $tocOcrCompleteness = $null
    $tocParserValidation = $null

    if ($tocOcr.success -and -not [string]::IsNullOrWhiteSpace($tocOcr.extractedText)) {
      $tocOcrCompleteness = Test-TocOcrCompleteness -Text $tocOcr.extractedText

      $tocOcrPath = Join-Path $resolvedOutputDir ("toc-ocr-" + $provider.ProviderId + "-" + $tocBaseName + "-" + $timestamp + ".txt")
      Set-Content -Path $tocOcrPath -Value $tocOcr.extractedText -Encoding UTF8

      try {
        $parserRaw = & npx tsx scripts/validate-toc-parser.ts --ocr-file "$tocOcrPath" 2>&1
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1) {
          try {
            $tocParserValidation = $parserRaw -join "`n" | ConvertFrom-Json -ErrorAction Stop
          } catch {
            $tocParserValidation = [ordered]@{
              passed = $false
              error = "Failed to parse parser validator JSON output"
              raw = ($parserRaw -join "`n")
            }
          }
        } else {
          $tocParserValidation = [ordered]@{
            passed = $false
            error = "validate-toc-parser.ts failed"
            raw = ($parserRaw -join "`n")
          }
        }
      } catch {
        $tocParserValidation = [ordered]@{
          passed = $false
          error = $_.Exception.Message
        }
      }
    }

    $tocSamples += [ordered]@{
      imagePath = $tocPath
      requiredForCompletenessGate = $requiredForCompletenessGate
      requiredForParserGate = $requiredForParserGate
      tocOcr = $tocOcr
      tocOcrCompleteness = $tocOcrCompleteness
      tocParserValidation = $tocParserValidation
    }
  }

  $providerResults += [ordered]@{
    providerId = $provider.ProviderId
    providerLabel = $provider.ProviderLabel
    ocr = $ocr
    ocrCompleteness = $ocrCompleteness
    metadataAgent = $metadataAgent
    metadataValidation = $metadataChecks
    tocSamples = $tocSamples
  }
}

$ocrReachable = (@($providerResults | Where-Object { $_.ocr.success })).Count -gt 0
$metadataReachable = (@($providerResults | Where-Object { $_.metadataAgent.success })).Count -gt 0
$ocrCompletenessPassed = (@($providerResults | Where-Object { $_.ocrCompleteness -and $_.ocrCompleteness.passed })).Count -gt 0
$metadataValidationPassed = (@($providerResults | Where-Object { $_.metadataValidation -and $_.metadataValidation.passed })).Count -gt 0
$allTocSamples = @($providerResults | ForEach-Object { $_.tocSamples } | Where-Object { $_ })
$requiredTocOcrSamples = @($allTocSamples | Where-Object { $_.requiredForCompletenessGate })
$requiredTocParserSamples = @($allTocSamples | Where-Object { $_.requiredForParserGate })
$tocOcrReachable = (@($requiredTocOcrSamples | Where-Object { $_.tocOcr.success })).Count -gt 0
$tocOcrCompletenessPassed = (@($requiredTocOcrSamples | Where-Object { $_.tocOcrCompleteness -and $_.tocOcrCompleteness.passed })).Count -gt 0
$tocParserValidationPassed = (@($requiredTocParserSamples | Where-Object { $_.tocParserValidation -and $_.tocParserValidation.passed })).Count -gt 0

$missingData = @()
foreach ($provider in $providerResults) {
  if ($provider.metadataValidation) {
    foreach ($check in $provider.metadataValidation.checks) {
      $hasRequiredField = (($check -is [System.Collections.IDictionary]) -and $check.Contains("required")) -or ($check.PSObject.Properties.Name -contains "required")
      $isRequiredCheck = if ($hasRequiredField) { [bool]$check.required } else { $true }
      if ($isRequiredCheck -and -not $check.passed) {
        $hasActual = (($check -is [System.Collections.IDictionary]) -and $check.Contains("actual")) -or ($check.PSObject.Properties.Name -contains "actual")
        $hasExpected = (($check -is [System.Collections.IDictionary]) -and $check.Contains("expected")) -or ($check.PSObject.Properties.Name -contains "expected")
        $actualValue = if ($hasActual) { $check.actual } else { $null }
        $expectedValue = if ($hasExpected) { $check.expected } else { $null }
        $missingData += [ordered]@{
          providerId = $provider.providerId
          category = "metadata"
          field = $check.field
          actual = $actualValue
          expected = $expectedValue
        }
      }
    }
  }

  foreach ($tocSample in @($provider.tocSamples)) {
    if ($tocSample.requiredForParserGate -and $tocSample.tocParserValidation -and $tocSample.tocParserValidation.checks) {
      foreach ($check in $tocSample.tocParserValidation.checks) {
        if (-not $check.passed) {
          $hasActual = (($check -is [System.Collections.IDictionary]) -and $check.Contains("actual")) -or ($check.PSObject.Properties.Name -contains "actual")
          $hasExpected = (($check -is [System.Collections.IDictionary]) -and $check.Contains("expected")) -or ($check.PSObject.Properties.Name -contains "expected")
          $hasName = (($check -is [System.Collections.IDictionary]) -and $check.Contains("name")) -or ($check.PSObject.Properties.Name -contains "name")
          $actualValue = if ($hasActual) { $check.actual } else { $null }
          $expectedValue = if ($hasExpected) { $check.expected } else { $null }
          $fieldName = if ($hasName) { $check.name } else { "unknown" }
          $missingData += [ordered]@{
            providerId = $provider.providerId
            category = "toc_parser"
            sample = $tocSample.imagePath
            field = $fieldName
            actual = $actualValue
            expected = $expectedValue
          }
        }
      }
    }

    if ($tocSample.requiredForCompletenessGate -and $tocSample.tocOcrCompleteness -and -not $tocSample.tocOcrCompleteness.passed) {
      foreach ($phraseCheck in $tocSample.tocOcrCompleteness.checks) {
        if (-not $phraseCheck.found) {
          $missingData += [ordered]@{
            providerId = $provider.providerId
            category = "toc_ocr"
            sample = $tocSample.imagePath
            field = "phrase"
            actual = "missing"
            expected = $phraseCheck.phrase
          }
        }
      }
    }
  }
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  sampleImagePath = $sampleImagePath
  tocImagePaths = $tocImagePaths
  checks = [ordered]@{
    ocrAgentReachable = $ocrReachable
    metadataAgentReachable = $metadataReachable
    ocrCompletenessPassed = $ocrCompletenessPassed
    metadataValidationPassed = $metadataValidationPassed
    tocOcrAgentReachable = $tocOcrReachable
    tocOcrCompletenessPassed = $tocOcrCompletenessPassed
    tocParserValidationPassed = $tocParserValidationPassed
    missingDataCount = $missingData.Count
  }
  missingData = $missingData
  providers = $providerResults
}

$reportPath = Join-Path $resolvedOutputDir "ocr-smoke-report-$timestamp.json"
$report | ConvertTo-Json -Depth 14 | Set-Content -Path $reportPath -Encoding UTF8

foreach ($provider in $providerResults) {
  $ocrStatus = if ($provider.ocr.success) { "ok" } else { $provider.ocr.reasonCode }
  $metaStatus = if ($provider.metadataAgent.success) { "ok" } else { $provider.metadataAgent.reasonCode }
  Write-Host ("[{0}] OCR={1} MetadataAgent={2}" -f $provider.providerId, $ocrStatus, $metaStatus)
  if ($provider.ocrCompleteness) {
    Write-Host ("  OCR completeness: {0}% ({1}/{2})" -f $provider.ocrCompleteness.completenessPercent, $provider.ocrCompleteness.matchedPhraseCount, $provider.ocrCompleteness.requiredPhraseCount)
  }
  if ($provider.metadataValidation) {
    $failedChecks = @($provider.metadataValidation.checks | Where-Object { -not $_.passed })
    Write-Host ("  Metadata checks passed: {0}" -f ($failedChecks.Count -eq 0))
  }
  foreach ($tocSample in @($provider.tocSamples)) {
    $tocStatus = if ($tocSample.tocOcr.success) { "ok" } else { $tocSample.tocOcr.reasonCode }
    Write-Host ("  TOC sample: {0}" -f $tocSample.imagePath)
    Write-Host ("    TOC OCR={0}" -f $tocStatus)
    if ($tocSample.tocOcrCompleteness) {
      Write-Host ("    TOC OCR completeness: {0}% ({1}/{2})" -f $tocSample.tocOcrCompleteness.completenessPercent, $tocSample.tocOcrCompleteness.matchedPhraseCount, $tocSample.tocOcrCompleteness.requiredPhraseCount)
    }
    if ($tocSample.tocParserValidation) {
      Write-Host ("    TOC parser checks passed: {0}" -f $tocSample.tocParserValidation.passed)
    }
  }
}

if ($missingData.Count -gt 0) {
  $missingPath = Join-Path $resolvedOutputDir "ocr-smoke-missing-fields-$timestamp.json"
  ($missingData | ConvertTo-Json -Depth 14) | Set-Content -Path $missingPath -Encoding UTF8
  Write-Host ("Missing field report: {0}" -f $missingPath)
}

Write-Host ("Smoke report: {0}" -f $reportPath)

$overallPass = $ocrReachable -and $metadataReachable -and $ocrCompletenessPassed -and $metadataValidationPassed -and $tocOcrReachable -and $tocOcrCompletenessPassed -and $tocParserValidationPassed -and ($missingData.Count -eq 0)
if (-not $overallPass) {
  exit 1
}

exit 0
