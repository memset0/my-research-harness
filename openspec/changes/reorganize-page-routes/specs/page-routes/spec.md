## Purpose

Define the one canonical, Host-qualified URL for every project page, how numbers in those URLs are parsed, and how every older URL form reaches its canonical page or is retired.

## ADDED Requirements

### Requirement: Project pages have one canonical Host-qualified route table
Every project page SHALL have exactly one canonical path under `/<host>/<project>`. The canonical table is:

| Page | Canonical path |
|---|---|
| Experiment overview | `/<host>/<project>` and `/<host>/<project>/experiments` |
| Experiment `E<NNNN>-<slug>` | `/<host>/<project>/e/<n>` |
| Wiki list | `/<host>/<project>/wiki` |
| Wiki page `W<NNNN>` | `/<host>/<project>/w/<n>` |
| Report list | `/<host>/<project>/reports` |
| Report `R<NNNN>` | `/<host>/<project>/r/<n>` |
| Journal | `/<host>/<project>/journal` |
| Code-review list | `/<host>/<project>/code-review` |
| Project code review `docs/code-review/<date>-<slug>.md` | `/<host>/<project>/cr/<date>-<slug>` |
| Experiment code review `…/E<NNNN>-<slug>/code-review/<date>-<slug>.md` | `/<host>/<project>/e/<n>/cr/<date>-<slug>` |

`<n>` SHALL be the artifact number written in decimal without leading zeros, and the path SHALL contain no slug for Experiments, Wiki pages or Reports. `/<host>/<project>` and `/<host>/<project>/experiments` SHALL render the same overview; neither SHALL redirect to the other. Every link, redirect, share URL, page title link and copied URL the Web app produces for a project page SHALL use the canonical path. The query parameters `run` and `expanded` keep their existing meaning on the canonical paths. Service applications SHALL keep their `/api/content-services/<host>/<project>/<kind>/<id>/` URLs.

#### Scenario: Experiment link uses its number
- **WHEN** a page links Experiment `E0010-inference-kernels` of Project `project-a` on Host `host-a`
- **THEN** the link is `/host-a/project-a/e/10`

#### Scenario: Report and Wiki links use their numbers
- **WHEN** a page links Report `R0007` and Wiki page `W0012` of Project `project-a` on Host `host-a`
- **THEN** the links are `/host-a/project-a/r/7` and `/host-a/project-a/w/12`

#### Scenario: Code reviews keep date and slug
- **WHEN** a page links the project review `docs/code-review/2026-05-24-fsdp-comm-overlap.md` and the review `docs/experiments/E0005-bf16-flow-matching/code-review/2026-05-22-bf16-precision-guard.md`
- **THEN** the links are `/host-a/project-a/cr/2026-05-24-fsdp-comm-overlap` and `/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard`

#### Scenario: Both overview paths render
- **WHEN** a browser opens `/host-a/project-a` and `/host-a/project-a/experiments`
- **THEN** both render the Experiment overview with status 200 and neither redirects

### Requirement: Numbers in canonical routes are strict
The number segment of `/e/`, `/w/` and `/r/` SHALL be resolved by its numeric value. A number written with leading zeros or with its kind letter (`/r/0010`, `/r/R0010`, `/e/E0010`, `/e/E0010-inference-kernels`) SHALL be answered with a permanent redirect (308) to the unpadded form, keeping the rest of the path and the query. A segment that is not such a number SHALL be a 404. An Experiment number SHALL resolve to the one Experiment directory registered with that number. When no Experiment has the number the response SHALL be the not-found page; a Report or Wiki number that is absent from its catalog SHALL show that surface's own not-found or "Not refreshed" state while its list stays usable. When two Experiment directories carry the same number the page SHALL show a repair error that names both directories and SHALL NOT pick one.

#### Scenario: Padded number redirects
- **WHEN** a browser opens `/host-a/project-a/r/0010?expanded=1`
- **THEN** the response is a 308 to `/host-a/project-a/r/10?expanded=1`

#### Scenario: Old full Experiment id under the new prefix redirects
- **WHEN** a browser opens `/host-a/project-a/e/E0010-inference-kernels?run=sample`
- **THEN** the response is a 308 to `/host-a/project-a/e/10?run=sample`

#### Scenario: Duplicate Experiment number is not guessed
- **WHEN** a Project registers both `E0010-a` and `E0010-b` and a browser opens `/host-a/project-a/e/10`
- **THEN** the page reports that `E0010-a` and `E0010-b` share number 10 and renders neither Experiment

