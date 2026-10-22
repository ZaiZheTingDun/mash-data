# 数据检查与分析报告

本模块提供生成器测试、真实数据完整度检查和分析报告。三者的输入与用途不同，可按下表选择命令。

[返回项目首页](../README.md) · [Atlas 数据工具](../mash-atlasacademy/README.md)

## 命令与输入

所有命令在代码仓库根目录执行，并先按首页安装依赖。

| 命令 | 输入 | 用途 |
| --- | --- | --- |
| `npm run verify:catalogs` | 自动创建的临时测试数据 | 验证从者汇总、地区合并与目录生成，无需私有数据 |
| `npm run verify:variants` | 数据目录中的 JP/CN 从者、形态汇总和技能依赖 | 检查形态技能的来源、名称与图标元数据 |
| `npm run verification:generate` | 从者缓存、JP raw、技能依赖及 `assets/catalogs/servants_variants.json` | 生成全部四类分析报告 |
| `npm run verify:variant-skill-target-types` | 资源形态汇总及对应从者、技能数据 | 单独生成同槽技能目标选择差异报告 |
| `npm --prefix verification run typecheck` | 源码 | TypeScript 类型检查 |

`test:integrity` 是根目录 `verify:variants` 的别名；`verify:all` 是 `verification:generate` 的别名。后者仅生成报告，不会自动执行全部测试。

真实数据命令需要设置：

```bash
export MASH_DATA_ROOT=/absolute/path/to/your-data
npm run verify:variants
npm run verification:generate
```

路径相对于 `MASH_DATA_ROOT`，程序不会从代码仓库中寻找生产数据。完整报告需要已有的源缓存与资源汇总；尤其是目标选择分析会读取 `servant-raw.json`，不能仅用发布用的精简缓存替代。

## 报告内容

报告写入 `$MASH_DATA_ROOT/verification/result/`，重复运行覆盖同名文件。

| 文件 | 内容 |
| --- | --- |
| `target-selection-skills.json` | 技能目标选择分类 |
| `choice-selection-skills.json` | 技能选项、宝具选择相关信息 |
| `runtime-skills.json` | 运行时技能切换依赖与来源信息 |
| `variant-skill-target-types.json` | 同一形态技能槽中，候选技能是否需要目标选择的差异 |

单独生成某类报告：

```bash
npm --prefix verification run verify:target-selection-skills
npm --prefix verification run verify:choice-selection-skills
npm --prefix verification run verify:runtime-skills
npm run verify:variant-skill-target-types
```

报告用于查看数据特征和定位差异。差异报告非空不直接表示脚本执行失败，生成成功也不等同于完整度测试通过；应结合 `verify:variants` 的结果和报告内容判断。

## 开发与排查

源码位于 `src/`，测试位于 `test/`。修改资源生成规则时运行 `verify:catalogs`；修改形态或技能依赖规则时，也运行 Atlas 模块单元测试，并在有完整数据时执行 `verify:variants`。

常见问题：

- **提示 `MASH_DATA_ROOT is required`**：在当前终端配置数据目录，再运行真实数据命令。
- **缺少 raw 或技能 JSON**：先补齐上游缓存与运行时依赖，参见 [Atlas 数据工具](../mash-atlasacademy/README.md)。
- **缺少资源形态汇总**：报告需要已有 `assets/catalogs/servants_variants.json`；可执行 `npm run atlas:combine-variants` 重新生成。
- **技能来源或元数据断言失败**：保留报错中的从者、槽位与技能 ID，检查对应的 JP/CN 源数据及汇总生成顺序。

提交问题时优先附上最小输入和报错信息，生成报告留在自己的数据目录中。
