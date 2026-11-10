param([string]$OutDir)
Add-Type -AssemblyName System.Drawing

function New-FinIcon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded teal square (with a gentle top-to-bottom gradient)
  $r = [single]($size * 0.22)
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $top = [System.Drawing.Color]::FromArgb(255, 0x1F, 0xB0, 0x9C)
  $bottom = [System.Drawing.Color]::FromArgb(255, 0x0F, 0x80, 0x73)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $top, $bottom, 90
  $g.FillPath($bg, $path)

  # White ring (a coin)
  $white = [System.Drawing.Color]::White
  $ringW = [single]([Math]::Max(1.5, $size * 0.055))
  $c = [single]($size * 0.21)
  $cs = [single]($size - 2 * $c)
  $pen = New-Object System.Drawing.Pen $white, $ringW
  $g.DrawEllipse($pen, $c, $c, $cs, $cs)

  # Rupee sign, centred in the ring
  $font = New-Object System.Drawing.Font 'Segoe UI', ([single]($size * 0.44)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $brush = New-Object System.Drawing.SolidBrush $white
  $textRect = New-Object System.Drawing.RectangleF 0, ([single](-$size * 0.005)), $size, $size
  $g.DrawString([string][char]0x20B9, $font, $brush, $textRect, $fmt)

  $g.Dispose()
  return $bmp
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$big = New-FinIcon 1024
$big.Save((Join-Path $OutDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()

# Multi-size .ico (PNG-compressed entries), each size drawn natively for crisp small icons
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) {
  $b = New-FinIcon $s
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  , $ms.ToArray()
}
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$len); $w.Write([UInt32]$offset)
  $offset += $len
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.ico'), $out.ToArray())
