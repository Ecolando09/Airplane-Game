#!/usr/bin/env bash
# Builds the Lego Sky Android app (android/) into a signed APK.
#   bash deploy/build-apk.sh OUT.apk          the phone app (lol.latlas.legosky)
#   bash deploy/build-apk.sh OUT.apk psg1     the PSG1 app (lol.latlas.legosky.psg1):
#       its own name and package, with the whole game inside it (run
#       `npm run build:psg1` first: it packs dist-psg1/), so it plays offline;
#       passes the built-in buttons to the page (see MainActivity)
#
# Uses Ubuntu/Debian's Android build tools (aapt, dx, zipalign, apksigner) and the
# Android 14 SDK jar, so no Android Studio is needed. The signing key is made on
# first run and kept in /etc/latlas-play: keep it, since Android only installs an
# update signed with the same key as the app already on the phone.
set -euo pipefail

OUT=$(realpath -m "${1:?usage: build-apk.sh OUT.apk [psg1]}")
VARIANT=${2:-phone}
SRC=$(cd "$(dirname "$0")/../android" && pwd)
SDK_DIR=${SDK_DIR:-/opt/latlas-play/android-sdk}
KEYSTORE=${KEYSTORE:-/etc/latlas-play/android-release.keystore}
PASS_FILE=${PASS_FILE:-/etc/latlas-play/android-keystore-pass}
JAR=$SDK_DIR/android-34.jar
JAR_URL=https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar

if ! command -v aapt >/dev/null || ! command -v dalvik-exchange >/dev/null || ! command -v zipalign >/dev/null \
  || ! command -v apksigner >/dev/null || ! command -v javac >/dev/null || ! command -v unzip >/dev/null; then
  echo "Installing Android build tools"
  apt-get install -y -qq aapt zipalign apksigner dalvik-exchange default-jdk-headless unzip >/dev/null
fi

if ! unzip -qql "$JAR" android/webkit/WebView.class >/dev/null 2>&1; then
  echo "Downloading the Android 14 SDK jar"
  mkdir -p "$SDK_DIR"
  curl -fsSL --retry 3 -o "$JAR.tmp" "$JAR_URL"
  mv "$JAR.tmp" "$JAR"
fi

if [ ! -s "$KEYSTORE" ]; then
  echo "Making the app signing key ($KEYSTORE)"
  mkdir -p "$(dirname "$KEYSTORE")"
  (umask 077; head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$PASS_FILE")
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias legosky -keyalg RSA -keysize 3072 \
    -validity 20000 -dname "CN=Latlas Play, O=latlas.lol" \
    -storepass:file "$PASS_FILE" -keypass:file "$PASS_FILE" >/dev/null 2>&1
  chmod 600 "$KEYSTORE"
fi

W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/gen" "$W/classes"

# The PSG1 variant: same code, its own name, package and "psg1" flag.
RES=$SRC/res
RENAME=()
ASSETS=()
if [ "$VARIANT" = psg1 ]; then
  GAME=${PSG1_GAME:-$SRC/../dist-psg1}
  [ -s "$GAME/index.html" ] || { echo "No PSG1 game build at $GAME: run npm run build:psg1 first"; exit 1; }
  mkdir -p "$W/assets"
  cp -r "$GAME" "$W/assets/game"
  rm -f "$W/assets/game/config.js" # no Google key in the app (it only works on the website)
  ASSETS=(-A "$W/assets")
  cp -r "$SRC/res" "$W/res"
  RES=$W/res
  sed -i 's|<string name="app_name">[^<]*</string>|<string name="app_name">Lego Sky PSG1</string>|' "$RES/values/strings.xml"
  sed -i 's|<bool name="psg1">false</bool>|<bool name="psg1">true</bool>|' "$RES/values/bools.xml"
  RENAME=(--rename-manifest-package lol.latlas.legosky.psg1)
fi

aapt package -f -m -J "$W/gen" -M "$SRC/AndroidManifest.xml" -S "$RES" -I "$JAR" -F "$W/app.apk" ${RENAME[@]+"${RENAME[@]}"} ${ASSETS[@]+"${ASSETS[@]}"}
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -classpath "$JAR" -d "$W/classes" \
  $(find "$SRC/java" "$W/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$W/classes.dex" "$W/classes"
(cd "$W" && aapt add -k app.apk classes.dex >/dev/null)
zipalign -f 4 "$W/app.apk" "$W/aligned.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass "file:$PASS_FILE" --ks-key-alias legosky --out "$W/signed.apk" "$W/aligned.apk"
apksigner verify "$W/signed.apk"

mkdir -p "$(dirname "$OUT")"
mv "$W/signed.apk" "$OUT"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
