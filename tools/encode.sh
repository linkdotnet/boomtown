#!/bin/sh
# raw/ (from tools/capture.mjs) + game assets → media/. Usage: POSTER=<frame index> sh tools/encode.sh [path/to/game]
set -e
: "${POSTER:?set POSTER to the poster frame index}"
GAME=${1:-../boomtown-game}
OUT=media
mkdir -p "$OUT" fonts
ff() { ffmpeg -loglevel error -y "$@"; }
enc() { # enc <out-basename> <crf> <ffmpeg input args...>
  name=$1 crf=$2; shift 2
  ff "$@" -an -c:v libx264 -crf "$crf" -preset veryslow -profile:v high -pix_fmt yuv420p -movflags +faststart "$OUT/$name.mp4"
}
# AV1 WebM is ~25% smaller at equal SSIM on the hero; on the small loops it isn't, so they stay MP4-only.
webm() { # webm <out-basename> <bitrate> <ffmpeg input args...>
  name=$1 rate=$2; shift 2
  ff "$@" -an -c:v libsvtav1 -b:v "$rate" -preset 6 -pix_fmt yuv420p "$OUT/$name.webm"
}
clip() { echo "-f concat -safe 0 -i raw/scene-$1/frames.txt"; }

# Hero: the street tour (?store=tour, 30 fps PNGs from capture.mjs). Desktop 1080p: H.264 capped at 6 Mbps, AV1 ~5 Mbps. Phones 720p: H.264 capped at 1.5 Mbps, AV1 ~1.3 Mbps.
# CRF with a maxrate cap: flat farmland stays small, the dense city keeps its detail. POSTER is the frame shown before playback.
FRAMES=${FRAMES:-raw/tour/frames}
# VMAF on the 1080p reel: H.264 4 Mbps 89.7 (5: 91.1, 6: 92.1), AV1 3 Mbps 91.0; past ~90 extra bitrate buys little.
enc hero-1080 22 -framerate 30 -i "$FRAMES/%05d.png" -maxrate 4.5M -bufsize 9M
enc hero 27 -framerate 30 -i "$FRAMES/%05d.png" -vf scale=1280:-2 -maxrate 1.5M -bufsize 3M
webm hero-1080 3M -framerate 30 -i "$FRAMES/%05d.png"
webm hero 1.3M -framerate 30 -i "$FRAMES/%05d.png" -vf scale=1280:-2
ff -framerate 30 -start_number "$POSTER" -i "$FRAMES/%05d.png" -frames:v 1 raw/hero.png
cwebp -quiet -q 78 raw/hero.png -o "$OUT/hero-1920.webp"
cwebp -quiet -q 75 -resize 1280 0 raw/hero.png -o "$OUT/hero.webp"
# Gallery stills g6–g8 and thumb t3 come from the village-to-town growth reel (morning → night), not the hero.
ff -f concat -safe 0 -i raw/grow/frames.txt -vf fps=30,format=yuv420p -c:v libx264 -crf 12 -preset fast raw/grow.mp4

# Feature loops: 4 s forward then reversed, so they loop seamlessly. 640×360.
for n in 1 2 3 4 5; do
  enc "f$n" 30 $(clip $n) -filter_complex "[0]fps=30,trim=3:7,setpts=PTS-STARTPTS,scale=640:-2,split[f][r];[r]reverse[b];[f][b]concat"
  ff -i "$OUT/f$n.mp4" -frames:v 1 raw/f$n.png && cwebp -quiet -q 70 raw/f$n.png -o "$OUT/f$n.webp"
done

# Gallery stills: 1280 + 640 WebP. g6–g8 are reel frames: the village, the grown town, the town at night.
for t in 2 15.5 23.5; do ff -ss $t -i raw/grow.mp4 -frames:v 1 raw/grow-$t.png; done
i=0
for src in raw/scene-1/end.jpg raw/scene-2/start.jpg raw/scene-3/end.jpg raw/scene-4/end.jpg raw/scene-5/start.jpg raw/grow-2.png raw/grow-15.5.png raw/grow-23.5.png; do
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
thumb raw/grow-23.5.png 380 700 250 3
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
