// Git sync of a Project's cluster checkout around a ticket: pull (or clone)
// before the start command runs, and on end commit + push only the Run
// directories that record the ticket. Both scripts run on the granted node
// through its herdr machine, outside the ticket's GPU environment, and end
// with one marker line the broker parses. Git never prompts.

/** Bytes of Git output kept on the ticket. */
export const SYNC_OUTPUT_LIMIT = 4096

const PULL_MARK = '__MEMON_SYNC__'
const PUSH_MARK = '__MEMON_PUSH__'
const UNRECORDED_MARK = '__MEMON_UNRECORDED__'

/** argv: root, origin ('' when unknown). */
export const PULL_SCRIPT = `
root=$1 origin=$2
export GIT_TERMINAL_PROMPT=0
if [ ! -e "$root/.git" ]; then
  if [ -e "$root" ] && [ -n "$(ls -A "$root" 2>/dev/null)" ]; then
    echo "$root exists but is not a Git checkout"; echo "${PULL_MARK} 1"; exit 0
  fi
  if [ -z "$origin" ]; then
    echo "$root is missing and the Project's origin is unknown"; echo "${PULL_MARK} 1"; exit 0
  fi
  mkdir -p "$(dirname "$root")" && git clone -- "$origin" "$root" 2>&1
  rc=$?
else
  git -C "$root" pull --no-rebase 2>&1
  rc=$?
fi
echo "${PULL_MARK} $rc $(git -C "$root" rev-parse HEAD 2>/dev/null)"
`

/** argv: root, ticket id. */
export const PUSH_SCRIPT = `
root=$1 ticket=$2
export GIT_TERMINAL_PROMPT=0
cd "$root" 2>/dev/null || { echo "$root is not reachable"; echo "${PUSH_MARK} PUSH_FAILED"; exit 0; }
# Changed Run directories: the nearest ancestor holding run.json of every
# changed or untracked path that .gitignore lets through.
dirs=$(git status --porcelain -uall | sed 's/^...//; s/.* -> //' | while IFS= read -r path; do
  d=$(dirname "$path")
  while [ "$d" != "." ] && [ "$d" != "/" ]; do
    if [ -f "$d/run.json" ]; then echo "$d"; break; fi
    d=$(dirname "$d")
  done
done | sort -u)
set --
for d in $dirs; do
  if grep -qF "\\"$ticket\\"" "$d/run.json"; then set -- "$@" "$d"
  elif ! grep -q '"resources"' "$d/run.json"; then echo "${UNRECORDED_MARK} $d"
  fi
done
if [ $# -eq 0 ]; then echo "${PUSH_MARK} NOTHING_TO_PUSH"; exit 0; fi
git add -- "$@" 2>&1
if git diff --cached --quiet -- "$@"; then echo "${PUSH_MARK} NOTHING_TO_PUSH"; exit 0; fi
git commit -q -m "chore(runs): record $ticket" --only -- "$@" 2>&1 || { echo "${PUSH_MARK} PUSH_FAILED"; exit 0; }
commit=$(git rev-parse HEAD)
for attempt in 1 2 3 4; do
  if git push 2>&1; then echo "${PUSH_MARK} PUSHED $commit"; exit 0; fi
  [ "$attempt" = 4 ] && break
  git pull --no-rebase 2>&1 || break
done
echo "${PUSH_MARK} PUSH_FAILED $commit"
`

const tail = (text: string) =>
  text.length <= SYNC_OUTPUT_LIMIT ? text : `…${text.slice(-(SYNC_OUTPUT_LIMIT - 1))}`

/** Strip marker lines and keep the last 4 KiB of what Git printed. */
function outputOf(stdout: string, stderr: string): string {
  return tail(
    `${stdout}${stderr}`
      .split('\n')
      .filter((line) => !line.startsWith('__MEMON_'))
      .join('\n')
      .trim(),
  )
}

export interface PullResult {
  ok: boolean
  commit: string | null
  output: string
}

export function parsePull(result: { code: number; stdout: string; stderr: string }): PullResult {
  const mark = result.stdout
    .split('\n')
    .reverse()
    .find((line) => line.startsWith(PULL_MARK))
  const [, rc, commit] = (mark ?? '').split(' ')
  return {
    ok: result.code === 0 && rc === '0' && /^[0-9a-f]{40}$/.test(commit ?? ''),
    commit: /^[0-9a-f]{40}$/.test(commit ?? '') ? (commit as string) : null,
    output:
      outputOf(result.stdout, result.stderr) ||
      (mark ? '' : `sync did not finish (exit ${result.code})`),
  }
}

export interface PushResult {
  state: 'PUSHED' | 'NOTHING_TO_PUSH' | 'PUSH_FAILED'
  commit: string | null
  unrecorded: string[]
  output: string
}

export function parsePush(result: { code: number; stdout: string; stderr: string }): PushResult {
  const lines = result.stdout.split('\n')
  const mark = [...lines].reverse().find((line) => line.startsWith(PUSH_MARK))
  const [, state, commit] = (mark ?? '').split(' ')
  return {
    state:
      result.code === 0 && (state === 'PUSHED' || state === 'NOTHING_TO_PUSH')
        ? state
        : 'PUSH_FAILED',
    commit: /^[0-9a-f]{40}$/.test(commit ?? '') ? (commit as string) : null,
    unrecorded: lines
      .filter((line) => line.startsWith(`${UNRECORDED_MARK} `))
      .map((line) => line.slice(UNRECORDED_MARK.length + 1)),
    output:
      outputOf(result.stdout, result.stderr) ||
      (mark ? '' : `push did not finish (exit ${result.code})`),
  }
}
