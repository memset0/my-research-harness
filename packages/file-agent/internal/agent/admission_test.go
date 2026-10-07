package agent

import (
	"testing"
)

func TestPhysicalAdmissionSurvivesCallerAndNewServer(t *testing.T) {
	limits := DefaultLimits()
	limits.MaxConcurrent = 2
	store, err := OpenReplayStore(t.TempDir(), limits)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first := &Server{limits: limits, replay: store, groupCaps: map[string]int{"source-a": 2, "source-b": 1}}
	release, err := first.admit("source-a", 1)
	if err != nil {
		t.Fatal(err)
	}
	// A new request handler/process has no matching in-memory task, but the
	// still-held physical slot must enforce the original smaller source limit.
	second := &Server{limits: limits, replay: store, groupCaps: map[string]int{"source-a": 2, "source-b": 1}}
	if next, err := second.admit("source-a", 2); err == nil {
		next()
		t.Fatal("a pending physical operation lost its limit")
	}
	other, err := second.admit("source-b", 1)
	if err != nil {
		t.Fatal("healthy group blocked", err)
	}
	other()
	release()
	next, err := second.admit("source-a", 2)
	if err != nil {
		t.Fatal(err)
	}
	next()
}
func TestAdmissionRecordFilesAreBounded(t *testing.T) {
	limits := DefaultLimits()
	limits.MaxConcurrent = 2
	store, err := OpenReplayStore(t.TempDir(), limits)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s := &Server{limits: limits, replay: store, groupCaps: map[string]int{"source-a": 2}}
	for i := 0; i < 50; i++ {
		release, err := s.admit("source-a", 2)
		if err != nil {
			t.Fatal(err)
		}
		release()
	}
	dir, err := store.root.Open("slots")
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	entries, err := dir.ReadDir(-1)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatal("unbounded coordination files", len(entries))
	}
	for _, entry := range entries {
		info, _ := entry.Info()
		if info.Mode().Perm()&0077 != 0 {
			t.Fatal("coordination files are not owner-protected")
		}
	}
}
