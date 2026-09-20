# Пересобирает icons/icon.ico из исходного PNG.
#
# Прежний icon.ico был повреждён: запись 256x256 содержала вчетверо больше
# данных, чем положено (1 МБ вместо ~270 КБ), из-за чего NSIS отказывался
# собирать установщик с сообщением «invalid icon file size».
#
# Здесь иконка собирается заново из android-chrome-512x512.png: каждый размер
# рисуется заново и пишется как несжатый DIB с маской прозрачности — формат,
# который одинаково понимают Windows, electron-builder и NSIS.
#
# Запуск:  powershell -ExecutionPolicy Bypass -File tools\make-icon.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'icons\android-chrome-512x512.png'
$out  = Join-Path $root 'icons\icon.ico'
$outInstaller = Join-Path $root 'icons\installer.ico'

if (-not (Test-Path $src)) { throw "Не найден исходник: $src" }

# 256 — максимум, который допускает формат ICO.
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$source = [System.Drawing.Image]::FromFile($src)
$entries = New-Object System.Collections.ArrayList

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($source, 0, 0, $size, $size)
  $g.Dispose()

  # Пиксели: ICO хранит строки снизу вверх, поэтому идём с конца.
  $pixels = New-Object 'System.Collections.Generic.List[byte]'
  for ($y = $size - 1; $y -ge 0; $y--) {
    for ($x = 0; $x -lt $size; $x++) {
      $c = $bmp.GetPixel($x, $y)
      $pixels.Add($c.B); $pixels.Add($c.G); $pixels.Add($c.R); $pixels.Add($c.A)
    }
  }

  # Маска прозрачности. Для 32-битных иконок Windows её игнорирует, но формат
  # требует её присутствия — иначе часть программ считает файл битым.
  $rowBytes = [math]::Ceiling($size / 8)
  if ($rowBytes % 4 -ne 0) { $rowBytes = $rowBytes + (4 - $rowBytes % 4) }
  $mask = New-Object byte[] ($rowBytes * $size)

  # BITMAPINFOHEADER: высота удвоена — так описывается пара «картинка + маска».
  $header = New-Object 'System.Collections.Generic.List[byte]'
  $header.AddRange([BitConverter]::GetBytes([int]40))
  $header.AddRange([BitConverter]::GetBytes([int]$size))
  $header.AddRange([BitConverter]::GetBytes([int]($size * 2)))
  $header.AddRange([BitConverter]::GetBytes([int16]1))
  $header.AddRange([BitConverter]::GetBytes([int16]32))
  $header.AddRange([BitConverter]::GetBytes([int]0))
  $header.AddRange([BitConverter]::GetBytes([int]($pixels.Count + $mask.Length)))
  $header.AddRange([BitConverter]::GetBytes([int]0))
  $header.AddRange([BitConverter]::GetBytes([int]0))
  $header.AddRange([BitConverter]::GetBytes([int]0))
  $header.AddRange([BitConverter]::GetBytes([int]0))

  $blob = New-Object 'System.Collections.Generic.List[byte]'
  $blob.AddRange($header); $blob.AddRange($pixels); $blob.AddRange($mask)

  [void]$entries.Add([pscustomobject]@{ Size = $size; Data = $blob.ToArray() })
  $bmp.Dispose()
  Write-Host ("  {0}x{0} — {1} КБ" -f $size, [math]::Round($blob.Count / 1024))
}

$source.Dispose()

function Write-Ico($path, $items) {
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)

  $bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$items.Count)
  $offset = 6 + 16 * $items.Count
  foreach ($e in $items) {
    $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim)
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([int16]1); $bw.Write([int16]32)
    $bw.Write([int]$e.Data.Length); $bw.Write([int]$offset)
    $offset += $e.Data.Length
  }
  foreach ($e in $items) { $bw.Write($e.Data) }

  $bw.Flush()
  [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
  $bw.Dispose(); $ms.Dispose()
  Write-Host ("OK {0} — {1} КБ" -f (Split-Path -Leaf $path), [math]::Round((Get-Item $path).Length / 1024))
}

Write-Ico $out $entries

# Установщику хватает мелких размеров: NSIS показывает иконку 32x32.
Write-Ico $outInstaller ($entries | Where-Object { $_.Size -le 64 })
