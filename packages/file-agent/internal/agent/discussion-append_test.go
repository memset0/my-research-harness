package agent

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func appendRequest(size int64, line string) Mutation {
	return Mutation{Project: "project-a", Path: "docs/discussions/D0001-design/responses.jsonl", Operation: "append", RequestID: "append-a", LockVersion: 1, ExpectedSize: &size, Content: base64.StdEncoding.EncodeToString([]byte(line)), Scoped: true}
}
func TestDiscussionScopedAppendValidation(t *testing.T) {
	valid := appendRequest(0, "{}\n")
	if err := validateScopedEdit(valid); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"docs/discussions/D0001-design/README.md", "docs/discussions/D0001-design/assets/responses.jsonl", "docs/discussions/other/responses.jsonl", "docs/reports/R0001-design/responses.jsonl", "docs/discussions/D0001-design/../responses.jsonl"} {
		m := valid
		m.Path = name
		if errorCode(validateScopedEdit(m)) != "FORBIDDEN" {
			t.Fatal("accepted", name)
		}
	}
}
func TestDiscussionAppendPreservesPrefixAndRejectsConflict(t *testing.T) {
	p := fixture(t)
	dir := filepath.Join(p.Config.Root, "docs/discussions/D0001-design")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	m := appendRequest(0, "{\"id\":\"a\"}\n")
	if err := p.Mutate(context.Background(), m, DefaultLimits()); err != nil {
		t.Fatal(err)
	}
	if err := p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "CONFLICT" {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{"b", "c"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			n := appendRequest(11, "{\"id\":\""+id+"\"}\n")
			n.RequestID = id
			results <- p.Mutate(context.Background(), n, DefaultLimits())
		}(id)
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errorCode(err) == "CONFLICT" {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal(success, conflicts)
	}
	data, err := os.ReadFile(filepath.Join(dir, "responses.jsonl"))
	if err != nil || !strings.HasPrefix(string(data), "{\"id\":\"a\"}\n") || strings.Count(string(data), "\n") != 2 {
		t.Fatal(string(data), err)
	}
}
func TestDiscussionAppendPayloadReadonlyAndSymlinks(t *testing.T) {
	p := fixture(t)
	dir := filepath.Join(p.Config.Root, "docs/discussions/D0001-design")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{"{}", "{}\n{}\n", "bad\n", "{\"x\":\"" + strings.Repeat("x", 4096) + "\"}\n", string([]byte{0xff, '\n'})} {
		if err := p.Mutate(context.Background(), appendRequest(0, line), DefaultLimits()); errorCode(err) != "BAD_REQUEST" {
			t.Fatal("accepted invalid payload", err)
		}
	}
	p.Config.ReadOnly = true
	if err := p.Mutate(context.Background(), appendRequest(0, "{}\n"), DefaultLimits()); errorCode(err) != "READ_ONLY" {
		t.Fatal(err)
	}
	p.Config.ReadOnly = false
	outside := filepath.Join(t.TempDir(), "outside.jsonl")
	if err := os.WriteFile(outside, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "responses.jsonl")); err != nil {
		t.Fatal(err)
	}
	if err := p.Mutate(context.Background(), appendRequest(0, "{}\n"), DefaultLimits()); err == nil {
		t.Fatal("followed log symlink")
	}
	data, _ := os.ReadFile(outside)
	if len(data) != 0 {
		t.Fatal("modified outside file")
	}
}
func TestDiscussionAppendReplay(t *testing.T) {
	p := fixture(t)
	if err := os.MkdirAll(filepath.Join(p.Config.Root, "docs/discussions/D0001-design"), 0755); err != nil {
		t.Fatal(err)
	}
	replay, err := OpenReplayStore(t.TempDir(), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer replay.Close()
	m := appendRequest(0, "{}\n")
	m.Authority = p.Identity()
	work := func() error { return p.Mutate(context.Background(), m, DefaultLimits()) }
	for range 2 {
		if err := replay.Run(context.Background(), "caller", m, work); err != nil {
			t.Fatal(err)
		}
	}
	data, _ := os.ReadFile(filepath.Join(p.Config.Root, m.Path))
	if string(data) != "{}\n" {
		t.Fatal(string(data))
	}
}
