package agent

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadHandleReplacementBindingsExpiryAndCapacity(t *testing.T) {
	p := fixture(t)
	handles := newReadHandles()
	defer handles.shutdown()
	open := func() string {
		t.Helper()
		result, err := handles.open(p, "principal-a", "project-a", "docs/a.txt")
		if err != nil {
			t.Fatal(err)
		}
		return result.(map[string]any)["readToken"].(string)
	}
	token := open()
	read := func(principal, project, identity string) error {
		_, err := handles.read(token, principal, project, identity, 0, 1, 1024)
		return err
	}
	for _, args := range [][3]string{{"principal-b", "project-a", p.Identity()}, {"principal-a", "project-b", p.Identity()}, {"principal-a", "project-a", "wrong"}} {
		if errorCode(read(args[0], args[1], args[2])) != "FORBIDDEN" {
			t.Fatal("binding escaped", args)
		}
	}
	prior, err := handles.read(token, "principal-a", "project-a", p.Identity(), 0, 1, 1024)
	if err != nil {
		t.Fatal(err)
	}
	temporary := filepath.Join(p.Config.Root, "docs", "replacement")
	if err := os.WriteFile(temporary, []byte("replacement-longer"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(temporary, filepath.Join(p.Config.Root, "docs", "a.txt")); err != nil {
		t.Fatal(err)
	}
	later, err := handles.read(token, "principal-a", "project-a", p.Identity(), 0, 1024, 1024)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := base64.StdEncoding.DecodeString(*prior.(RangeResult).Content)
	after, _ := base64.StdEncoding.DecodeString(*later.(RangeResult).Content)
	if string(before) != string(after[:1]) || string(after) == "replacement-longer" {
		t.Fatal("reopened path")
	}
	if errorCode(handles.close(token, "principal-b", "project-a", p.Identity())) != "FORBIDDEN" {
		t.Fatal("unbound close")
	}
	lease, release, err := handles.acquire(token, "principal-a", "project-a", p.Identity())
	if err != nil {
		t.Fatal(err)
	}
	if err := handles.close(token, "principal-a", "project-a", p.Identity()); err != nil {
		t.Fatal(err)
	}
	handles.mu.Lock()
	retained := handles.leases[token] == lease
	handles.mu.Unlock()
	if !retained {
		t.Fatal("released while physical read active")
	}
	release()
	if errorCode(read("principal-a", "project-a", p.Identity())) != "READ_HANDLE_EXPIRED" {
		t.Fatal("closed handle reusable")
	}
	token = open()
	handles.mu.Lock()
	lease = handles.leases[token]
	lease.deadline = time.Now().Add(-time.Second)
	handles.mu.Unlock()
	handles.expire(token, lease)
	if errorCode(read("principal-a", "project-a", p.Identity())) != "READ_HANDLE_EXPIRED" {
		t.Fatal("expiry reopened path")
	}
	empty := newReadHandles()
	defer empty.shutdown()
	var first string
	for i := 0; i < maxReadHandles; i++ {
		result, err := empty.open(p, "principal-a", "project-a", "docs/a.txt")
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = result.(map[string]any)["readToken"].(string)
		}
	}
	if _, err := empty.open(p, "principal-a", "project-a", "docs/a.txt"); errorCode(err) != "LIMIT_EXCEEDED" {
		t.Fatal("unbounded descriptors")
	}
	if err := empty.close(first, "principal-a", "project-a", p.Identity()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		empty.mu.Lock()
		remaining := len(empty.leases)
		empty.mu.Unlock()
		if remaining < maxReadHandles {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("closed descriptor did not release handle capacity")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := empty.open(p, "principal-a", "project-a", "docs/a.txt"); err != nil {
		t.Fatal("released capacity unusable", err)
	}
	fresh := newReadHandles()
	if _, _, err := fresh.acquire(token, "principal-a", "project-a", p.Identity()); errorCode(err) != "READ_HANDLE_EXPIRED" {
		t.Fatal("restart reused lease")
	}
}
