package agent

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScopedEditPaths(t *testing.T) {
	for name, want := range map[string]bool{
		"docs/reports/R0001-a/manifest.json":   true,
		"docs/reports/team/R0002-b/README.md":  true,
		"docs/reports/R0003-c.md":              true,
		"docs/wiki/guide/W0001-a/README.md":    true,
		".memon/index/reports.json":            true,
		".memon/index/wiki.json":               true,
		".memon/index/experiments.json":        false,
		"docs/reports/R0001-a/index.html":      false,
		"docs/experiments/E0001-a/README.md":   false,
		"src/main.py":                          false,
		"docs/reports-other/R0001-a/README.md": false,
	} {
		if scopedEditPath(name) != want {
			t.Errorf("%s: want %v", name, want)
		}
	}
	replace := Mutation{Path: "docs/reports/R0001-a/README.md", Operation: "replace", Precondition: &Precondition{Kind: "match"}}
	if err := validateScopedEdit(replace); err != nil {
		t.Fatal(err)
	}
	for _, refused := range []Mutation{
		{Path: replace.Path, Operation: "replace", Precondition: &Precondition{Kind: "absent"}},
		{Path: replace.Path, Operation: "delete", Precondition: &Precondition{Kind: "match"}},
		{Path: replace.Path, Operation: "rename", Destination: "docs/reports/R0002-b/README.md", Precondition: &Precondition{Kind: "match"}},
		{Path: "src/main.py", Operation: "replace", Precondition: &Precondition{Kind: "match"}},
		{Path: replace.Path, Operation: "replace", Precondition: &Precondition{Kind: "match"}, Mode: new(uint32)},
	} {
		if errorCode(validateScopedEdit(refused)) != "FORBIDDEN" {
			t.Errorf("accepted %+v", refused)
		}
	}
}

func TestChangedSpan(t *testing.T) {
	for _, c := range []struct {
		before, after string
		want          int
	}{
		{"title: a\nbody", "title: abc\nbody", 2},
		{"same", "same", 0},
		{"abc", "", 3},
		{"aXc", "aYYYc", 3},
	} {
		if got := changedSpan([]byte(c.before), []byte(c.after)); got != c.want {
			t.Errorf("%q -> %q: got %d want %d", c.before, c.after, got, c.want)
		}
	}
}

func TestScopedReplacementSpan(t *testing.T) {
	p := fixture(t)
	dir := filepath.Join(p.Config.Root, "docs", "reports", "R0001-a")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("measured result\n", 500)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("---\ntitle: Old\n---\n"+body), 0644); err != nil {
		t.Fatal(err)
	}
	name := "docs/reports/R0001-a/README.md"
	replace := func(id, content string) error {
		return p.Mutate(context.Background(), Mutation{Path: name, Operation: "replace", RequestID: id, LockVersion: 1, Scoped: true,
			Content: base64.StdEncoding.EncodeToString([]byte(content)), Precondition: match(t, p, name)}, DefaultLimits())
	}
	if err := replace("rewrite", "---\ntitle: Old\n---\n"+strings.Repeat("rewritten body\n", 500)); errorCode(err) != "FORBIDDEN" {
		t.Fatal("oversized scoped edit applied", err)
	}
	if err := replace("rename", "---\ntitle: New title\n---\n"+body); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "README.md"))
	if string(got) != "---\ntitle: New title\n---\n"+body {
		t.Fatal("title edit not applied")
	}
}
