# 第三方来源与许可说明

本项目的 [MIT 许可证](LICENSE) 适用于原创工具源码和原创文档。第三方数据集、游戏名称与文本、图片、媒体及依赖保留各自的权利和适用条款。`assets/`、`resources/` 和生成的分析报告属于数据内容，不因使用本项目工具而统一取得 MIT 许可。数据相关配置与测试样例也需要按其来源判断。

## Atlas Academy

本项目通过 [Atlas Academy API](https://api.atlasacademy.io/docs) 获取 JP/CN 结构化数据，并使用其资源服务提供的图片和图标地址。工具会选择字段、推导目标选择元数据与战斗形态、合并条目，并生成 Mash 资源文件；这些产物经过处理，并非未经修改的 Atlas 导出。

Atlas Academy 的 [官方许可说明](https://atlasacademy.io/about-us/) 将其收集的数据列为 **Open Data Commons Attribution License 1.0（ODC-BY 1.0）**。分发相关数据库或衍生数据库数据时，应保留 Atlas Academy 署名、适用的原始声明及 [许可证链接](https://opendatacommons.org/licenses/by/1-0/)。本项目不代替 Atlas Academy 授予权利。

ODC-BY 规范数据库权利，不覆盖单项内容独立享有的全部著作权，参见其序言与第 2.4 节。游戏图片、描述、对话等内容需要分别确认适用权利；本说明不构成这些内容的再分发授权。

Atlas API 服务端的 [AGPL-3.0 软件许可证](https://github.com/atlasacademy/fgo-game-data-api/blob/master/LICENSE) 与数据库许可声明是两回事。调用 API 不代表本仓库包含其服务端源码；如引入第三方代码，仍需保留对应许可证与声明。

## 依赖与资源包

第三方依赖保留各自许可证，详情见包元数据、许可证文件及锁文件。分发软件时，如果依赖条款要求附带其许可文本，本说明不能替代这些文本。

客户端资源包是独立的分发产物，需要随导出数据携带适用的来源与许可说明。仓库分离本身不能替代资源包中的声明；当前打包工具尚未自动完成这项附带声明工作，发布者需要在分发前落实。
