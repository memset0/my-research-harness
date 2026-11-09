# Handoff：按需把 Report 中的讨论迁移到原生 Discussions

将下面的提示词交给研究项目的开发 agent。它处理的是可选的内容整理，
不是 `v11 → v12` 文件约定迁移，也不要求每个项目或每份 Report 都执行。
本文件本身不会迁移任何项目内容。

---

请把本项目中原来维护在 Reports 里的讨论内容，按需迁移到 memon 原生
Discussions。先读取本项目的 AGENTS.md、已安装的 memon 技能及实际源文件，
在项目源端操作。遵守项目已有的写锁、并发编辑和 Git 约定。

## 目标与范围

- 迁移我指定的 Report、讨论主题或问题；没有指定具体范围时，先列出候选项
  和建议迁移的范围，和我确定后再写入。不要批量转换所有 Reports。
- 仍需要用户与 agent 往返、选择方案、确认或记录决策的内容适合 Discussions。
  论文、实验总结、纯资料和独立应用继续保留其原有形式。
- 同一份 Report 可以包含讨论和其他内容，只迁移选中的讨论部分。
  可以按主题拆为多份 Discussion，也可以保留为一份；按实际内容组织。
- 保留原 Report、原始评论、决策文件、附件及历史记录，不删除旧文件，
  不停止原有服务。新 Discussion 明确标注原始来源及迁移时的内容版本。
- 这是内容迁移授权，不包含修改 `.memon/version.json`、升级 File Agent、
  扩大网站写入权限或改造现有应用的授权。若技能预检报告 FS 版本不匹配，
  单独报告并按已有授权处理；没有授权时先完成只读盘点，不绕过预检。

## 先盘点，避免丢失语义

1. 检查 `memon --version`、`memon discussion --help` 及安装的研究技能，
   确认实际调用的是支持 discussion 的 v12 CLI。
2. 读取原 Report 的入口、相关 Markdown/HTML、决策或评论数据和附件。
   区分原始资料与派生页面，不能只抓取页面上可见的一小段文字。
3. 列出每个主题的原问题 ID、题意、选项、用户意见、agent 建议、已确认决定、
   未决事项、附件引用和来源位置。建立“旧来源/问题 → 新 D ID/问题 ID”映射。
4. 先检查已有 Discussions 及其来源记录，复用已经迁移的主题；重复执行不得
   重新创建同一批内容。记录初始 Git 状态，保护其他 agent 的改动和暂存区。

## 使用原生结构

通过 CLI 分配 Discussion ID，不手动猜测下一个编号：

```sh
memon --project-root . discussion create selected-topic --title '选中主题的讨论'
```

使用返回的目录 `docs/discussions/D<NNNN>-<slug>/`。创建时为 `DRAFT`，
整理完成并验证之后再发布。README 的最小结构如下：

````markdown
---
title: 选中主题的讨论
status: DRAFT
categories:
  - 已商定的分类
---

来源：原 Report 的项目内链接及原问题位置。
本次迁移范围、来源版本与未迁移部分说明。

## 需要选择哪种方案

```question
id: APPROACH
type: choice
category: 已商定的分类
status: OPEN
options:
  - id: a
    label: 方案 A
  - id: b
    label: 方案 B
prefer:
  option: a
  reason: 原 agent 的建议及依据，只有原文明确存在时才填写。
```

保留原问题的背景、证据、限制与相关资料。不要为了简短改变原问题含义。
````

- 问题标题的紧接下一块必须是 `question` 代码块。其后的正文直到下一个同级
  或更高级标题属于该问题；小标题和富内容可以继续保留。
- 问题 ID 在 Discussion 内唯一、稳定，只用大写字母、数字和 `-`，最多
  64 字符。合法的原 ID 可保留；改名时写入映射，后续不要随意更换。
- 类型按原意选择：`choice` 单选、`multi` 多选、`confirm` 同意/不同意、
  `text` 开放回答。不要把多选改成单选或凭空添加互斥选项。
- 分类由用户和 agent 按内容确定，无固定分类表；不确定时提出建议供用户调整。
- 图片、表格、HTML 和现有 Markdown 组件可以保留。需要搬移的附件复制到
  Discussion 的相对路径下并检查引用；不要只复制 HTML 而遗漏脚本和样式，
  不要复制服务私有数据、会话或凭证。

## 生命周期与历史映射

- Discussion：`DRAFT` 表示 agent 尚未准备好给用户看；`OPEN` 表示继续讨论；
  `CLOSED` 表示讨论结束。不要用 CURRENT/STALE，也不要按年龄自动关闭。
  CLOSED 可以保留尚未解决的问题。
- 问题：未决为 `OPEN`；原文有明确决定时可设 `DECIDED`，填写与题型/选项
  匹配的 `decision`，并在 `rationale` 和正文中保留理由及来源；明确搁置为
  `DEFERRED`，明确放弃为 `DROPPED`。agent 的偏好不能当作用户决定。
- `ANSWERED`、`REVISED` 是原生系统根据响应历史推导的显示状态，不写进问题
  的 `status`，不把旧系统的同名字段机械照搬。
- 旧评论和旧答复以有来源的“迁移前历史”正文保留，尽量保留原作者和原始时间。
  缺失信息标为未知，不伪造。**不要把旧内容伪造成在新系统里发生的 owner
  response/ack，不重建虚假的 snapshot，也不直接编造 responses.jsonl。**
  原生响应日志留给后续真实交互，已有日志必须保留且只追加。
- 如果旧状态、回答或结论互相冲突，保留证据并列为待确认项，不替用户裁决。

## 验证和发布

```sh
memon --project-root . refresh
memon --project-root . discussion show D0001 --json
memon --project-root . discussion pending
memon --project-root . discussion decisions
```

将 `D0001` 换成实际返回的 ID。检查每个问题的解析诊断、类型、选项、状态、
分类、决定和来源映射；检查附件与跨文档链接。刷新若有问题，区分本次讨论
的错误和原有无关诊断，明确报告，不能把退出失败说成全部通过。

检查通过后，用实际 ID 发布已准备好的讨论：

```sh
memon --project-root . discussion status D0001 --status OPEN
```

只迁移已结束历史的 Discussion 可以设为 CLOSED。准备未完成的保持 DRAFT，
在交付中说明原因，不为了让列表有内容而提前发布。
打开网站实际检查卡片、分类、附件及历史正文；如无法浏览或网站仍只读，
准确报告验证边界，不虚构反馈、不自行扩大写权限。

后续继续使用原生工作流读取 `discussion pending`，通过
`discussion resolve D0001/APPROACH --status DECIDED --decision a --note '理由'`
处理真实反馈，通过 `discussion reply D0001/APPROACH '回复'` 追加回复。

最后向我报告：迁移了什么、旧来源到新 D ID/问题 ID 的映射、新页面链接、
保留或未迁移的部分、需要确认的歧义，以及实际执行的验证结果。只提交自己
拥有且项目规则允许提交的文件，绝不混入其他 agent 的改动或已有暂存内容。
