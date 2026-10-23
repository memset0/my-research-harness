## REMOVED Requirements

### Requirement: Wiki pages open in a drawer or right split
**Reason**: The side workspace is retired; every wiki page has its own full page.
**Migration**: Open the page's full route (`/h/<host>/p/<project>/wiki/<W-id>`).

### Requirement: Wiki workspace state is encoded in the URL
**Reason**: No side wiki page exists to encode.
**Migration**: Page URLs carrying `wiki` or `wikiSurface` redirect to the same URL without them (`report-workspace`: "Legacy side-document parameters redirect away").

### Requirement: Side wiki page exposes an accessible quick switcher
**Reason**: Removed with the side wiki surface.
**Migration**: Switch pages from the Wiki page list.

### Requirement: Wiki artifact links follow paired-workspace navigation rules
**Reason**: Every artifact link now opens the target's full page (`report-workspace`: "Artifact links open the target's full page").
**Migration**: None.
