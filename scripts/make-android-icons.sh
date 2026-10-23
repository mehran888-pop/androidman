#!/usr/bin/env bash
# ساخت آیکون‌ها و تصویر اسپلش اندروید از web/icons/icon-1024.png
# نیازمند ImageMagick (convert)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/web/icons/icon-1024.png"
RES="$ROOT/android/app/src/main/res"
BRAND="#0e7a6d"

if [ ! -f "$SRC" ]; then
  echo "آیکون مبدأ پیدا نشد: $SRC" >&2
  exit 1
fi

# اندازه‌های استاندارد آیکون لانچر
declare -A ICON=([mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192)
# اندازه‌ی لایه‌ی foreground آیکون تطبیقی (۱۰۸dp)
declare -A FG=([mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432)

for d in "${!ICON[@]}"; do
  dir="$RES/mipmap-$d"
  mkdir -p "$dir"
  size="${ICON[$d]}"
  convert "$SRC" -resize "${size}x${size}" "$dir/ic_launcher.png"
  # نسخه‌ی گرد
  convert "$SRC" -resize "${size}x${size}" \
    \( -size "${size}x${size}" xc:black -fill white -draw "circle $((size/2)),$((size/2)) $((size/2)),1" \) \
    -alpha off -compose CopyOpacity -composite "$dir/ic_launcher_round.png"
  # لایه‌ی foreground با حاشیه‌ی امن
  fg="${FG[$d]}"
  inner=$((fg * 62 / 100))
  convert -size "${fg}x${fg}" xc:none \
    \( "$SRC" -resize "${inner}x${inner}" \) -gravity center -composite \
    "$dir/ic_launcher_foreground.png"
done

# اسپلش: پس‌زمینه‌ی برند + لوگو
declare -A SPLASH_PORT=([mdpi]="320x480" [hdpi]="480x800" [xhdpi]="720x1280" [xxhdpi]="1080x1920" [xxxhdpi]="1440x2560")
for d in "${!SPLASH_PORT[@]}"; do
  w="${SPLASH_PORT[$d]%x*}"
  h="${SPLASH_PORT[$d]#*x}"
  logo=$((w * 40 / 100))
  tmp="$(mktemp -d)"
  convert -size "${w}x${h}" "xc:$BRAND" \
    \( "$SRC" -resize "${logo}x${logo}" \) -gravity center -composite "$tmp/p.png"
  mkdir -p "$RES/drawable-port-$d" "$RES/drawable-land-$d"
  cp "$tmp/p.png" "$RES/drawable-port-$d/splash.png"
  convert "$tmp/p.png" -rotate 90 "$RES/drawable-land-$d/splash.png"
  rm -rf "$tmp"
done
mkdir -p "$RES/drawable"
convert -size "480x800" "xc:$BRAND" \( "$SRC" -resize 192x192 \) -gravity center -composite "$RES/drawable/splash.png"

# رنگ پس‌زمینه‌ی آیکون تطبیقی
cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0E7A6D</color>
</resources>
XML

echo "✅ آیکون‌ها و اسپلش اندروید ساخته شد."
