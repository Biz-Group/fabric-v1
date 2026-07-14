[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [Parameter(Mandatory = $true)]
  [string]$AccountName,

  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "none",
    "biotechnology",
    "consulting",
    "education",
    "finance",
    "food_and_beverage",
    "government",
    "healthcare",
    "insurance",
    "law",
    "manufacturing",
    "media",
    "nonprofit",
    "technology",
    "telecommunications",
    "sport_and_recreation",
    "real_estate",
    "retail",
    "other"
  )]
  [string]$Industry,

  [string]$SubscriptionId = (az account show --query id -o tsv),
  [string]$Location = "swedencentral",

  [ValidateRange(1, 1000000)]
  [int]$ClaudeCapacity = 1,

  [ValidateRange(1, 1000000)]
  [int]$SafetyCapacity = 10,

  [ValidateRange(1, 1000000)]
  [int]$FallbackCapacity = 10,

  [switch]$Apply
)

$ErrorActionPreference = "Stop"

function Assert-AzSuccess([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed (Azure CLI exit code $LASTEXITCODE)."
  }
}

function Get-Quota([object[]]$Usage, [string]$Name) {
  $entry = $Usage | Where-Object { $_.name.value -eq $Name } | Select-Object -First 1
  if (-not $entry) { return 0 }
  return [double]$entry.limit - [double]$entry.currentValue
}

function Get-ExistingCapacity([object[]]$Deployments, [string]$Name) {
  $entry = $Deployments | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if (-not $entry -or -not $entry.sku.capacity) { return 0 }
  return [double]$entry.sku.capacity
}

function Assert-Model(
  [object[]]$Catalog,
  [string]$Format,
  [string]$Name,
  [string]$Version,
  [string]$Sku
) {
  $entry = $Catalog | Where-Object {
    $_.model.format -eq $Format -and
    $_.model.name -eq $Name -and
    $_.model.version -eq $Version
  } | Select-Object -First 1

  if (-not $entry) {
    throw "$Format model $Name version $Version is not in the $Location catalog."
  }
  if (-not ($entry.model.skus.name -contains $Sku)) {
    throw "$Format model $Name version $Version does not support $Sku in $Location."
  }
}

function Set-Deployment([string]$Name, [hashtable]$Body) {
  $url = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.CognitiveServices/accounts/$AccountName/deployments/$Name`?api-version=2025-10-01-preview"
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  $bodyPath = [System.IO.Path]::GetTempFileName()

  try {
    [System.IO.File]::WriteAllText(
      $bodyPath,
      $json,
      [System.Text.UTF8Encoding]::new($false)
    )
    az rest `
      --method PUT `
      --url $url `
      --headers "Content-Type=application/json" `
      --body "@$bodyPath" `
      --only-show-errors `
      --output none
    Assert-AzSuccess "Deployment $Name"
  } finally {
    Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
  }

  $deadline = (Get-Date).AddMinutes(5)
  do {
    $state = az cognitiveservices account deployment show `
      --name $AccountName `
      --resource-group $ResourceGroup `
      --deployment-name $Name `
      --query properties.provisioningState `
      -o tsv
    Assert-AzSuccess "Read deployment $Name"
    if ($state -eq "Succeeded") { return }
    if ($state -eq "Failed") { throw "Deployment $Name failed." }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  throw "Deployment $Name did not finish within five minutes."
}

az account set --subscription $SubscriptionId
Assert-AzSuccess "Select subscription"

$account = az cognitiveservices account show `
  --name $AccountName `
  --resource-group $ResourceGroup `
  -o json | ConvertFrom-Json
Assert-AzSuccess "Read Foundry account"

if ($account.location -ne $Location) {
  throw "Account $AccountName is in $($account.location), not $Location."
}
if ($account.kind -ne "AIServices") {
  throw "Account $AccountName has kind $($account.kind), expected AIServices."
}

$catalog = az cognitiveservices model list `
  --location $Location `
  --subscription $SubscriptionId `
  -o json | ConvertFrom-Json
Assert-AzSuccess "Read model catalog"

Assert-Model $catalog "Anthropic" "claude-haiku-4-5" "2" "GlobalStandard"
Assert-Model $catalog "OpenAI" "gpt-5-nano" "2025-08-07" "GlobalStandard"
Assert-Model $catalog "OpenAI" "gpt-5-mini" "2025-08-07" "GlobalStandard"

