# 从者战斗形态数据格式

战斗形态将共用技能与宝具配置的再临阶段、灵衣归为一组，供上层程序按形态选择技能候选。本文说明生成格式与分组规则，具体行为以源码和测试为准。

[返回 Atlas 数据工具](../README.md) · [项目首页](../../README.md) · [数据检查](../../verification/README.md)

## 生成与汇总

在代码仓库根目录设置 `MASH_DATA_ROOT`，并准备好从者缓存和运行时技能依赖后执行：

```bash
npm run atlas:build-variants
npm run atlas:combine-variants
npm run verify:variants
```

[build-variants.ts](../src/build-variants.ts) 扫描数据目录中的 `assets/servants/<collectionNo>/`，从 `servant.json` / `servant-cn.json` 分别生成静态文件 `servant_variants.json` / `servant_variants_cn.json`。

[combine-variants.ts](../src/combine-variants.ts) 追加运行时技能并汇总到 `assets/catalogs/servants_variants.json` 和 `assets/catalogs/servants_variants_cn.json`，每个从者一行；汇总随 `assets-json`、增量补丁及离线包发布。

## 输出格式

以下为格式示例，名称和 ID 组合仅用于说明字段，不代表实际游戏数据：

```json
{
  "id": 1,
  "variants": [
    {
      "ids": [1, 2, 3, 4, 800001],
      "noblePhantasms": ["示例宝具"],
      "skills": {
        "1": [{ "id": 1000, "name": "示例技能一" }],
        "2": [{ "id": 2000, "name": "示例技能二" }],
        "3": [{ "id": 3000, "name": "示例技能三" }]
      }
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `id` | 从者图鉴编号 `collectionNo`，不是 Atlas 从者内部 `id` |
| `variants` | 战斗形态列表 |
| `ids` | 该形态包含的再临编号和灵衣 `battleCharaId` |
| `noblePhantasms` | 非战斗状态下可见的宝具名称候选，按名称去重 |
| `skills` | 技能槽 `1`、`2`、`3` 的候选列表 |
| `skills.*[].id` / `name` | 源技能 ID 与名称，同名但不同 ID 的技能可以共存 |
| `skills.*[].targetingMode` | 源数据中的目标选择分类，值为 `Other` 时省略 |
| `skills.*[].runtime` | 仅在汇总中追加的技能切换形态，值为 `true` |

`ids` 的再临编号取自 `extraAssets.charaGraph.ascension` 的键，通常为 `1..4`；灵衣编号取自 `extraAssets.charaGraph.costume` 的键。它们与解锁条件中的灵衣内部 ID、名称覆写中的 `limitCount` 不是同一套编号，不能直接混用。

## 依赖的源字段

| 字段 | 用途 |
| --- | --- |
| `extraAssets.charaGraph.ascension` / `costume` | 枚举可用再临和灵衣 |
| `profile.costume[battleCharaId].id` | 将灵衣内部 ID 映射为 `battleCharaId` |
| `skills[].skillSvts[].releaseConditions[]` | 技能的形态解锁条件 |
| `noblePhantasms[].npSvts[].releaseConditions[]` | 宝具的形态解锁条件 |
| `noblePhantasms[].script.tdTypeChangeIDs` | 关联可切换宝具的形态归属 |
| `noblePhantasms[].script.tdChangeByBattlePoint[]` | 标记只在战斗中出现的宝具 |
| `ascensionAdd.overWriteTDName` | 将形态对应的可见宝具覆写名加入候选 |
| `script.SkillRankUp` | 汇总阶段递归追加可点击的技能切换形态 |

## 静态形态分组规则

1. **解析条件。** 收集技能和宝具中 `condType` 为 `equipWithTargetCostume` 的 `condNum`。优先将其按 `profile.costume[*].id` 解析为灵衣；没有匹配灵衣时，仅在 `condTargetId` 指向当前从者且编号匹配再临战斗形态的情况下，按再临条件解析。第三再临战斗形态同时覆盖立绘编号 `3` 和 `4`。
2. **关联宝具。** 通过 `tdTypeChangeIDs` 合并关联宝具自身的非空条件集合，将共享同一形态的宝具归入对应组。
3. **合并条件组。** 同一技能或宝具中出现的条件连接到同一组，连接关系可传递。每个连通分量形成一个覆写形态。
4. **生成默认形态。** 未参与覆写组的再临与灵衣组成默认形态，收纳无条件技能和宝具。没有默认编号时不生成这一组。
5. **生成覆写形态。** 将每组条件解析为实际 `ids`，收纳条件与该组相交的条目。技能按槽处理：当前组有专属技能时替换该槽的全部共用候选；否则继承无形态限制的共用技能，不继承其他组的专属技能。共用技能即使没有默认形态也保留，并保持源顺序、按 ID 去重及 `targetingMode` 元数据。宝具仍只收纳匹配当前组的条目，按名称去重。默认组在前，其余组按最小形态编号排序。
6. **补充可见名称。** 根据 `ascensionAdd.overWriteTDName` 向对应形态追加宝具覆写名。再临 `limitCount` 的转换为 `0 → 1`、`1/2 → 2`、`3 → 3`、`4 → 4`；灵衣覆写通过内部 ID 映射到 `battleCharaId`。

仅在战斗中出现的宝具不会作为普通候选输出。当前规则包括：无灵衣条件的 `tdTypeChangeIDs` 组中 `num >= 90` 的条目、借由关联获得条件但自身无条件的动态条目，以及 `tdChangeByBattlePoint` 引用的条目。相关规则见 [源码](../src/build-variants.ts) 与 [测试](../test/build-variants.test.ts)。

## 运行时技能

静态文件保持源形态技能列表。汇总时，从每个形态各槽位已有技能出发，沿 `script.SkillRankUp` 递归追加可切换技能，并标记 `runtime: true`。追加技能只归属于可从其静态技能到达的形态和槽位。

依赖的完整响应位于 `assets/skills/<skillId>/skill.json` 与 `skill_cn.json`，可先执行 `npm run atlas:download-runtime-skills` 下载。缺少依赖时应先补齐缓存，再生成汇总。

`runtime` 标记不描述具体触发条件，也不会沿 `selfturnendFunction` 等内部效果收集隐藏执行技能。占位宝具名与同名不同 ID 的技能会按源数据保留。不要根据名称相同就合并技能 ID。

## 修改与验证

修改分组规则时，优先为对应的条件组合添加最小测试输入，再运行 Atlas 模块单元测试和 `npm run verify:variants`。测试数据不应依赖固定的全服从者数量；真实数据统计随上游版本变化，应从当前输出计算。
