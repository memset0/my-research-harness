## ADDED Requirements

### Requirement: Central Slurm status is Host-scoped
In central mode, Slurm capability and status SHALL come from the selected Host's Backend and SHALL never execute `squeue` on the central Web Host for a remote Project. Every Slurm request/cache/widget state SHALL include Host.

#### Scenario: Selected Host executes probe
- **WHEN** the user views a Project on a Host that advertises Slurm
- **THEN** only that Host's Backend executes the existing Slurm probe and returns its status

### Requirement: Slurm widget follows Host capability and availability
The widget SHALL be disabled or show an explicit unavailable state when the selected Host is unusable or does not advertise Slurm, without affecting another Host's widget.

#### Scenario: Non-Slurm Host performs no shell-out
- **WHEN** a Backend advertises Slurm disabled
- **THEN** central offers no enabled Slurm widget and the Backend does not invoke `squeue`
