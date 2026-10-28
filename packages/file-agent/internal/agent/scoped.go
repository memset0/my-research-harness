package agent

import (
	"io"
	"path"
	"strings"
)

// MaxScopedEditSpan bounds how many bytes a read-edit principal may change: the
// bytes outside the common prefix and suffix of the old and new content.
const MaxScopedEditSpan = 4096

// scopedEditPath reports whether a read-edit principal may replace the path:
// Report and Wiki documents and manifests, and the two published catalogs
// that carry their titles.
func scopedEditPath(name string) bool {
	if name == ".memon/index/reports.json" || name == ".memon/index/wiki.json" {
		return true
	}
	if !strings.HasPrefix(name, "docs/reports/") && !strings.HasPrefix(name, "docs/wiki/") {
		return false
	}
	base := path.Base(name)
	return base == "manifest.json" || strings.HasSuffix(base, ".md")
}

// validateScopedEdit admits only a guarded replacement of an existing file.
func validateScopedEdit(m Mutation) error {
	if m.Operation != "replace" || m.Precondition == nil || m.Precondition.Kind != "match" ||
		m.Mode != nil || m.Destination != "" || m.DestinationPrecondition != nil ||
		len(m.FileChecks) > 0 || m.Recursive || !validPath(m.Path, false) || !scopedEditPath(m.Path) {
		return fail("FORBIDDEN")
	}
	return nil
}

// changedSpan is the larger of the old and new byte counts outside the common
// prefix and common suffix.
func changedSpan(before, after []byte) int {
	prefix := 0
	for prefix < len(before) && prefix < len(after) && before[prefix] == after[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(before)-prefix && suffix < len(after)-prefix &&
		before[len(before)-1-suffix] == after[len(after)-1-suffix] {
		suffix++
	}
	return max(len(before)-prefix-suffix, len(after)-prefix-suffix)
}

// checkScopedSpan refuses a scoped replacement that changes too much of the
// current file. It runs under the writer lock after the precondition check.
func (p *Project) checkScopedSpan(name string, next []byte, limit int64) error {
	file, err := p.openFile(name)
	if err != nil {
		return err
	}
	defer file.Close()
	current, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return err
	}
	if int64(len(current)) > limit {
		return fail("LIMIT_EXCEEDED")
	}
	if changedSpan(current, next) > MaxScopedEditSpan {
		return fail("FORBIDDEN")
	}
	return nil
}
