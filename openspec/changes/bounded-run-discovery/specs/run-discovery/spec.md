## MODIFIED Requirements

### Requirement: Run walk composes cached listings from project roots
Run discovery SHALL be the sole recursive project discovery exception, implemented as a composite walk through shared cached listDir operations rooted exclusively at logs/, outputs/, and experiments/ directly beneath each configured project root. Missing entry directories SHALL be skipped; the project root and unrelated subtrees SHALL NOT be enumerated. Default and configured excludes SHALL apply to entry directories and descendants. A recognized Run directory SHALL be recorded and never descended into, even without a README. Depth beneath these three entries SHALL be bounded by the Project's `run_depth` setting when it is set and SHALL remain unrestricted when it is absent. Directory symlinks, including entry-directory symlinks, SHALL NOT be followed.

#### Scenario: Variable depth
- **WHEN** Runs exist at different depths under the project's logs/, outputs/, or experiments/ and the Project sets no `run_depth`
- **THEN** the walk discovers them through listDir and stops at each recognized Run

#### Scenario: Unrelated project directories
- **WHEN** other directories under the project root contain matching Run names
- **THEN** they are not visited or discovered, and absent permitted entry directories are skipped

#### Scenario: Run contains outputs
- **WHEN** a Run directory contains many output directories
- **THEN** discovery does not enumerate those descendants

#### Scenario: Warm walk
- **WHEN** a walk repeats while its directory observations are reusable
- **THEN** it composes cached listings rather than unconditionally repeating filesystem enumeration

## ADDED Requirements

### Requirement: Run directories do not nest
A directory whose base name matches the Run name pattern SHALL be treated as a candidate Run whether or not it contains a README, and the walk SHALL NOT list its contents. No Run-shaped directory inside another Run-shaped directory SHALL be discovered. A README-less candidate SHALL keep the existing README-less Run classification. The number of directory listings a walk performs SHALL NOT depend on what Run directories contain.

#### Scenario: Run-shaped directory without README
- **WHEN** `outputs/sweep/a-260901-090000/` has no README and contains `b-260901-100000/README.md`
- **THEN** `outputs/sweep/a-260901-090000` is discovered as a README-less Run and `b-260901-100000` is not discovered

#### Scenario: Listing count is independent of Run contents
- **WHEN** a Run entry directory holds 100 Run directories each with 20 subdirectories, and the same tree is walked again after each Run gains 20 more subdirectories
- **THEN** both walks perform the same number of directory listings

### Requirement: Project run_depth bounds the Run walk
A Project configuration SHALL accept an optional `run_depth` whose value is `1` or `2`; any other value SHALL be rejected as invalid configuration. `run_depth: N` SHALL mean that a Run directory is discovered only when it sits at most N levels below a Run entry directory (`logs/<run>` is level 1, `logs/<group>/<run>` is level 2), and the walk SHALL NOT list any directory at level N or deeper. An absent `run_depth` SHALL keep unbounded depth, so a configuration without the key discovers exactly the Runs it discovered before. Callers that scan a project root without a configured Project SHALL be able to pass the same bound.

#### Scenario: Depth one lists only entry directories
- **WHEN** a Project with `run_depth: 1` has `logs/` and `outputs/` present
- **THEN** the walk lists exactly those two directories, discovers Runs that are their direct children, and ignores deeper Run-shaped directories

#### Scenario: Depth two lists one non-Run level
- **WHEN** a Project with `run_depth: 2` has entry directories containing non-Run subdirectories
- **THEN** the walk lists each entry directory and each of its non-Run, non-excluded child directories, and nothing deeper

#### Scenario: Absent setting keeps current discovery
- **WHEN** a Project configuration omits `run_depth`
- **THEN** the discovered Run set and paths equal those of the unbounded walk

#### Scenario: Invalid depth
- **WHEN** a Project configuration sets `run_depth: 3` or `run_depth: 0`
- **THEN** configuration loading fails with a validation error naming `run_depth`
