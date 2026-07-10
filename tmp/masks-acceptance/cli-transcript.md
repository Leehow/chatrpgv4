# Masks Peru acceptance — module registry CLI transcript

## register
```
python plugins/coc-keeper/scripts/coc_module_registry.py --root tmp/masks-acceptance/ws register \
  --scenario-dir tmp/masks-acceptance/scenario \
  --identity '{"canonical_module_id":"masks-of-nyarlathotep-ch-peru","canonical_title":"Masks of Nyarlathotep","publisher":"Chaosium","edition":"7e","chapter":"peru","locale":"en"}'
```
→ registered `masks-of-nyarlathotep-ch-peru` under `.coc/module-library/`

## add-alias
```
... add-alias --module masks-of-nyarlathotep-ch-peru \
  --alias '{"title":"尼亚拉托提普的面具","locale":"zh-Hans"}'
```
→ alias_keys include `尼亚拉托提普的面具|7e`

## lookup (cache hit via zh alias)
```
... lookup --identity '{"canonical_module_id":null,"canonical_title":"尼亚拉托提普的面具","locale":"zh-Hans","edition":"7e"}'
```
→ `"hit": true`, entry `masks-of-nyarlathotep-ch-peru`

## install + validate
```
... install --module masks-of-nyarlathotep-ch-peru --campaign masks-peru-play
python plugins/coc-keeper/scripts/coc_scenario_compile.py --structured .../campaigns/masks-peru-play/scenario
```
→ OK, world-state status=active, active_scene_id=lima-bar-cordano
