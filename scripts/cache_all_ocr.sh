#!/bin/bash
# OCR all rulebook chapters and cache to checks/ocr-cached/.
# Idempotent: skips chapters already cached.
set -u
PROJECT="/Users/haoli/leehow/code/chatrpgv4"
PDF="pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf"
CACHE="$PROJECT/checks/ocr-cached"
MINERU="$HOME/.claude/skills/mineru/scripts/parse.sh"
mkdir -p "$CACHE"

# chapter_name:start_idx:end_idx
CHAPTERS=(
  "weapons-table-xvii:412:417"
  "skills-ch4:67:68"
  "phobias-manias:171:172"
  "poisons:140:141"
  "bout-tables:167:170"
  "occupations:47:58"
  "tomes-ch11:233:247"
  "tomes-table:248:252"
  "spells-grimoire:257:286"
  # Monsters chapter (printed pp.309-344, idx 320-355). Split into three
  # chunks: a single 36-page run makes the MinerU server drop the connection.
  "monsters-ch14-a:320:334"
  "monsters-ch14-b:335:345"
  "monsters-ch14-c:346:355"
)

for entry in "${CHAPTERS[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  start="${rest%%:*}"
  end="${rest##*:}"
  out="$CACHE/${name}.md"
  if [[ -f "$out" && $(wc -l < "$out") -gt 10 ]]; then
    echo "[skip] $name already cached ($(wc -l < "$out") lines)"
    continue
  fi
  echo "[ocr] $name (idx $start-$end)..."
  rm -rf "$PROJECT/pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru"
  "$MINERU" -p "$PDF" --plain -- -s "$start" -e "$end" 2>&1 | grep -E "Processed|Markdown|ERROR" | tail -2
  MD="$PROJECT/pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)/auto/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).md"
  if [[ -f "$MD" ]]; then
    cp "$MD" "$out"
    echo "[ok] $name -> $out ($(wc -l < "$out") lines)"
  else
    echo "[FAIL] $name: OCR output not found"
  fi
done

# Concatenate the three monsters-chapter chunks into the single cache file
# the verify scripts read (only when all chunks are present and fresh).
MA="$CACHE/monsters-ch14-a.md"; MB="$CACHE/monsters-ch14-b.md"; MC="$CACHE/monsters-ch14-c.md"
if [[ -f "$MA" && -f "$MB" && -f "$MC" ]]; then
  cat "$MA" "$MB" "$MC" > "$CACHE/monsters-ch14.md"
  echo "[ok] monsters-ch14.md concatenated ($(wc -l < "$CACHE/monsters-ch14.md") lines)"
fi

echo ""
echo "=== Cache complete ==="
ls -la "$CACHE/"
