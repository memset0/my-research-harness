## ADDED Requirements

### Requirement: Share migration does not transfer authority
Centralization SHALL preserve existing share records, namespace identity and owner-first authentication, including preemptive Basic support without browser Basic challenges. Removing Backend transport SHALL not silently reassign a share to another project.

#### Scenario: Existing share link
- **WHEN** a valid existing host-qualified link is opened after centralization
- **THEN** it resolves to the same project scope using its mounted share state

### Requirement: Central validates authoritative project share state
Central SHALL read and manage share records at the exact configured project root, retaining existing record format and host-qualified viewer scope. Token validation and revocation SHALL not be authorized from stale display-cache results. Unavailable authoritative storage SHALL fail closed for new/revalidated access. Share administration remains a separate permission from document mutation and actual filesystem write errors SHALL be surfaced.

#### Scenario: Revoke centrally
- **WHEN** an owner revokes a share
- **THEN** subsequent token validation rejects it without any Backend request

#### Scenario: Storage unavailable
- **WHEN** authoritative share state cannot be validated
- **THEN** central does not grant new or revalidated access using a stale positive observation

## REMOVED Requirements

### Requirement: Owning Backend validates and stores share state
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Central validates authoritative project share state" in this capability; preserve the public safety and data semantics stated there.
