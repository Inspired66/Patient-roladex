#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
export VITE_GROK_EXTENSIONS=0
SDK="${ANDROID_SDK:-${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}}"
BT="$SDK/build-tools/35.0.0"
ANDROID_JAR="$SDK/platforms/android-35/android.jar"
OUT="${1:-$ROOT/artifacts/Vellum.apk}"
WORK="${TMPDIR:-/tmp}/vellum-apk"
PREVIEW="${PREVIEW_URL:-http://127.0.0.1:8081/}"

mkdir -p "$(dirname "$OUT")" "$WORK"
rm -rf "$WORK/classes" "$WORK/dex" "$WORK/www" "$WORK/res" "$WORK/compiled" "$WORK/apkroot" "$WORK/stubs"
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/www" "$WORK/res/mipmap-xxhdpi" "$WORK/compiled" "$WORK/apkroot"

cd "$ROOT"
npm run build:web
npm run preview:restart

if ! curl -sf -o /dev/null --max-time 3 "$PREVIEW"; then
  echo "Production preview is not running" >&2
  exit 1
fi
curl -fsS "$PREVIEW" -o "$WORK/www/index.html"
cp -a "$ROOT/.vercel/output/static/." "$WORK/www/"
curl -fsS "$PREVIEW" -o "$WORK/www/index.html"

ICON="$ROOT/public/__grok/icon-180.png"
if [ ! -f "$ICON" ]; then
  ICON="$ROOT/public/favicon.svg"
fi
cp -a "$ROOT/android/res/." "$WORK/res/"
cp "$ICON" "$WORK/res/mipmap-xxhdpi/ic_launcher.png"

python3 "$ROOT/android/prepare_mlkit.py"
python3 "$ROOT/android/prepare_opennlp.py"
MLKIT="$ROOT/android/third_party/mlkit/jars"
OPENNLP="$ROOT/android/third_party/opennlp/jars"
STUBS="$WORK/stubs"
mkdir -p "$STUBS"
python3 - "$MLKIT" "$OPENNLP" "$ANDROID_JAR" "$STUBS" << 'PY'
import os, subprocess, sys, textwrap, zipfile
jar_dirs, android_jar, stubs = sys.argv[1:-2], sys.argv[-2], sys.argv[-1]
jar_paths = [
    os.path.join(directory, name)
    for directory in jar_dirs
    for name in sorted(os.listdir(directory))
    if name.endswith(".jar")
]
cp = ":".join(jar_paths)
cp = cp + ":" + android_jar
missing = subprocess.check_output(["jdeps", "-q", "-verbose:class", "-cp", cp] + jar_paths, stderr=subprocess.DEVNULL, text=True)
classes = set()
for line in missing.splitlines():
    if "->" not in line or "not found" not in line.split("->", 1)[1]:
        continue
    parts = line.split("->", 1)[1].replace("not found", "").split()
    if not parts:
        continue
    name = parts[0]
    if not name or name == "not" or name.startswith("java.") or name.startswith("android.") or name.startswith("libcore."):
        continue
    classes.add(name)
annotations = {
    "androidx.annotation.RestrictTo",
    "androidx.lifecycle.OnLifecycleEvent",
    "javax.annotation.CheckForNull",
    "javax.annotation.Nullable",
    "javax.annotation.meta.TypeQualifierDefault",
    "com.google.auto.value.AutoValue",
    "com.google.errorprone.annotations.CheckReturnValue",
    "com.google.errorprone.annotations.DoNotMock",
    "com.google.errorprone.annotations.Keep",
    "com.google.errorprone.annotations.RestrictedInheritance",
    "com.google.errorprone.annotations.ResultIgnorabilityUnspecified",
    "org.checkerframework.checker.initialization.qual.NotOnlyInitialized",
    "org.checkerframework.checker.nullness.qual.EnsuresNonNull",
    "org.checkerframework.checker.nullness.qual.EnsuresNonNullIf",
    "org.jspecify.nullness.NullMarked",
}
src = os.path.join(stubs, "src")
os.makedirs(src, exist_ok=True)

def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(body)

# Group by top-level binary name
groups = {}
for name in sorted(classes):
    top = name.split("$", 1)[0]
    groups.setdefault(top, set()).add(name)

provided = set()
for jar_path in jar_paths:
    with zipfile.ZipFile(jar_path) as archive:
        provided.update(
            entry[:-6].replace("/", ".")
            for entry in archive.namelist()
            if entry.endswith(".class")
        )

for top, members in groups.items():
    if top in provided:
        continue
    package, _, simple = top.rpartition(".")
    inners = []
    for name in members:
        if "$" not in name:
            continue
        inner = name.split("$", 1)[1]
        if "$" in inner:
            continue
        inners.append(inner)
    kind = "interface" if top in annotations else "class"
    body = []
    if package:
        body.append(f"package {package};")
    if kind == "interface" and top in annotations:
        body.append("import java.lang.annotation.Retention;")
        body.append("import java.lang.annotation.RetentionPolicy;")
        body.append("@Retention(RetentionPolicy.CLASS)")
        body.append(f"public @interface {simple} {{")
        if simple == "RestrictTo":
            body.append("  enum Scope { LIBRARY, LIBRARY_GROUP, TESTS, SUBCLASSES }")
            body.append("  Scope[] value() default {};")
        for inner in inners:
            if inner == "Scope":
                continue
            body.append(f"  public static class {inner} {{}}")
        body.append("}")
    else:
        body.append(f"public class {simple} {{")
        for inner in inners:
            if inner in ("Event",):
                body.append("  public enum Event { ON_CREATE, ON_START, ON_RESUME, ON_PAUSE, ON_STOP, ON_DESTROY, ON_ANY }")
            elif inner in ("Scope",):
                continue
            else:
                body.append(f"  public static class {inner} {{}}")
        if simple.startswith("R$") or simple == "R":
            body.append("  public static final int value = 0;")
        body.append("}")
    path = os.path.join(src, *top.split(".")) + ".java"
    write(path, "\n".join(body) + "\n")

