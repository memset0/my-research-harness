// Generates the markdown prompt body for the "Ask Claude Code" handoff dialog.
//
// Deterministic given the inputs: same experiment + same recent journal events
// produces identical prompt text. Bounded in size (max 10 events) so the
// clipboard payload stays well under typical limits.

import type { FullExperiment, JournalEvent } from './api'

const MAX_EVENTS = 10

export function buildAgentPrompt(input: {
  experiment: FullExperiment
  recentJournalEvents: JournalEvent[]
  projectRoot: string
}): string {
  const exp = input.experiment
  const fm = exp.frontMatter
  const events = input.recentJournalEvents
    .filter((e) => e.runId === exp.id)
    .slice(0, MAX_EVENTS)

  const hypothesisLine =
    fm.hypotheses.length > 0 ? fm.hypotheses.join(', ') : '(none linked)'

  const eventLines =
    events.length > 0
      ? events.map((e) => `- ${e.timestamp} [${e.tag}] ${e.body}`).join('\n')
      : '(no related events)'

  return `请总结实验 \`${exp.id}\`。

实验目录: ${exp.path}
README:   ${exp.path}/README.md
状态: ${fm.status}
关联假说: ${hypothesisLine}
hypotheses: ${input.projectRoot}/docs/hypotheses.md

最近的 JOURNAL 事件(本实验相关,最多 ${MAX_EVENTS} 条):
${eventLines}

请阅读 README 全文 + 上面提到的 JOURNAL 事件,然后:
1. 用 1-2 句话讲清这个实验在测什么(motivation)
2. 列出 result 中最关键的 2-3 个数字 / 观察
3. 判断关联假说当前应该是 ✅ CONFIRMED / ❌ REFUTED / 🟡 PARTIAL,以及理由
4. 如果发现新假说,提议加到 docs/hypotheses.md 的格式

请用中文回答。`
}

export function buildCdSnippet(projectRoot: string): string {
  return `cd ${projectRoot} && claude`
}
