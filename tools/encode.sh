#!/bin/sh
# raw/ (from tools/capture.mjs) + game assets → media/. Usage: sh tools/encode.sh [path/to/game]
set -e
GAME=${1:-../boomtown-game}
OUT=media
mkdir -p "$OUT" fonts
ff() { ffmpeg -loglevel error -y "$@"; }
enc() { # enc <out-basename> <crf> <ffmpeg input args...>
  name=$1 crf=$2; shift 2
  ff "$@" -an -c:v libx264 -crf "$crf" -preset veryslow -profile:v high -pix_fmt yuv420p -movflags +faststart "$OUT/$name.mp4"
}
# AV1 WebM is ~25% smaller at equal SSIM on the hero; on the small loops it isn't, so they stay MP4-only.
webm() { # webm <out-basename> <crf> <ffmpeg input args...>
  name=$1 crf=$2; shift 2
  ff "$@" -an -c:v libsvtav1 -crf "$crf" -preset 6 -pix_fmt yuv420p "$OUT/$name.webm"
}
clip() { echo "-f concat -safe 0 -i raw/scene-$1/frames.txt"; }

# Hero: the village-to-town reel (morning growth → night), 30 fps. 1080p for wide screens, 720p for phones.
# Constant construction churn is costly to encode; these CRFs keep it near the old 18 s montage's sizes.
ff -f concat -safe 0 -i raw/grow/frames.txt -vf fps=30,format=yuv420p -c:v libx264 -crf 12 -preset fast raw/hero.mp4
enc hero-1080 34 -i raw/hero.mp4
enc hero 33 -i raw/hero.mp4 -vf scale=1280:-2
webm hero-1080 56 -i raw/hero.mp4
webm hero 52 -i raw/hero.mp4 -vf scale=1280:-2
ff -i raw/hero.mp4 -frames:v 1 raw/hero.png
cwebp -quiet -q 78 raw/hero.png -o "$OUT/hero-1920.webp"
cwebp -quiet -q 75 -resize 1280 0 raw/hero.png -o "$OUT/hero.webp"

# Feature loops: 4 s forward then reversed, so they loop seamlessly. 640×360.
for n in 1 2 3 4 5; do
  enc "f$n" 30 $(clip $n) -filter_complex "[0]fps=30,trim=3:7,setpts=PTS-STARTPTS,scale=640:-2,split[f][r];[r]reverse[b];[f][b]concat"
  ff -i "$OUT/f$n.mp4" -frames:v 1 raw/f$n.png && cwebp -quiet -q 70 raw/f$n.png -o "$OUT/f$n.webp"
done

# Gallery stills: 1280 + 640 WebP. g6–g8 are reel frames: the village, the grown town, the town at night.
for t in 2 15.5 23.5; do ff -ss $t -i raw/hero.mp4 -frames:v 1 raw/hero-$t.png; done
i=0
for src in raw/scene-1/end.jpg raw/scene-2/start.jpg raw/scene-3/end.jpg raw/scene-4/end.jpg raw/scene-5/start.jpg raw/hero-2.png raw/hero-15.5.png raw/hero-23.5.png; do
  i=$((i + 1))
  cwebp -quiet -q 72 -resize 1280 0 "$src" -o "$OUT/g$i.webp"
  cwebp -quiet -q 72 -resize 640 0 "$src" -o "$OUT/g$i-640.webp"
done
# People tab still, cropped 16:9 around the City Hall panel.
cwebp -quiet -q 78 -crop 240 110 1440 810 -resize 1280 0 raw/people/start.jpg -o "$OUT/people.webp"
cwebp -quiet -q 78 -crop 240 110 1440 810 -resize 640 0 raw/people/start.jpg -o "$OUT/people-640.webp"
cwebp -quiet -q 75 -resize 600 0 "$GAME"/store/screenshots/ipad-13-1.jpg -o "$OUT/ipad.webp"
cwebp -quiet -q 75 -resize 1200 0 "$GAME"/store/screenshots/iphone-6.9-1.jpg -o "$OUT/iphone.webp"

# Hero chip thumbnails: square crops (size x y) of the stills, shown at 32 px.
thumb() { ff -i "$1" -vf "crop=$2:$2:$3:$4,scale=96:96" raw/t$5.png && cwebp -quiet -q 80 raw/t$5.png -o "$OUT/t$5.webp"; }
thumb raw/scene-1/start.jpg 380 820 230 1
thumb raw/scene-2/start.jpg 380 300 330 2
thumb raw/hero-23.5.png 380 700 250 3
thumb raw/scene-3/start.jpg 380 560 420 4
thumb raw/scene-5/start.jpg 300 1010 520 5
thumb raw/people/start.jpg 330 450 610 6

# Icons, social card, fonts.
cwebp -quiet -q 85 -resize 256 256 "$GAME"/resources/icon.png -o "$OUT/icon.webp"
sips -z 180 180 "$GAME"/resources/icon.png --out apple-touch-icon.png >/dev/null
cp "$GAME"/resources/icon.svg favicon.svg
ff -i raw/scene-1/start.jpg -vf "scale=1200:-2,crop=1200:630" -q:v 6 "$OUT/og.jpg"
cp "$GAME"/public/fonts/inter.woff2 "$GAME"/public/fonts/outfit.woff2 fonts/

du -ch "$OUT"/* | tail -1
