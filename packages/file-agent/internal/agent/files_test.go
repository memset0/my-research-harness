package agent

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixture(t *testing.T) *Project {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "a.txt"), []byte("inside"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(root, "docs", "a.txt"), 0640); err != nil {
		t.Fatal(err)
	}
	p, err := OpenProject(ProjectConfig{Root: root, SourceIdentity: "source-a", AcknowledgedWriterLockVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.Close() })
	return p
}
func match(t *testing.T, p *Project, name string) *Precondition {
	t.Helper()
	result, err := p.Read(name, "", 10000)
	if err != nil {
		t.Fatal(err)
	}
	stat, err := p.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	return &Precondition{Kind: "match", ExpectedHash: result.Version[7:], ExpectedMtime: &stat.Metadata.MtimeMs}
}
func TestConditionalAndSameSize(t *testing.T) {
	p := fixture(t)
	first, err := p.Read("docs/a.txt", "", 1000)
	if err != nil {
		t.Fatal(err)
	}
	unchanged, err := p.Read("docs/a.txt", first.Version, 1000)
	if err != nil || unchanged.Outcome != "unchanged" || unchanged.Content != nil {
		t.Fatalf("unchanged: %#v %v", unchanged, err)
	}
	info, _ := os.Stat(filepath.Join(p.realRoot, "docs/a.txt"))
	os.WriteFile(filepath.Join(p.realRoot, "docs/a.txt"), []byte("edited"), 0640)
	os.Chtimes(filepath.Join(p.realRoot, "docs/a.txt"), info.ModTime(), info.ModTime())
	next, err := p.Read("docs/a.txt", first.Version, 1000)
	if err != nil || next.Outcome != "present" || next.Version == first.Version {
		t.Fatal("same-size edit was missed")
	}
}
func TestMissingEmptyAndUnavailable(t *testing.T) {
	p := fixture(t)
	missing, err := p.Read("missing", "", 100)
	if err != nil || missing.Outcome != "missing" {
		t.Fatal(missing, err)
	}
	os.WriteFile(filepath.Join(p.realRoot, "empty"), nil, 0600)
	empty, err := p.Read("empty", "", 100)
	if err != nil || empty.Outcome != "present" || empty.Content == nil || *empty.Content != "" {
		t.Fatal(empty, err)
	}
	os.Rename(p.realRoot, p.realRoot+"-moved")
	defer os.Rename(p.realRoot+"-moved", p.realRoot)
	_, err = p.Read("missing", "", 100)
	if errorCode(err) != "SOURCE_UNAVAILABLE" {
		t.Fatal(err)
	}
}
func TestEscapeAndParentSwap(t *testing.T) {
	p := fixture(t)
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "a.txt"), []byte("outside"), 0600)
	rel, err := p.resolveContained("docs/a.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	os.Rename(filepath.Join(p.realRoot, "docs"), filepath.Join(p.realRoot, "saved"))
	os.Symlink(outside, filepath.Join(p.realRoot, "docs"))
	if _, err = p.root.Open(rel); err == nil {
		t.Fatal("root followed parent replacement")
	}
	if _, err = p.Read("docs/a.txt", "", 1000); err == nil {
		t.Fatal("read escaped")
	}
	if err = p.Mutate(context.Background(), Mutation{Path: "docs/a.txt", Operation: "replace", RequestID: "request-1", LockVersion: 1, Content: base64.StdEncoding.EncodeToString([]byte("bad")), Precondition: &Precondition{Kind: "absent"}}, DefaultLimits()); err == nil {
		t.Fatal("write escaped")
	}
	bytes, _ := os.ReadFile(filepath.Join(outside, "a.txt"))
	if string(bytes) != "outside" {
		t.Fatal("outside file changed")
	}
}
func TestInsideAbsoluteAndRelativeLinks(t *testing.T) {
	p := fixture(t)
	os.Symlink("docs", filepath.Join(p.realRoot, "relative"))
	os.Symlink(filepath.Join(p.realRoot, "docs"), filepath.Join(p.realRoot, "absolute"))
	for _, name := range []string{"relative/a.txt", "absolute/a.txt"} {
		result, err := p.Read(name, "", 1000)
		if err != nil || result.Outcome != "present" {
			t.Fatal(name, result, err)
		}
	}
}
func TestDirectoryAndRanges(t *testing.T) {
	p := fixture(t)
	first, err := p.List("docs", "", 100)
	if err != nil || len(*first.Entries) != 1 {
		t.Fatal(first, err)
	}
	os.WriteFile(filepath.Join(p.realRoot, "docs/a.txt"), []byte("longer-content"), 0640)
	same, err := p.List("docs", first.Version, 100)
	if err != nil || same.Outcome != "unchanged" {
		t.Fatal(same, err)
	}
	result, err := p.Range("docs/a.txt", 1, 3, 100)
	if err != nil {
		t.Fatal(err)
	}
	rangeValue := result.(RangeResult)
	bytes, _ := base64.StdEncoding.DecodeString(*rangeValue.Content)
	if string(bytes) != "ong" {
		t.Fatal(string(bytes))
	}
	os.Truncate(filepath.Join(p.realRoot, "docs/a.txt"), 1)
	result, err = p.Range("docs/a.txt", 100, 3, 100)
	if err != nil || result.(RangeResult).Extent != 1 || *result.(RangeResult).Content != "" {
		t.Fatal(result, err)
	}
}
func TestLimitsAndPreconditions(t *testing.T) {
	p := fixture(t)
	if _, err := p.Read("docs/a.txt", "", 2); errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal(err)
	}
	pre := match(t, p, "docs/a.txt")
	m := Mutation{Path: "docs/a.txt", Operation: "replace", RequestID: "request-1", LockVersion: 1, Content: base64.StdEncoding.EncodeToString([]byte("new")), Precondition: pre}
	if err := p.Mutate(context.Background(), m, DefaultLimits()); err != nil {
		t.Fatal(err)
	}
	if err := p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "CONFLICT" {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(p.realRoot, "docs/a.txt"))
	if info.Mode().Perm() != 0640 {
		t.Fatal(info.Mode())
	}
	entries, _ := os.ReadDir(filepath.Join(p.realRoot, "docs"))
	if len(entries) != 1 {
		t.Fatal("temp file leaked")
	}
	p.Config.AcknowledgedWriterLockVersion = 0
	if err := p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "WRITER_UPGRADE_REQUIRED" {
		t.Fatal(err)
	}
}
func TestTwoWritersConflictUnderCommonLock(t *testing.T) {
	p := fixture(t)
	other, err := OpenProject(p.Config)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	pre := match(t, p, "docs/a.txt")
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i, project := range []*Project{p, other} {
		wg.Add(1)
		go func(i int, project *Project) {
			defer wg.Done()
			m := Mutation{Path: "docs/a.txt", Operation: "replace", RequestID: "writer", LockVersion: 1, Content: base64.StdEncoding.EncodeToString([]byte{byte('a' + i)}), Precondition: pre}
			results <- project.Mutate(context.Background(), m, DefaultLimits())
		}(i, project)
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errorCode(err) == "CONFLICT" {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success %d conflict %d", success, conflict)
	}
}
func TestReplayRestartConflictAndUncertainty(t *testing.T) {
	limits := DefaultLimits()
	directory := t.TempDir()
	store, err := OpenReplayStore(directory, limits)
	if err != nil {
		t.Fatal(err)
	}
	m := Mutation{Project: "project-a", Path: "docs/a.txt", Operation: "delete", RequestID: "request-1", LockVersion: 1}
	calls := 0
	work := func() error { calls++; return nil }
	if err = store.Run(context.Background(), "caller", m, work); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = OpenReplayStore(directory, limits)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err = store.Run(context.Background(), "caller", m, work); err != nil || calls != 1 {
		t.Fatal(calls, err)
	}
	changed := m
	changed.Path = "docs/b.txt"
	if err = store.Run(context.Background(), "caller", changed, work); errorCode(err) != "REPLAY_CONFLICT" {
		t.Fatal(err)
	}
	pending := m
	pending.RequestID = "pending"
	sum := sha256.Sum256([]byte("caller\x00pending"))
	name := hex.EncodeToString(sum[:]) + ".json"
	raw, _ := replayPayload(pending)
	digest := sha256.Sum256(raw)
	record := `{"digest":"` + hex.EncodeToString(digest[:]) + `","state":"pending","createdAt":"` + time.Now().Format("2006-01-02T15:04:05-07:00") + `"}`
	os.WriteFile(filepath.Join(directory, name), []byte(record), 0600)
	if err = store.Run(context.Background(), "caller", pending, work); errorCode(err) != "MUTATION_UNCERTAIN" || calls != 1 {
		t.Fatal(calls, err)
	}
}
func TestNoAutomaticLockStealing(t *testing.T) {
	p := fixture(t)
	os.MkdirAll(filepath.Join(p.realRoot, WriterLockPath), 0700)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	called := false
	err := p.WithWriterLock(ctx, func() error { called = true; return nil })
	if called || errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal(called, err)
	}
	if _, err = os.Stat(filepath.Join(p.realRoot, WriterLockPath)); errors.Is(err, os.ErrNotExist) {
		t.Fatal("existing lock stolen")
	}
}

