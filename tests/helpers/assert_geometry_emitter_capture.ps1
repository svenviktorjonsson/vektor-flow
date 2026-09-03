param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolved = (Resolve-Path -LiteralPath $Path).Path
$bitmap = [System.Drawing.Bitmap]::FromFile($resolved)

function Measure-MeanLuma {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [double]$X0,
    [double]$Y0,
    [double]$X1,
    [double]$Y1
  )

  $startX = [Math]::Floor($Bitmap.Width * $X0)
  $startY = [Math]::Floor($Bitmap.Height * $Y0)
  $endX = [Math]::Ceiling($Bitmap.Width * $X1)
  $endY = [Math]::Ceiling($Bitmap.Height * $Y1)
  [double]$sum = 0
  [int]$samples = 0
  for ($y = $startY; $y -lt $endY; $y += 2) {
    for ($x = $startX; $x -lt $endX; $x += 2) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $sum += (0.2126 * $pixel.R) + (0.7152 * $pixel.G) + (0.0722 * $pixel.B)
      $samples += 1
    }
  }
  return [Math]::Round($sum / $samples, 3)
}

try {
  $center = Measure-MeanLuma $bitmap 0.43 0.38 0.57 0.62
  $left = Measure-MeanLuma $bitmap 0.10 0.35 0.25 0.65
  $right = Measure-MeanLuma $bitmap 0.75 0.35 0.90 0.65
  $corner = Measure-MeanLuma $bitmap 0.10 0.10 0.25 0.25
  $outsideMax = [Math]::Max($left, [Math]::Max($right, $corner))
  if ($center -lt 70 -or $outsideMax -gt 25 -or ($center - $outsideMax) -lt 60) {
    throw "geometry emitter capture contrast failed: center=$center outsideMax=$outsideMax"
  }

  [pscustomobject]@{
    width = $bitmap.Width
    height = $bitmap.Height
    centerMeanLuma = $center
    leftMeanLuma = $left
    rightMeanLuma = $right
    cornerMeanLuma = $corner
    sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $resolved).Length
  } | ConvertTo-Json
} finally {
  $bitmap.Dispose()
}
