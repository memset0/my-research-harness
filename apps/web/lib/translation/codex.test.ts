// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runCodexTranslation, translationAuthHome, translationEnvironment } from './codex'

it('uses the selected native auth file without reading or copying its contents', async () => {
  await fixture()
  const authJson = join(directory, 'auth.json')
  await writeFile(authJson, 'opaque fixture: wrapper must not parse this')
  expect(await translationAuthHome(authJson)).toBe(directory)
  expect(translationEnvironment(directory).CODEX_HOME).toBe(directory)
  await runCodexTranslation({ executable, authJson }, null)
  const launch = JSON.parse(await readFile(join(directory, 'launch'), 'utf8'))
  expect(launch.home).toBe(directory)
  expect(launch.args).toContain('cli_auth_credentials_store="file"')
  expect(await readFile(authJson, 'utf8')).toBe('opaque fixture: wrapper must not parse this')
})

it('rejects missing, non-native and directory auth paths before executing Codex', async () => {
  for (const authJson of [join(directory, 'auth.json'), join(directory, 'other.json'), directory]) {
    await expect(runCodexTranslation({ executable, authJson }, null)).rejects.toMatchObject({
      code: 'INVALID_AUTH_PATH',
    })
  }
  expect(await translationAuthHome()).toBeUndefined()
})