func TestListingByteLimitCountsNames(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, strings.Repeat("x", 200)), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := OpenProject(ProjectConfig{Root: root, SourceIdentity: "source-a"})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if _, err = p.List("", "", 10, 64); errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal(err)
	}
}

func TestDirectoryFileChecksCatchSameMtimeEdit(t *testing.T) {
	p := fixture(t)
	pre := match(t, p, "docs/a.txt")
	info, _ := os.Stat(filepath.Join(p.realRoot, "docs/a.txt"))
	if err := os.WriteFile(filepath.Join(p.realRoot, "docs/a.txt"), []byte("edited"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(p.realRoot, "docs/a.txt"), info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	directory, err := p.Stat("docs")
	if err != nil {
		t.Fatal(err)
	}
	m := Mutation{Path: "docs", Operation: "rename", RequestID: "guarded-move", LockVersion: 1,
		Precondition: &Precondition{Kind: "directory", ExpectedIdentity: directory.Metadata.Identity},
		Destination:  "moved", DestinationPrecondition: &Precondition{Kind: "absent"},
		FileChecks: []FileCheck{{Path: "docs/a.txt", Precondition: pre}}}
	if err = p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "CONFLICT" {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(p.realRoot, "moved")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("conflict moved the directory", err)
	}
	m.FileChecks[0].Precondition = match(t, p, "docs/a.txt")
	if err = p.Mutate(context.Background(), m, DefaultLimits()); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(p.realRoot, "moved/a.txt"))
	if err != nil || string(bytes) != "edited" {
		t.Fatal(string(bytes), err)
	}
}

func TestDirectoryFileCheckLimitsAndContainment(t *testing.T) {
	p := fixture(t)
	os.WriteFile(filepath.Join(p.realRoot, "docs/b.txt"), []byte("inside"), 0600)
	directory, _ := p.Stat("docs")
	base := Mutation{Path: "docs", Operation: "rename", RequestID: "guarded-move", LockVersion: 1,
		Precondition: &Precondition{Kind: "directory", ExpectedIdentity: directory.Metadata.Identity},
		Destination:  "moved", DestinationPrecondition: &Precondition{Kind: "absent"}}
	a := FileCheck{Path: "docs/a.txt", Precondition: match(t, p, "docs/a.txt")}
	b := FileCheck{Path: "docs/b.txt", Precondition: match(t, p, "docs/b.txt")}
	limits := DefaultLimits()
	limits.MaxBodyBytes = 10
	m := base
	m.FileChecks = []FileCheck{a, b}
	if err := p.Mutate(context.Background(), m, limits); errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal("aggregate bytes", err)
	}
	for _, checks := range [][]FileCheck{{a, a}, {{Path: "../outside", Precondition: a.Precondition}}, {{Path: "other/a.txt", Precondition: a.Precondition}}} {
		m := base
		m.FileChecks = checks
		if err := p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "BAD_REQUEST" {
			t.Fatal("invalid checks", err)
		}
	}
	m = base
	m.FileChecks = make([]FileCheck, MaxDirectoryFileChecks+1)
	if err := p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal("count", err)
	}
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600)
	os.Symlink(filepath.Join(outside, "secret"), filepath.Join(p.realRoot, "docs/link"))
	directory, _ = p.Stat("docs")
	m = base
	m.Precondition = &Precondition{Kind: "directory", ExpectedIdentity: directory.Metadata.Identity}
	m.FileChecks = []FileCheck{{Path: "docs/link", Precondition: a.Precondition}}
	if err := p.Mutate(context.Background(), m, DefaultLimits()); errorCode(err) != "OUTSIDE_PROJECT" {
		t.Fatal("escape", err)
	}
	if _, err := os.Stat(filepath.Join(p.realRoot, "docs")); err != nil {
		t.Fatal("failed checks changed directory", err)
	}
}