$usage = az cognitiveservices usage list `
  --location $Location `
  --subscription $SubscriptionId `
  -o json | ConvertFrom-Json
Assert-AzSuccess "Read model quota"

$existingDeployments = az cognitiveservices account deployment list `
  --name $AccountName `
  --resource-group $ResourceGroup `
  -o json | ConvertFrom-Json
Assert-AzSuccess "Read existing deployments"

$claudeQuota = (Get-Quota $usage "AIServices.GlobalStandard.claude-haiku-4-5.Azure") +
  (Get-ExistingCapacity $existingDeployments "fabric-claude-haiku-4-5")
$nanoQuota = (Get-Quota $usage "OpenAI.GlobalStandard.gpt-5-nano") +
  (Get-ExistingCapacity $existingDeployments "fabric-description-safety")
$miniQuota = (Get-Quota $usage "OpenAI.GlobalStandard.gpt-5-mini") +
  (Get-ExistingCapacity $existingDeployments "fabric-gpt5-mini-fallback")

if ($claudeQuota -lt $ClaudeCapacity) {
  throw "Less than $ClaudeCapacity capacity units of Claude Haiku 4.5 quota are available."
}
if ($nanoQuota -lt $SafetyCapacity) {
  throw "Less than $SafetyCapacity capacity units of GPT-5 nano quota are available."
}
if ($miniQuota -lt $FallbackCapacity) {
  throw "Less than $FallbackCapacity capacity units of GPT-5 mini quota are available."
}

Write-Host "Validated deployment target:"
Write-Host "  Subscription: $SubscriptionId"
Write-Host "  Resource:     $ResourceGroup/$AccountName"
Write-Host "  Region:       $Location"
Write-Host "  Claude:       claude-haiku-4-5 v2 / GlobalStandard / capacity $ClaudeCapacity"
Write-Host "  Safety:       gpt-5-nano 2025-08-07 / GlobalStandard / capacity $SafetyCapacity"
Write-Host "  Fallback:     gpt-5-mini 2025-08-07 / GlobalStandard / capacity $FallbackCapacity"
Write-Host "  Industry:     $Industry"

if (-not $Apply) {
  Write-Host "Preview only. Re-run with -Apply after reviewing this target."
  exit 0
}

$tenantInfo = az rest `
  --method GET `
  --url "https://management.azure.com/tenants?api-version=2024-11-01" `
  --query "value[0].{countryCode:countryCode,displayName:displayName}" `
  -o json | ConvertFrom-Json
Assert-AzSuccess "Read tenant information"

if (-not $tenantInfo.countryCode -or -not $tenantInfo.displayName) {
  throw "Azure tenant country code or organization name is unavailable."
}

Set-Deployment "fabric-claude-haiku-4-5" @{
  sku = @{ name = "GlobalStandard"; capacity = $ClaudeCapacity }
  properties = @{
    model = @{ format = "Anthropic"; name = "claude-haiku-4-5"; version = "2" }
    modelProviderData = @{
      industry = $Industry
      countryCode = $tenantInfo.countryCode
      organizationName = $tenantInfo.displayName
    }
  }
}

Set-Deployment "fabric-description-safety" @{
  sku = @{ name = "GlobalStandard"; capacity = $SafetyCapacity }
  properties = @{
    model = @{ format = "OpenAI"; name = "gpt-5-nano"; version = "2025-08-07" }
    raiPolicyName = "Microsoft.DefaultV2"
    versionUpgradeOption = "NoAutoUpgrade"
  }
}

Set-Deployment "fabric-gpt5-mini-fallback" @{
  sku = @{ name = "GlobalStandard"; capacity = $FallbackCapacity }
  properties = @{
    model = @{ format = "OpenAI"; name = "gpt-5-mini"; version = "2025-08-07" }
    raiPolicyName = "Microsoft.DefaultV2"
    versionUpgradeOption = "NoAutoUpgrade"
  }
}

$endpoint = "https://$AccountName.services.ai.azure.com"

Write-Host "All three model deployments succeeded."
Write-Host "FOUNDRY_ENDPOINT=$endpoint"
Write-Host "Retrieve a key without printing it into documentation with:"
Write-Host "  az cognitiveservices account keys list --name $AccountName --resource-group $ResourceGroup --query key1 -o tsv"
