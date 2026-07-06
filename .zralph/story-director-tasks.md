
### source_refs + delivery 结构化结果
- T1 schema + director _resolve_clue_delivery + 校验器 warning：commit 2fcc425
- T2 Haunting 回填（58 实体，58 ref）：commit eaa509f
- T3a 人煎百味 回填（72 实体，89 ref）：commit 56a23d5
- T3b 血色公路 probe 回填（84 实体，113 ref）：commit d83ba6c
- 文档修复 source_ref 4 keys：commit 5434d4e
- 697 测试，3 模组校验 OK，v7 smoke 10/10
- whole-branch review: READY TO MERGE（reviewer 做了端到端实弹验证 extract_markdown+grep 命中）
