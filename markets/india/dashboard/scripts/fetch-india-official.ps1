param(
  [Parameter(Mandatory = $false)]
  [datetime]$TradeDate = (Get-Date),

  [Parameter(Mandatory = $false)]
  [string]$OutRoot = "C:\Aurora\data\india\official"
)

$ErrorActionPreference = "Continue"
$SessionFolder = Join-Path $OutRoot $TradeDate.ToString("yyyyMMdd")
New-Item -ItemType Directory -Force -Path $SessionFolder | Out-Null

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Headers = @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
  "Accept"     = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  "Referer"    = "https://www.nseindia.com/all-reports"
}

$ddMMyyyy = $TradeDate.ToString("ddMMyyyy")
$yyyyMMdd = $TradeDate.ToString("yyyyMMdd")
$ddMMyy = $TradeDate.ToString("ddMMyy")

$Reports = @(
  @{
    Name = "NSE_Full_Price_Volume_Delivery"
    Url  = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_$ddMMyyyy.csv"
    Out  = Join-Path $SessionFolder "NSE_Full_Price_Volume_Delivery_$ddMMyyyy.csv"
  },
  @{
    Name = "NSE_MTO_Delivery"
    Url  = "https://nsearchives.nseindia.com/archives/equities/mto/MTO_$ddMMyyyy.DAT"
    Out  = Join-Path $SessionFolder "NSE_MTO_Delivery_$ddMMyyyy.DAT"
  },
  @{
    Name = "NSE_UDiFF_Bhavcopy"
    Url  = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyyMMdd}_F_0000.csv.zip"
    Out  = Join-Path $SessionFolder "NSE_UDiFF_Bhavcopy_$yyyyMMdd.zip"
  },
  @{
    Name = "BSE_Equity_Bhavcopy_ISIN"
    Url  = "https://www.bseindia.com/download/BhavCopy/Equity/EQ_ISINCODE_$ddMMyy.zip"
    Out  = Join-Path $SessionFolder "BSE_Equity_Bhavcopy_ISIN_$ddMMyy.zip"
  }
)

foreach ($Report in $Reports) {
  try {
    Write-Host "Downloading $($Report.Name)..."
    Invoke-WebRequest -Uri $Report.Url -OutFile $Report.Out -Headers $Headers -TimeoutSec 90
    $Item = Get-Item $Report.Out
    if ($Item.Length -lt 1024) {
      Write-Warning "Downloaded file is unusually small: $($Report.Out)"
    } else {
      Write-Host "Saved: $($Report.Out) ($($Item.Length) bytes)"
    }
  } catch {
    Write-Warning "Failed: $($Report.Name) | $($_.Exception.Message)"
  }
}

Write-Host "Done. Files saved in $SessionFolder"
