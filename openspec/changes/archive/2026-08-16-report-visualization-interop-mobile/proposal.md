## Why

HTML Report bundles can already embed trusted, same-origin visualizations, but
the current contract assumes `memon-write-report` authors every visualization
itself and the web UI renders each iframe at a mostly fixed height with no
loading, recovery, or viewing controls. That leaves no safe collaboration
boundary for a project-installed visualization skill and produces a brittle
experience on phone-sized viewports.

We need a framework-independent static-output contract: a visualization skill
can focus on one delegated view, while `memon-write-report` continues to own the
Report narrative, evidence selection, and final acceptance. The dashboard then
needs a responsive host around the existing trusted iframe without changing the
v1 trust decision or forcing existing Reports to migrate.

## What Changes

- Define an HTML Report bundle as a framework-agnostic static visualization
  container. Plain HTML and compiled output from any frontend framework are both
  valid when the checked-in result runs directly from the Report asset route.
- Reserve `views/<slug>/` as the write namespace for a newly delegated
  visualization. Each delegated view emits static HTML/assets and reads
  writer-owned normalized evidence from root `data/*.json` through relative
  URLs; view-local JSON is limited to presentation configuration.
- Make `memon-write-report` the coordinator and final acceptance owner. It may
  invoke a suitable visualization skill already installed for the project, but
  the delegate may write only its assigned view namespace and never manages the
  Report `README.md` or frontmatter.
- Require the writer to verify every delegated view through memon's asset route
  at a 390 CSS-pixel mobile viewport and at a representative desktop viewport.
- Replace the bare Report iframe presentation with a responsive wrapper that
  exposes loading, error, Retry, Open in new tab, and fullscreen states/actions,
  using small/dynamic viewport height units rather than a desktop-sized fixed
  minimum.
- Preserve the existing unsandboxed same-origin trust model and Report-directory
  path confinement.
- Do not introduce a bundle manifest, declared iframe dimensions, postMessage
  sizing protocol, or other automatic iframe-height mechanism.
- Keep standalone Markdown Reports and all existing directory bundles valid,
  including bundles whose HTML entry files are not under `views/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reports-store`: defines static, framework-independent delegated view output
  while retaining both existing Report forms and the current trust boundary.
- `memon-skills`: lets `memon-write-report` coordinate an optional external
  visualization skill under a strict namespace and retain final acceptance.
- `web-dashboard`: hosts embedded Report HTML in a responsive, recoverable
  iframe wrapper with mobile and desktop behavior.

## Impact

- `packages/skills/memon-write-report/SKILL.md` and
  `packages/skills/README.md`: delegation handoff, namespace ownership, static
  output rules, and final acceptance checklist.
- `apps/web/components/markdown.tsx` and a reusable Report-embed component:
  iframe state, controls, and responsive viewport sizing.
- Web browser/component tests plus compatibility coverage for the already
  supported nested Report asset route: trust behavior and 390px/desktop
  acceptance. No Report server behavior change is required.
- No new Report manifest, CLI CRUD/lint schema, FS convention bump, data
  migration, or requirement to install a particular visualization framework or
  skill.
