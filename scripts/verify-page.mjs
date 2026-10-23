#!/usr/bin/env node
// Rendered-page check for the dashboard (AGENTS.md §4.3, failure mode F1).
//
// Opens one URL in headless Chrome over the DevTools protocol, waits for the
// client to render, optionally clicks and reloads, and prints one JSON report:
// the main document status, failed requests (HTTP >= 400 or network errors),
// uncaught page exceptions and the values of `--eval` expressions. It exits 1
// when a `--wait` selector never appears, a request answers 5xx, a request
// fails at the network level or the page throws. Needs Node >= 22 (global
// WebSocket) and a local Chrome or Chromium.
//
//   node scripts/verify-page.mjs http://localhost:3737/local/project-a/r/1 \
//     --auth-file /path/to/user-colon-password --wait '[data-report-html-wrapper]' \
//     --eval 'document.title' --click 'text=Expand' \
//     --eval 'location.search' --reload --screenshot /tmp/page.png
//
// Options (repeatable ones run in the order given):
//   --auth-file <file>  owner Basic credentials as `user:password`; otherwise
//                       MEMON_USER / MEMON_PASS, otherwise anonymous
//   --wait <css>        wait until the selector matches (default: body)
//   --eval <js>         evaluate an expression and record its JSON value
//   --click <target>    click a CSS selector, or `text=<label>` for the first
//                       button, link or menu item whose text is exactly <label>
//   --reload            reload, then wait for the `--wait` selector again
//   --sleep <ms>        pause between steps
//   --screenshot <png>  save a PNG of the final state
//   --timeout <ms>      per-wait timeout (default 20000)
//   --width <px>        viewport width (default 1280; 390 checks mobile)
//   --chrome <path>     browser binary (default: $CHROME or a platform default)

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function usage(message) {
  process.stderr.write(`verify-page: ${message}\nSee the header of scripts/verify-page.mjs.\n`)
  process.exit(2)
}

const args = process.argv.slice(2)
const url = args.shift()
if (!url || url.startsWith('--')) usage('the first argument must be the page URL')
const steps = []
const options = { wait: 'body', timeout: 20_000, width: 1280 }
while (args.length > 0) {
  const flag = args.shift()
  const value = () => args.shift() ?? usage(`${flag} needs a value`)
  if (flag === '--auth-file') options.authFile = value()
  else if (flag === '--wait') options.wait = value()
  else if (flag === '--timeout') options.timeout = Number(value())
  else if (flag === '--width') options.width = Number(value())
  else if (flag === '--screenshot') options.screenshot = value()
  else if (flag === '--chrome') options.chrome = value()
  else if (flag === '--eval') steps.push({ kind: 'eval', expression: value() })
  else if (flag === '--click') steps.push({ kind: 'click', target: value() })
  else if (flag === '--sleep') steps.push({ kind: 'sleep', ms: Number(value()) })
  else if (flag === '--reload') steps.push({ kind: 'reload' })
  else usage(`unknown option ${flag}`)
}
if (typeof WebSocket === 'undefined') usage('Node >= 22 is required (global WebSocket)')

const credentials = options.authFile
  ? readFileSync(options.authFile, 'utf8').trim()
  : process.env.MEMON_USER && process.env.MEMON_PASS
    ? `${process.env.MEMON_USER}:${process.env.MEMON_PASS}`
    : null

const chromePath =
  options.chrome ??
  process.env.CHROME ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((candidate) => existsSync(candidate))
if (!chromePath) usage('no Chrome found; pass --chrome or set CHROME')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const profile = mkdtempSync(join(tmpdir(), 'verify-page-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${options.width},900`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)

const report = {
  url,
  status: null,
  finalUrl: null,
  waited: null,
  results: [],
  failedRequests: [],
  exceptions: [],
}

async function devtoolsEndpoint() {
  // Chrome prints the browser endpoint on stderr once the port is bound.
  let output = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 15_000)
    chrome.stderr.on('data', (chunk) => {
      output += chunk
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timer)
        resolve(new URL(match[1]))
      }
    })
    chrome.on('exit', () => reject(new Error('Chrome exited before it was ready')))
  })
}

try {
  const browser = await devtoolsEndpoint()
  const targets = await (await fetch(`http://${browser.host}/json`)).json()
  const page = targets.find((target) => target.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve))
  let seq = 0
  const pending = new Map()
  const requests = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
      return
    }
    const { method, params } = message
    if (method === 'Network.requestWillBeSent') requests.set(params.requestId, params.request.url)
    else if (method === 'Network.responseReceived') {
      const { status, url: responseUrl } = params.response
      if (params.type === 'Document' && params.frameId === page.id) report.status = status
      if (status >= 400) report.failedRequests.push({ status, url: responseUrl })
    } else if (method === 'Network.loadingFailed' && !params.canceled) {
      report.failedRequests.push({
        status: null,
        url: requests.get(params.requestId),
        error: params.errorText,
      })
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails
      report.exceptions.push(details.exception?.description ?? details.text)
    } else if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      report.finalUrl = params.frame.url
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (message) =>
        message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message),
      )
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description)
    return result.result.value
  }
  const waitFor = async () => {
    const deadline = Date.now() + options.timeout
    while (Date.now() < deadline) {
      const found = await evaluate(
        `document.readyState !== 'loading' && !!document.querySelector(${JSON.stringify(options.wait)})`,
      ).catch(() => false)
      if (found) return true
      await sleep(250)
    }
    return false
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  if (credentials)
    await send('Network.setExtraHTTPHeaders', {
      headers: { Authorization: `Basic ${Buffer.from(credentials).toString('base64')}` },
    })
  report.finalUrl = url.split('#')[0]
  await send('Page.navigate', { url })
  report.waited = await waitFor()

  for (const step of steps) {
    if (step.kind === 'eval') {
      report.results.push({
        eval: step.expression,
        value: await evaluate(step.expression).catch((error) => `error: ${error.message}`),
      })
    } else if (step.kind === 'click') {
      const text = step.target.startsWith('text=') ? step.target.slice(5) : null
      const clicked = await evaluate(`(() => {
        const element = ${
          text === null
            ? `document.querySelector(${JSON.stringify(step.target)})`
            : `[...document.querySelectorAll('button, a, [role="menuitem"]')].find((node) => node.textContent.trim() === ${JSON.stringify(text)})`
        }
        if (!element) return false
        element.click()
        return true
      })()`)
      report.results.push({ click: step.target, clicked })
      await sleep(300)
    } else if (step.kind === 'sleep') {
      await sleep(step.ms)
    } else if (step.kind === 'reload') {
      await send('Page.reload')
      await sleep(300)
      report.results.push({ reload: true, waited: await waitFor() })
    }
  }

  if (options.screenshot) {
    const { result } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(options.screenshot, Buffer.from(result.data, 'base64'))
    report.screenshot = options.screenshot
  }
  ws.close()
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  chrome.kill()
  await sleep(200)
  rmSync(profile, { recursive: true, force: true })
}

const failed =
  Boolean(report.error) ||
  report.waited === false ||
  report.results.some((result) => result.waited === false || result.clicked === false) ||
  report.failedRequests.some((request) => request.status === null || request.status >= 500) ||
  report.exceptions.length > 0
report.ok = !failed
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exit(failed ? 1 : 0)
