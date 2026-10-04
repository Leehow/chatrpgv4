#!/bin/zsh
# sandbox.sh CAMPAIGN HOME -- a copy-on-write replay home for one App campaign: its campaign dir, repository,
# module campaign and module (when it has them), the installed packages and the caches the kernel reads, with every
# absolute App path rewritten to this home so nothing can write into the App's directories. The App home is only read.
set -euo pipefail
G=$1; H=$2
APP="/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc"
SRC="$APP/.coc"
[ -e "$H" ] && { echo "refusing: $H exists"; exit 4; }
mkdir -p $H/.coc/campaigns $H/.coc/repos $H/.coc/module-campaigns $H/.coc/modules
cp -cR "$SRC/campaigns/$G" $H/.coc/campaigns/
[ -d "$SRC/repos/$G.git" ] && cp -cR "$SRC/repos/$G.git" $H/.coc/repos/
[ -d "$SRC/module-campaigns/$G" ] && cp -cR "$SRC/module-campaigns/$G" $H/.coc/module-campaigns/
MOD=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('module_id') or '')" "$SRC/campaigns/$G/campaign.json")
[ -n "$MOD" ] && [ -d "$SRC/modules/$MOD" ] && cp -cR "$SRC/modules/$MOD" $H/.coc/modules/
for d in mods reference-library reference-cache ui-words map-words map-source-cache character-presentations document-presentations ui-hints.json; do
  [ -e "$SRC/$d" ] && cp -cR "$SRC/$d" $H/.coc/
done
python3 - "$APP/" "$H/" "$H/.coc" <<'EOF'
import os, sys
old, new, root = sys.argv[1].encode(), sys.argv[2].encode(), sys.argv[3]
changed = 0
for base, dirs, files in os.walk(root):
    if base.endswith(".git") or "/.git/" in base or base.endswith("/objects"): continue
    for name in files:
        path = os.path.join(base, name)
        try:
            if os.path.islink(path) or os.path.getsize(path) > 64 * 1024 * 1024: continue
            data = open(path, "rb").read()
        except OSError: continue
        if old in data:
            mode = os.stat(path).st_mode & 0o7777
            os.chmod(path, mode | 0o200); open(path, "wb").write(data.replace(old, new)); changed += 1; os.chmod(path, mode)
print("rewrote App paths in", changed, "files")
EOF
