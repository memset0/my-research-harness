# Body translation

Memon can show Simplified Chinese machine translations below the original English
prose in Experiment documents, Wiki pages, and Markdown reports. It never edits
the source documents, changes review marks, or translates navigation and metadata.

## Enable on the serving instance

Translation is **off by default**. Set these environment variables on the Web or
central process, or on the standalone Web process. Restart that process to apply
changes; do not configure remote project nodes or put credentials in a project.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MEMON_TRANSLATION_ENABLED` | unset | Set exactly `1` to enable translation. |
| `MEMON_TRANSLATION_CODEX` | `codex` | Trusted local executable name or absolute executable path; never a shell command. |
| `MEMON_TRANSLATION_AUTH_JSON` | inherited Codex login | Optional path to an existing native `auth.json` credential file. |

The executable can remain `codex` resolved through the service's PATH, or a stable
symlink; Memon never resolves it to a version-specific realpath. The auth file
must be named `auth.json` (Codex's native filename). Its parent is used as the
child's CODEX_HOME and file credential storage is enforced; Memon does not read,
copy, or relocate tokens. Relative auth paths resolve from the serving process's
working directory; prefer an absolute auth path. Missing/unreadable files fail
with `INVALID_AUTH_PATH`. This replaces `MEMON_TRANSLATION_CODEX_HOME`.

Use the serving process's own ChatGPT login. The tested CLI is **codex-cli
0.153.4**, with model **`gpt-5.3-codex-spark`**. Other CLI versions fail closed
until their protocol and isolation have been revalidated. This is deliberately an
exact version gate, not a promise that newer versions have identical safety
semantics. Missing login, API-key-only authentication, unavailable Spark, and
custom overrides of the built-in OpenAI provider are not silently worked around.

Codex owns credential loading and refresh. Memon strips API-key/provider override
environment variables and never returns account identity, tokens, raw provider
errors, or stderr to the browser. No alternative model or API billing is used.

## Reading

1. Open an Experiment, Wiki page, or Markdown report as the owner.
2. Click **Translate to Chinese** after the availability check succeeds, or press **Alt+T**.
3. Read the original and the indented Chinese translation together. The control
   shows completed/total segments and failures.
4. Click the same button (**Show original**) to hide translations and cancel pending work.
   Click again to restore completed translations for the unchanged body without another request.
   Use **Retry unfinished segments** to retry failures while retaining successful segments.

Only an explicit translation or retry sends prose to Codex and consumes Spark
quota. Opening a page checks availability without inference. The disclosure
beside the control explains upstream transmission. Viewer sessions have no
translation controls and cannot call either translation endpoint.

Source updates, navigation, editing, and unmount cancel obsolete subscriptions;
updated text requires another explicit click. Identical requests from multiple
views share work; closing one does not interrupt another remaining subscriber.
Readiness does not guarantee remaining quota or future provider availability.

Cache delivery does not wait for the Codex readiness probe. On an explicit toggle,
the initial body-manifest request returns all validated SQLite cache hits together;
a fully cached body needs no translation POST. Remaining packs are submitted
concurrently, and each response updates independently. Only misses enter the
server's bounded queue and shared two-slot Codex gate. A failed pack does not block
other packs; a stale revision clears results and cancels sibling requests.
SQLite reads use bounded bulk queries and one access-time transaction instead of
separate commits for each segment. The persistent cache identity and expiry rules
are unchanged.

## Included and excluded content

Eligible content includes authored headings, paragraphs, list and quote prose,
Markdown table prose, structured Experiment descriptions/criteria/outcomes,
Results annotations and variant names, and valid `figure@1` visible captions.
Code, formulas, numbers, artifact IDs, link destinations, and inline formatting
are protected by trusted placeholders. Translations cannot introduce HTML,
handlers, new link targets, or embeds.

Frontmatter, page titles derived from metadata, generated outlines, diagnostics,
status controls, run panels, raw YAML/component payloads, image alt text, numeric
results, and HTML/iframe interiors are excluded. An HTML-only report reports no
eligible body. Oversized Markdown prose splits at safe whitespace boundaries;
indivisible oversized blocks or literal captions/titles fail visibly rather than
exceeding the provider limit.

## Limits and troubleshooting

- At most two active translation batches per serving process; at most 32 queued batches.
  A shared two-slot gate also includes readiness checks and executable probes, with
  at most 32 waiting invocations. Waiting is cancellable and times out after 120
  seconds by default; a slot is held until process cleanup completes.
- Up to 24 segments and 12,000 serialized UTF-8 input bytes per batch, with a
  150 ms coalescing delay. The fixed prompt is additional bounded overhead.
- Invocation timeout: 120 seconds after app-server launch; executable/version
  probes have separate 5-second deadlines. Provider stdout ceiling: 256 KiB.
- HTTP request ceiling: 32 KiB. A remote document response is capped at 5 MiB.
- Durable SQLite cache: `memon-translations.sqlite3` beside the serving config,
  private file permissions,30-day retention,10,000 entries and64 MiB of stored
  key/result bytes with LRU eviction. No extra deployment setting is required.
  Successful translations survive restarts and are reused without paid calls.
- A small memory layer retains at most2,000 entries/16 MiB for30 minutes.
  Authorization, exact document revision/model/format identity, and protected
  output validation precede reuse. Only translations and hashed keys are stored;
  no original prompts or credentials. SQLite read/write errors surface as
  `CACHE_UNAVAILABLE`, not silent uncached paid retranslations. The database and
  its journal files contain research-derived text: protect them like other local
  state, keep them out of source control, and stop the process before deleting
  the database and its sidecars to clear persistent translations.

Unavailable controls provide **重新检查服务** after the operator fixes login,
executable, configuration, or CLI compatibility. Quota errors stop further model
calls until explicit retry. Queue-full errors mean retry later. A body-revision
conflict means refresh the document before translating again. A malformed model
result fails only its affected segments; successful translations remain usable.
Only an early transport/process exit gets one automatic retry with bounded
backoff. Disabling the feature and restarting prevents all new translation calls.

## Keyboard shortcut

Owners can press **Alt+T** to toggle translation/original for the focused or last
interacted-with document body, falling back to the first body. Stopping cancels
pending work. Inputs, editors, editing-only dialogs, composition, and key repeats
are ignored. Hidden dialogs do not block the shortcut; a visible reading drawer
targets its own body, not the obscured page. Capture-phase handling avoids losing
the key to ordinary bubbling handlers. After deployment, reload the page to load
the new keyboard handler. If the OS/browser reserves Alt+T before it reaches the
page, use the visible translation/original toggle button instead.
Enabling the service makes the controls available; opening a page still does not
automatically spend quota.

## Implementation and reference provenance

The extraction and batching behavior was informed by `fishjar/kiss-translator`
at `13828a8a37bb4e3b4c6a2c562bc45494dead831a`. The local app-server lifecycle was
informed by `memset0/paperland` at `06aab1019d2120f2d641670aa25261883c3662fe`.
This implementation is independently written: no upstream source was vendored.
Kiss Translator is GPL-3.0; the inspected Paperland snapshot had no root license.

The translator runs in an ephemeral non-project directory with empty execution
environments, tool/skill/MCP discovery disabled, and no inherited project
instructions. The tested CLI's outbound Responses fixture contained `tools: []`.
Unexpected tool requests terminate the process. Read-only sandboxing alone is
not the isolation boundary.
