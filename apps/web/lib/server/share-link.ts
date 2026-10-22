// Share-link constants shared by the Next share landings and the custom-server
// service gateway (loaded outside Next, so no `server-only` guard here).

export const INVALID_SHARE_LINK_BODY = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Share link invalid or expired · memon</title></head>
<body><h1>Share link invalid or expired</h1><p>Ask the project owner to issue a new one.</p></body>
</html>`

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/
