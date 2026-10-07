package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"sync"
	"time"
)

type ReplayRecord struct {
	Digest    string `json:"digest"`
	State     string `json:"state"`
	Error     *Error `json:"error,omitempty"`
	CreatedAt string `json:"createdAt"`
}
type replayCall struct {
	done   chan struct{}
	err    error
	digest string
}
type ReplayStore struct {
	root       *os.Root
	retention  time.Duration
	maxRecords int
	mu         sync.Mutex
	recordMu   sync.Mutex
	calls      map[string]*replayCall
}

func OpenReplayStore(directory string, limits Limits) (*ReplayStore, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	return &ReplayStore{root: root, retention: time.Duration(limits.ReplayRetentionMs) * time.Millisecond, maxRecords: limits.MaxReplayRecords, calls: map[string]*replayCall{}}, nil
}
func (s *ReplayStore) Close() error { return s.root.Close() }

// Legacy callers provide already-admitted work; HTTP mutations prepare capacity and locks first.
func (s *ReplayStore) Run(ctx context.Context, principal string, request Mutation, work func() error) error {
	return s.RunPrepared(ctx, principal, request, func() (func() error, func(), error) { return work, func() {}, nil })
}
func (s *ReplayStore) RunPrepared(ctx context.Context, principal string, request Mutation, prepare func() (func() error, func(), error)) (result error) {
	raw, err := replayPayload(request)
	if err != nil {
		return fail("BAD_REQUEST")
	}
	keySum := sha256.Sum256([]byte(principal + "\x00" + request.RequestID))
	key := hex.EncodeToString(keySum[:]) + ".json"
	digestSum := sha256.Sum256(raw)
	digest := hex.EncodeToString(digestSum[:])
	s.mu.Lock()
	if call, ok := s.calls[key]; ok {
		s.mu.Unlock()
		if call.digest != digest {
			return fail("REPLAY_CONFLICT")
		}
		select {
		case <-call.done:
			return call.err
		case <-ctx.Done():
			return fail("LIMIT_EXCEEDED")
		}
	}
	call := &replayCall{done: make(chan struct{}), digest: digest}
	s.calls[key] = call
	s.mu.Unlock()
	defer func() { s.mu.Lock(); call.err = result; delete(s.calls, key); close(call.done); s.mu.Unlock() }()
	record, err := s.notStarted(key, digest)
	if err != nil {
		return err
	}
	if record.State != "not-started" {
		return s.replay(key, digest)
	}
	work, release, err := prepare()
	if err != nil {
		return err
	} // No file effect; same ID may safely retry admission.
	defer release()
	if ctx.Err() != nil {
		return fail("LIMIT_EXCEEDED")
	}
	// Another process may have completed the same key while source admission waited.
	record, err = s.notStarted(key, digest)
	if err != nil {
		return err
	}
	if record.State != "not-started" {
		return s.replay(key, digest)
	}
	record.CreatedAt = time.Now().Format("2006-01-02T15:04:05.999999999-07:00")
	record.State = "pending"
	if err = s.writeRecord(key, record, false); err != nil {
		return fail("MUTATION_UNCERTAIN")
	}
	err = work()
	record.State = "completed"
	if err != nil {
		record.Error = &Error{Code: errorCode(err)}
		if record.Error.Code == "IO_ERROR" {
			record.State = "uncertain"
			record.Error.Code = "MUTATION_UNCERTAIN"
			err = record.Error
		}
	}
	if writeErr := s.writeRecord(key, record, false); writeErr != nil {
		return fail("MUTATION_UNCERTAIN")
	}
	return err
}
func (s *ReplayStore) notStarted(key, digest string) (ReplayRecord, error) {
	s.recordMu.Lock()
	defer s.recordMu.Unlock()
	bytes, err := s.root.ReadFile(key)
	if err == nil {
		var record ReplayRecord
		if decodeStrict(bytes, &record) != nil {
			return record, fail("MUTATION_UNCERTAIN")
		}
		if record.Digest != digest {
			return record, fail("REPLAY_CONFLICT")
		}
		return record, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return ReplayRecord{}, fail("MUTATION_UNCERTAIN")
	}
	if err = s.prune(); err != nil {
		return ReplayRecord{}, err
	}
	record := ReplayRecord{Digest: digest, State: "not-started", CreatedAt: time.Now().Format("2006-01-02T15:04:05.999999999-07:00")}
	return record, s.writeRecord(key, record, true)
}
func (s *ReplayStore) writeRecord(key string, record ReplayRecord, create bool) error {
	bytes, _ := json.Marshal(record)
	target := key
	if !create {
		target += ".tmp"
	}
	file, err := s.root.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if !create {
		defer s.root.Remove(target)
	}
	_, err = file.Write(bytes)
	if err == nil {
		err = file.Sync()
	}
	closed := file.Close()
	if err == nil {
		err = closed
	}
	if err == nil && !create {
		err = s.root.Rename(target, key)
	}
	if err == nil {
		err = s.syncDir()
	}
	return err
}

func (s *ReplayStore) syncDir() error {
	dir, err := s.root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func (s *ReplayStore) replay(key, digest string) error {
	bytes, err := s.root.ReadFile(key)
	if err != nil {
		return fail("MUTATION_UNCERTAIN")
	}
	var record ReplayRecord
	if decodeStrict(bytes, &record) != nil {
		return fail("MUTATION_UNCERTAIN")
	}
	if record.Digest != digest {
		return fail("REPLAY_CONFLICT")
	}
	if record.State != "completed" {
		return fail("MUTATION_UNCERTAIN")
	}
	created, err := time.Parse(time.RFC3339, record.CreatedAt)
	if err != nil || time.Since(created) > s.retention {
		return fail("MUTATION_UNCERTAIN")
	}
	if record.Error != nil {
		return record.Error
	}
	return nil
}
func (s *ReplayStore) prune() error {
	dir, err := s.root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(s.maxRecords + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		count++
		bytes, err := s.root.ReadFile(entry.Name())
		if err != nil {
			continue
		}
		var record ReplayRecord
		if decodeStrict(bytes, &record) != nil || (record.State != "completed" && record.State != "not-started") {
			continue
		}
		created, err := time.Parse(time.RFC3339, record.CreatedAt)
		if err == nil && time.Since(created) > s.retention {
			if s.root.Remove(entry.Name()) == nil {
				count--
			}
		}
	}
	if count >= s.maxRecords {
		return fail("LIMIT_EXCEEDED")
	}
	return nil
}

func replayPayload(request Mutation) ([]byte, error) {
	return json.Marshal(struct {
		Mutation  Mutation `json:"mutation"`
		Authority string   `json:"authority"`
	}{request, request.Authority})
}