# Platform-only class. Keep it off the dex so the phone's copy is used.
mem = os.path.join(stubs, "memory")
write(os.path.join(mem, "libcore", "io", "Memory.java"), "package libcore.io;\npublic class Memory {}\n")
subprocess.check_call(["javac", "--release", "17", "-d", os.path.join(stubs, "classes"), *sum([[os.path.join(dirpath, name)] for dirpath, _, names in os.walk(src) for name in names if name.endswith(".java")], [])])
subprocess.check_call(["javac", "--release", "17", "-d", os.path.join(stubs, "memory-classes"), os.path.join(mem, "libcore", "io", "Memory.java")])
subprocess.check_call(["jar", "cf", os.path.join(stubs, "stubs.jar"), "-C", os.path.join(stubs, "classes"), "."])
subprocess.check_call(["jar", "cf", os.path.join(stubs, "memory.jar"), "-C", os.path.join(stubs, "memory-classes"), "."])
print("stubs", len(classes))
PY

CP="$ANDROID_JAR:$STUBS/stubs.jar"
for jar in "$MLKIT"/*.jar "$OPENNLP"/*.jar; do
  CP="$CP:$jar"
done
javac --release 17 -classpath "$CP" -d "$WORK/classes" \
  "$ROOT/android/src/com/vellum/casebook/"*.java
jar cf "$WORK/classes.jar" -C "$WORK/classes" .
"$BT/d8" --min-api 24 --lib "$ANDROID_JAR" --lib "$STUBS/memory.jar" --output "$WORK/dex" \
  "$WORK/classes.jar" "$STUBS/stubs.jar" "$MLKIT"/*.jar "$OPENNLP"/*.jar

"$BT/aapt2" compile --dir "$WORK/res" -o "$WORK/compiled/res.zip"
"$BT/aapt2" link -o "$WORK/linked.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  --min-sdk-version 24 \
  --target-sdk-version 35 \
  "$WORK/compiled/res.zip"

cp "$WORK/dex"/classes*.dex "$WORK/apkroot/"
mkdir -p "$WORK/apkroot/assets" "$WORK/apkroot/lib"
if [ -d "$ROOT/android/third_party/mlkit/assets" ]; then
  cp -a "$ROOT/android/third_party/mlkit/assets/." "$WORK/apkroot/assets/"
fi
if [ -d "$ROOT/android/third_party/opennlp/assets" ]; then
  cp -a "$ROOT/android/third_party/opennlp/assets/." "$WORK/apkroot/assets/"
fi
FEATURES_RESOURCE="$WORK/apkroot/opennlp/tools/namefind/ner-default-features.xml"
mkdir -p "$(dirname "$FEATURES_RESOURCE")"
unzip -p "$OPENNLP/opennlp-tools-1.9.4.jar" \
  opennlp/tools/namefind/ner-default-features.xml > "$FEATURES_RESOURCE"
if [ ! -s "$FEATURES_RESOURCE" ]; then
  echo "OpenNLP default name-finder feature configuration is missing" >&2
  exit 1
fi
mkdir -p "$WORK/apkroot/assets/opennlp"
cp "$ROOT/android/third_party/opennlp/LICENSE-2.0.txt" "$WORK/apkroot/assets/opennlp/LICENSE-2.0.txt"
cp "$ROOT/android/third_party/opennlp/NOTICE" "$WORK/apkroot/assets/opennlp/NOTICE"
unzip -p "$OPENNLP/xercesImpl-2.12.2.jar" META-INF/LICENSE \
  > "$WORK/apkroot/assets/opennlp/XERCES-LICENSE.txt"
unzip -p "$OPENNLP/xercesImpl-2.12.2.jar" META-INF/NOTICE \
  > "$WORK/apkroot/assets/opennlp/XERCES-NOTICE.txt"
if [ -d "$ROOT/android/third_party/mlkit/jni" ]; then
  cp -a "$ROOT/android/third_party/mlkit/jni/." "$WORK/apkroot/lib/"
fi
mkdir -p "$WORK/apkroot/assets"
cp -a "$WORK/www" "$WORK/apkroot/assets/www"
python3 "$ROOT/android/check-web-assets.py" "$WORK/apkroot/assets/www"
cp "$WORK/linked.apk" "$WORK/unsigned.apk"
python3 - <<PY
import os, zipfile
apk = "$WORK/unsigned.apk"
root = "$WORK/apkroot"
with zipfile.ZipFile(apk, "a", compression=zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            arc = os.path.relpath(full, root).replace(os.sep, "/")
            zf.write(full, arc)
print("packed", apk)
PY
"$BT/zipalign" -p -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"

if [ ! -f "$WORK/debug.keystore" ]; then
  keytool -genkeypair -keystore "$WORK/debug.keystore" -storepass android -keypass android \
    -alias vellum -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Vellum Casebook, OU=Vellum, O=Vellum, C=AU"
fi
"$BT/apksigner" sign --ks "$WORK/debug.keystore" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias vellum --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT"
echo "Wrote $OUT"