let directory: string
let executable: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-provider-test-'))
  executable = join(directory, 'codex')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function fixture(mode = 'success') {
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const mode = ${JSON.stringify(mode)};
if (process.argv[2] === '--version') { console.log(mode === 'version' ? 'codex-cli 0.1.0' : 'codex-cli 0.153.4'); process.exit(0); }
if (process.argv[2] === 'features') { console.log('shell_tool stable true'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(join(directory, 'cwd'))}, process.cwd());
fs.writeFileSync(${JSON.stringify(join(directory, 'launch'))}, JSON.stringify({home:process.env.CODEX_HOME,args:process.argv.slice(2)}));
const send = (value) => { const bytes = Buffer.from(JSON.stringify(value)+'\\n'); for (const byte of bytes) process.stdout.write(Buffer.from([byte])); };
readline.createInterface({input: process.stdin}).on('line', line => {
 const message = JSON.parse(line); const params = message.params;
 fs.appendFileSync(${JSON.stringify(join(directory, 'requests'))}, line+'\\n');
 const reply = result => send({id:message.id,result});
 if (message.method === 'initialize') reply({});
 if (message.method === 'account/read') reply({account:{type: mode === 'auth' ? 'apiKey' : 'chatgpt'}});
 if (message.method === 'model/list') reply({data:mode === 'model' ? [] : [{model:'gpt-5.3-codex-spark'}],nextCursor:null});
 if (message.method === 'config/read') reply({config:{mcp_servers:{example:{enabled:true}}}});
 if (message.method === 'thread/start') reply({thread:{id:'thread',ephemeral:true},model:'gpt-5.3-codex-spark',modelProvider:'openai'});
 if (message.method === 'turn/start') {
   reply({turn:{id:'turn'}});
   if (mode === 'exit') process.exit(1);
   if (mode === 'timeout') return;
   if (mode === 'tool') { send({id:100,method:'item/tool/call',params:{threadId:'thread',turnId:'turn'}}); return; }
   if (mode === 'overflow') { process.stdout.write('x'.repeat(300000)); return; }
   send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});
   send({method:'item/completed',params:{threadId:'other',turnId:'turn',item:{type:'agentMessage',phase:'final_answer',text:'wrong thread'}}});
   send({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'agentMessage',phase:'commentary',text:'not final'}}});
   send({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'agentMessage',phase:'final_answer',text:'你好，世界。'}}});
   send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:mode === 'quota' ? 'failed':'completed',error:{message:'quota exceeded'}}}});
 }
});
`
  await writeFile(executable, script, { mode: 0o700 })
}

it('handles split UTF-8, correlated final output, isolated ephemeral config and cleanup', async () => {
  await fixture()
  expect(
    await runCodexTranslation({ executable }, { prompt: 'Neutral fixture', target: 'zh-CN' }),
  ).toBe('你好，世界。')
  const requests = (await readFile(join(directory, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const thread = requests.find((request) => request.method === 'thread/start').params
  expect(thread).toMatchObject({
    environments: [],
    ephemeral: true,
    dynamicTools: [],
    developerInstructions: '',
    model: 'gpt-5.3-codex-spark',
    approvalPolicy: 'never',
  })
  expect(thread.config).toMatchObject({
    features: { shell_tool: false },
    orchestrator: { skills: { enabled: false }, mcp: { enabled: false } },
  })
  expect(thread.baseInstructions).toContain('Translate the supplied prose into Simplified Chinese.')
  await runCodexTranslation({ executable }, { prompt: 'Neutral fixture', target: 'en' })
  const english = (await readFile(join(directory, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((request) => request.method === 'thread/start')
    .at(-1).params
  expect(english.baseInstructions).toContain('Translate the supplied prose into English.')
  const cwd = await readFile(join(directory, 'cwd'), 'utf8')
  await expect(stat(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([
  ['version', 'UNTESTED_CODEX_VERSION'],
  ['auth', 'LOGIN_REQUIRED'],
  ['model', 'SPARK_UNAVAILABLE'],
  ['tool', 'UNEXPECTED_TOOL'],
  ['quota', 'QUOTA_EXHAUSTED'],
  ['exit', 'PROVIDER_EXIT'],
  ['overflow', 'OUTPUT_TOO_LARGE'],
  ['timeout', 'TIMEOUT'],
])('fails closed for %s without exposing provider detail', async (mode, code) => {
  await fixture(mode)
  await expect(
    runCodexTranslation(
      { executable, timeoutMs: mode === 'timeout' ? 150 : 3000 },
      { prompt: 'Neutral fixture', target: 'zh-CN' },
    ),
  ).rejects.toMatchObject({ code, message: code })
})

it('does not infer during readiness and cancels active turns', async () => {
  await fixture('timeout')
  expect(await runCodexTranslation({ executable }, null)).toBe('ready')
  expect(await readFile(join(directory, 'requests'), 'utf8')).not.toContain('turn/start')
  const controller = new AbortController()
  const result = runCodexTranslation(
    { executable },
    { prompt: 'Neutral fixture', target: 'zh-CN' },
    controller.signal,
  )
  setTimeout(() => controller.abort(), 150)
  await expect(result).rejects.toMatchObject({ code: 'CANCELLED' })
})

it('shares two Codex slots with readiness and removes cancelled waiters', async () => {
  await fixture('timeout')
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const invoke = (index: number, prompt: string | null) =>
    runCodexTranslation(
      { executable },
      prompt === null ? null : { prompt, target: 'zh-CN' },
      controllers[index]!.signal,
    ).catch((error) => error.code)
  const first = invoke(0, 'First neutral fixture')
  const second = invoke(1, 'Second neutral fixture')
  let third: Promise<string> | undefined
  let cancelled: Promise<string> | undefined
  try {
    await vi.waitFor(
      async () => {
        const requests = await readFile(join(directory, 'requests'), 'utf8')
        expect(requests.match(/"method":"turn\/start"/g)).toHaveLength(2)
      },
      { timeout: 5000 },
    )
    third = invoke(2, null)
    cancelled = invoke(3, null)
    controllers[3]!.abort()
    expect(await cancelled).toBe('CANCELLED')
    const requests = await readFile(join(directory, 'requests'), 'utf8')
    expect(requests.match(/"method":"initialize"/g)).toHaveLength(2)
    controllers[0]!.abort()
    expect(await first).toBe('CANCELLED')
    expect(await third).toBe('ready')
    expect(controllers[1]!.signal.aborted).toBe(false)
  } finally {
    for (const controller of controllers) controller.abort()
    await Promise.all([first, second, third, cancelled])
  }
}, 15_000)
