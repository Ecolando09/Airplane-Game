#!/usr/bin/env bash
# Builds the Lego Sky Android app (android/) into a signed APK.
#   bash deploy/build-apk.sh OUT.apk
#
# Uses Ubuntu/Debian's Android build tools (aapt, dx, zipalign, apksigner) and the
# Android 14 SDK jar, so no Android Studio is needed. The signing key is made on
# first run and kept in /etc/latlas-play: keep it, since Android only installs an
# update signed with the same key as the app already on the phone.
set -euo pipefail

OUT=$(realpath -m "${1:?usage: build-apk.sh OUT.apk}")
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

aapt package -f -m -J "$W/gen" -M "$SRC/AndroidManifest.xml" -S "$SRC/res" -I "$JAR" -F "$W/app.apk"
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
