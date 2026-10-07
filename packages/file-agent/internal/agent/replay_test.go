package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConcurrentReplayAndAuthorityBinding(t *testing.T) {
	store, err := OpenReplayStore(t.TempDir(), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	request := Mutation{Project: "project-a", Path: "document.txt", Operation: "replace", RequestID: "concurrent", LockVersion: 1, Precondition: &Precondition{Kind: "absent"}, Content: "eA==", Authority: "source-a"}
	var calls atomic.Int32
	entered := make(chan struct{})
	release := make(chan struct{})
	errors := make(chan error, 16)
	work := func() error { calls.Add(1); close(entered); <-release; return nil }
	var group sync.WaitGroup
	for range 16 {
		group.Add(1)
		go func() { defer group.Done(); errors <- store.Run(context.Background(), "caller-a", request, work) }()
	}
	<-entered
	close(release)
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("duplicate work", calls.Load())
	}
	request.Authority = "source-b"
	if err = store.Run(context.Background(), "caller-a", request, func() error { t.Fatal("remapped source reused request"); return nil }); errorCode(err) != "REPLAY_CONFLICT" {
		t.Fatal(err)
	}
}

func crashMutation(p *Project) Mutation {
	return Mutation{Project: "project-a", Path: "created.txt", Operation: "replace", RequestID: "crash-create", LockVersion: 1, Content: "eA==", Precondition: &Precondition{Kind: "absent"}, Authority: p.Identity()}
}
func TestReplayCrashChild(t *testing.T) {
	root := os.Getenv("MEMON_REPLAY_CRASH_ROOT")
	if root == "" {
		t.Skip("subprocess fixture")
	}
	p, err := OpenProject(ProjectConfig{Root: root, SourceIdentity: "source-a", AcknowledgedWriterLockVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	store, err := OpenReplayStore(os.Getenv("MEMON_REPLAY_CRASH_STATE"), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	mutation := crashMutation(p)
	err = store.Run(context.Background(), "caller-a", mutation, func() error {
		if err := p.Mutate(context.Background(), mutation, DefaultLimits()); err != nil {
			t.Fatal(err)
		}
		os.Exit(0) // Successful source mutation, no durable completed replay result.
		return nil
	})
	t.Fatal("crash hook did not run", err)
}
func TestCrashAfterMutationDoesNotRepeat(t *testing.T) {
	p := fixture(t)
	state := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(executable, "-test.run=^TestReplayCrashChild$")
	child.Env = append(os.Environ(), "MEMON_REPLAY_CRASH_ROOT="+p.Config.Root, "MEMON_REPLAY_CRASH_STATE="+state)
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("child: %v %s", err, output)
	}
	bytes, err := os.ReadFile(filepath.Join(p.Config.Root, "created.txt"))
	if err != nil || string(bytes) != "x" {
		t.Fatal(string(bytes), err)
	}
	store, err := OpenReplayStore(state, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.Run(context.Background(), "caller-a", crashMutation(p), func() error { t.Fatal("uncertain work repeated"); return nil })
	if errorCode(err) != "MUTATION_UNCERTAIN" {
		t.Fatal(err)
	}
}
func TestCompletedReplayRetentionAndCapacity(t *testing.T) {
	limits := DefaultLimits()
	limits.MaxReplayRecords = 1
	limits.ReplayRetentionMs = 1
	store, err := OpenReplayStore(t.TempDir(), limits)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	request := Mutation{RequestID: "first"}
	if err = store.Run(context.Background(), "caller-a", request, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	request.RequestID = "second"
	if err = store.Run(context.Background(), "caller-a", request, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestNotStartedRetryAfterCapacityAndRestart(t *testing.T) {
	directory := t.TempDir()
	store, err := OpenReplayStore(directory, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	request := Mutation{Project: "project-a", Path: "created.txt", RequestID: "retry-admission", Authority: "source-a"}
	if err = store.RunPrepared(context.Background(), "caller-a", request, func() (func() error, func(), error) { return nil, nil, fail("LIMIT_EXCEEDED") }); errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal(err)
	}
	store.Close()
	store, err = OpenReplayStore(directory, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	different := request
	different.Path = "other.txt"
	if err = store.Run(context.Background(), "caller-a", different, func() error { t.Fatal("different payload ran"); return nil }); errorCode(err) != "REPLAY_CONFLICT" {
		t.Fatal(err)
	}
	calls := 0
	if err = store.Run(context.Background(), "caller-a", request, func() error { calls++; return nil }); err != nil {
		t.Fatal(err)
	}
	if err = store.RunPrepared(context.Background(), "caller-a", request, func() (func() error, func(), error) {
		t.Fatal("completed retry required source capacity")
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal(calls)
	}
}

func TestReplayAmbiguousFilesystemError(t *testing.T) {
	store, err := OpenReplayStore(t.TempDir(), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	request := Mutation{Project: "project-a", Path: "created.txt", RequestID: "ambiguous-io", Authority: "source-a"}
	if err = store.Run(context.Background(), "caller-a", request, func() error { return fail("IO_ERROR") }); errorCode(err) != "MUTATION_UNCERTAIN" {
		t.Fatal(err)
	}
	if err = store.Run(context.Background(), "caller-a", request, func() error { t.Fatal("uncertain I/O repeated"); return nil }); errorCode(err) != "MUTATION_UNCERTAIN" {
		t.Fatal(err)
	}
}
func TestCanceledPreparationDoesNotEnterMutation(t *testing.T) {
	store, err := OpenReplayStore(t.TempDir(), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	request := Mutation{Project: "project-a", Path: "created.txt", RequestID: "canceled-admission", Authority: "source-a"}
	ctx, cancel := context.WithCancel(context.Background())
	released := false
	err = store.RunPrepared(ctx, "caller-a", request, func() (func() error, func(), error) {
		cancel()
		return func() error { t.Fatal("canceled not-started request mutated"); return nil }, func() { released = true }, nil
	})
	if errorCode(err) != "LIMIT_EXCEEDED" || !released {
		t.Fatal(err, released)
	}
	if err = store.Run(context.Background(), "caller-a", request, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestReplayBindsDirectoryFileChecks(t *testing.T) {
	store, err := OpenReplayStore(t.TempDir(), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	stamp := float64(1)
	request := Mutation{Project: "project-a", Path: "docs", Operation: "rename", RequestID: "guarded", LockVersion: 1,
		FileChecks: []FileCheck{{Path: "docs/README.md", Precondition: &Precondition{Kind: "match", ExpectedMtime: &stamp, ExpectedHash: "first"}}}}
	if err = store.Run(context.Background(), "caller", request, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	request.FileChecks[0].Precondition.ExpectedHash = "changed"
	if err = store.Run(context.Background(), "caller", request, func() error { t.Fatal("changed guard replayed"); return nil }); errorCode(err) != "REPLAY_CONFLICT" {
		t.Fatal(err)
	}
}