#### Scenario: Missing number
- **WHEN** no Experiment has number 99 and a browser opens `/host-a/project-a/e/99`
- **THEN** the not-found page is shown

### Requirement: Host-qualified legacy page URLs redirect to canonical routes
A GET or HEAD request for a path under `/h/<host>/p/<project>` SHALL be answered with a permanent redirect (308) to the canonical path of the same page, keeping every query parameter, before authentication. The mapping SHALL be:

| Legacy path under `/h/<host>/p/<project>` | Canonical path under `/<host>/<project>` |
|---|---|
| (empty) | (empty) |
| `/e/E<NNNN>[-<slug>]` | `/e/<n>` |
| `/wiki`, `/reports`, `/journal`, `/code-review` | same |
| `/wiki/W<NNNN>` | `/w/<n>` |
| `/reports/R<NNNN>` | `/r/<n>` |
| `/code-review/code-review/<date>-<slug>` | `/cr/<date>-<slug>` |
| `/code-review/experiments/E<NNNN>-<slug>/code-review/<date>-<slug>` | `/e/<n>/cr/<date>-<slug>` |

The redirect SHALL be computed from the path alone, without reading project files. A legacy path that matches none of these forms SHALL be a 404.

#### Scenario: Old Report link with parameters
- **WHEN** a browser opens `/h/host-a/p/project-a/reports/R0010?expanded=1`
- **THEN** the response is a 308 to `/host-a/project-a/r/10?expanded=1` and no authentication is required to receive it

#### Scenario: Old shared link keeps its token
- **WHEN** a viewer opens `/h/host-a/p/project-a/wiki/W0004?share=<token>`
- **THEN** the response is a 308 to `/host-a/project-a/w/4?share=<token>`, where the token is then redeemed normally

#### Scenario: Old Experiment review link
- **WHEN** a browser opens `/h/host-a/p/project-a/code-review/experiments/E0005-bf16-flow-matching/code-review/2026-05-22-bf16-precision-guard`
- **THEN** the response is a 308 to `/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard`

#### Scenario: Unknown legacy subpath
- **WHEN** a browser opens `/h/host-a/p/project-a/unknown`
- **THEN** the response is a 404

### Requirement: Old link forms inside project documents keep resolving
Markdown links in project documents written as `/h/<host>/p/<project>/{e,wiki,reports}/<id>`, `/p/<project>/{e,wiki,reports}/<id>`, or canonical paths SHALL keep resolving to their Experiment, Wiki page or Report, and SHALL be rendered with the target's canonical path. A hostless form SHALL resolve within the Host of the document that contains it. Reference checks that look for links to a Wiki page, such as the refusal to delete a linked page, SHALL recognize all of these forms.

#### Scenario: Hostless link in a README
- **WHEN** an Experiment README on Host `host-a` contains `[kernel report](/p/project-a/reports/R0007)`
- **THEN** the rendered link points to `/host-a/project-a/r/7`

#### Scenario: Canonical link blocks Wiki deletion
- **WHEN** a Report links `/host-a/project-a/w/4` and the owner asks to delete `W0004`
- **THEN** the delete is refused because of that inbound link

### Requirement: Hostless project URLs are retired
Paths under `/p/<project>`, including `/p/<project>/r/<run>` and `/p/<project>/experiments/<run>`, SHALL return 404. They SHALL NOT be redirected, because a hostless path cannot name a Host.

#### Scenario: Hostless project URL
- **WHEN** a browser opens `/p/project-a/reports/R0010`
- **THEN** the response is a 404

### Requirement: The Web app serves only Host-qualified Projects
The Web app SHALL refuse to start with a configuration in which any served Project lacks a Host. The configuration error SHALL say that standalone Web serving was removed and that each Project needs a `host:`. Commands that operate on a project root, such as the `memon` CLI, SHALL NOT require a Host.

#### Scenario: Hostless config is rejected by the Web app
- **WHEN** the Web app starts with a config whose only Project has `name` and `root` but no `host`
- **THEN** startup fails with an error naming the Project and asking for `host:`

#### Scenario: The CLI still works on a project root
- **WHEN** an agent runs `memon show` inside a research project that has no central configuration
- **THEN** the command succeeds without any Host

### Requirement: Host ids cannot shadow top-level routes
The config loader SHALL reject a Host id equal to a top-level route name: `api`, `h`, `login`, `manage`, `p`, `s` or `share`. The error SHALL name the Host and the reserved word.

#### Scenario: Reserved Host id
- **WHEN** a config declares a Project with `host: login`
- **THEN** loading fails with an error that `login` is reserved
