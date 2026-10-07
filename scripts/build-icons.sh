#!/usr/bin/env bash
# Builds the iOS and Android launcher icons and splash screens from src/icon.png.
# Needs ImageMagick 7 (`brew install imagemagick`). Run from anywhere: scripts/build-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SOURCE=src/icon.png
ICON_BG='#0f1415'      # the flat colour of the icon artwork, so the Android layers join seamlessly
SPLASH_BG='#1e1e1e'    # the app's window colour
IOS=ios/App/App/Assets.xcassets
RES=android/app/src/main/res
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# rounded SIZE RADIUS OUT: the icon with rounded corners (transparent outside)
rounded() {
    magick "$SOURCE" -resize "${1}x${1}" \( +clone -alpha extract -fill black -colorize 100 -fill white -draw "roundrectangle 0,0 $(($1 - 1)),$(($1 - 1)) $2,$2" \) -alpha off -compose copy_opacity -composite "$3"
}
# circle SIZE OUT: a dark disc with the artwork at 88%, so the window frame is not cut by the edge
circle() {
    magick -size "${1}x${1}" "xc:$ICON_BG" \( "$SOURCE" -resize "$((${1} * 88 / 100))x$((${1} * 88 / 100))" \) -gravity center -composite \( +clone -alpha extract -fill black -colorize 100 -fill white -draw "circle $(($1 / 2)),$(($1 / 2)) $(($1 / 2)),0" \) -alpha off -compose copy_opacity -composite "$2"
}
# layer SIZE OUT: the artwork at 72% on a transparent canvas (the corners of its dark square may be masked away, the frog stays whole)
layer() {
    magick -size "${1}x${1}" xc:none \( "$SOURCE" -resize "$((${1} * 72 / 100))x$((${1} * 72 / 100))" \) -gravity center -composite "$2"
}
# splash W H OUT: the window colour with the rounded icon in the middle
splash() {
    local short=$(($1 < $2 ? $1 : $2)); local size=$((short * 30 / 100))
    rounded "$size" "$((size * 22 / 100))" "$TMP/splash-icon.png"
    magick -size "${1}x${2}" "xc:$SPLASH_BG" "$TMP/splash-icon.png" -gravity center -composite "$3"
}

echo "iOS icons"
mkdir -p "$IOS/AppIcon.appiconset"
magick "$SOURCE" -resize 1024x1024 -background "$ICON_BG" -alpha remove -alpha off "$IOS/AppIcon.appiconset/AppIcon-512@2x.png"
cp "$IOS/AppIcon.appiconset/AppIcon-512@2x.png" "$IOS/AppIcon.appiconset/AppIcon-Dark-512@2x.png"
magick "$IOS/AppIcon.appiconset/AppIcon-512@2x.png" -colorspace Gray -alpha off "$IOS/AppIcon.appiconset/AppIcon-Tinted-512@2x.png"
cat > "$IOS/AppIcon.appiconset/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "AppIcon-512@2x.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ], "filename" : "AppIcon-Dark-512@2x.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ], "filename" : "AppIcon-Tinted-512@2x.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON

echo "iOS splash"
for name in splash-2732x2732 splash-2732x2732-1 splash-2732x2732-2; do splash 2732 2732 "$IOS/Splash.imageset/$name.png"; done

echo "Android icons"
# silhouette for themed icons (Android 13+): the light parts of the artwork in white, the rest transparent
magick -size 1024x1024 xc:white \( "$SOURCE" -colorspace Gray -threshold 55% \) -alpha off -compose copy_opacity -composite "$TMP/silhouette.png"
for density in "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"; do
    set -- $density
    dir="$RES/mipmap-$1"
    mkdir -p "$dir"
    rounded "$2" "$(($2 * 22 / 100))" "$dir/ic_launcher.png"
    circle "$2" "$dir/ic_launcher_round.png"
    layer "$3" "$dir/ic_launcher_foreground.png"
    magick -size "${3}x${3}" xc:none \( "$TMP/silhouette.png" -resize "$((${3} * 72 / 100))x$((${3} * 72 / 100))" \) -gravity center -composite "$dir/ic_launcher_monochrome.png"
done
cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$ICON_BG</color>
</resources>
XML
for file in ic_launcher ic_launcher_round; do
cat > "$RES/mipmap-anydpi-v26/$file.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
XML
done

echo "Android splash"
splash 480 320 "$RES/drawable/splash.png"
for density in "mdpi 320 480" "hdpi 480 800" "xhdpi 720 1280" "xxhdpi 960 1600" "xxxhdpi 1280 1920"; do
    set -- $density
    splash "$2" "$3" "$RES/drawable-port-$1/splash.png"
    splash "$3" "$2" "$RES/drawable-land-$1/splash.png"
done
echo "Done. Run: npm run cap:sync"
