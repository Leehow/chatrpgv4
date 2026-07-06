# Project Rules

## COC Plugin Dual-Track Law

This repository maintains two plugin tracks:

- `plugins/coc-keeper/` is the canonical Codex plugin.
- `plugins/coc-keeper-zcode/` is the generated/checkable ZCode-native copy.

When changing shared plugin behavior, edit the Codex track first, then sync the
ZCode track with:

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
```

Do not manually drift shared runtime files between the two tracks. Platform
differences must stay limited to the sync script's explicit rules: Codex
`.codex-plugin` metadata, ZCode `.zcode-plugin` metadata and `package.json`,
Codex-only `agents/openai.yaml`, Codex-only image generation instruction blocks
marked with `CODEX_ONLY_IMAGEGEN`, and the allowlisted Codex/ZCode wording
substitutions in `scripts/sync_coc_plugin_copy.py`.

If a new platform-specific difference is required, update
`scripts/sync_coc_plugin_copy.py` and the sync tests first so the rule is
machine-checkable.

Before finishing plugin work, run at minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
python3 scripts/sync_coc_plugin_copy.py --check
```
