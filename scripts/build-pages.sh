#!/usr/bin/env bash
# Arma el sitio de GitHub Pages: cada projects/<nombre>/ con index.html se publica en
# /<nombre>/ y se genera una portada que lista los proyectos.
# Uso: bash scripts/build-pages.sh [directorio-de-salida]   (por defecto: _site)
set -euo pipefail

OUT="${1:-_site}"
cd "$(dirname "$0")/.."
rm -rf "$OUT"
mkdir -p "$OUT"

html_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }

items=""
count=0
for dir in projects/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/index.html" ] || continue
  cp -R "$dir" "$OUT/$name"
  # lo que no forma parte del sitio
  rm -rf "$OUT/$name/tests" "$OUT/$name/node_modules" "$OUT/$name/package.json" "$OUT/$name/package-lock.json"
  desc=""
  if [ -f "$dir/README.md" ]; then
    # primer párrafo después del título, sin marcas de Markdown
    desc="$(awk 'NR > 1 && NF { print; exit }' "$dir/README.md" | sed -e 's/[*`]//g' | html_escape)"
  fi
  items+="      <li><a href=\"./$name/\">$name</a><p>$desc</p></li>"$'\n'
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "No hay proyectos con index.html en projects/" >&2
  exit 1
fi

cat > "$OUT/index.html" <<EOF
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAG Samples</title>
<style>
  :root { color-scheme: light dark; --bg: #f1f4f1; --surface: #fff; --ink: #16201c; --muted: #5d6b64; --line: #d2dad3; --accent: #1f5c4d; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1412; --surface: #151d1a; --ink: #e2e9e5; --muted: #8b9992; --line: #2a3632; --accent: #72c4a8; } }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 48px 16px; }
  main { max-width: 760px; margin: 0 auto; display: grid; gap: 24px; }
  h1 { margin: 0; font-size: 2rem; }
  p { margin: 0; color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; display: grid; gap: 4px; }
  a { color: var(--accent); font-weight: 700; font-size: 1.1rem; }
</style>
</head>
<body>
  <main>
    <h1>RAG Samples</h1>
    <p>Ejemplos, guías y pruebas de concepto sobre RAG. Cada proyecto vive en <code>projects/&lt;nombre&gt;</code> del repositorio.</p>
    <ul>
$items    </ul>
  </main>
</body>
</html>
EOF

touch "$OUT/.nojekyll"
echo "Sitio generado en $OUT con $count proyecto(s)."
