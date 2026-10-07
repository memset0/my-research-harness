package agent

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"sync"
	"time"
)

const maxReadHandles = 256
const readHandleTTL = 5 * time.Minute

type readLease struct {
	deadline                     time.Time
	file                         *os.File
	principal, project, identity string
	extent                       int64
	timer                        *time.Timer
	refs                         int
	closing                      bool
}
type readHandles struct {
	mu     sync.Mutex
	leases map[string]*readLease
	closed bool
}

func newReadHandles() *readHandles { return &readHandles{leases: map[string]*readLease{}} }

// Retirement retains its bound slot until physical reads and descriptor close finish.
func (h *readHandles) retireLocked(token string, lease *readLease) {
	lease.closing = true
	if lease.timer != nil {
		lease.timer.Stop()
	}
	if lease.refs != 0 {
		return
	}
	lease.refs = -1
	go func() {
		if lease.file != nil {
			lease.file.Close()
		}
		h.mu.Lock()
		delete(h.leases, token)
		h.mu.Unlock()
	}()
}
func (h *readHandles) expire(token string, lease *readLease) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.leases[token] == lease && !lease.closing {
		if remaining := time.Until(lease.deadline); remaining > 0 {
			lease.timer.Reset(remaining)
		} else {
			h.retireLocked(token, lease)
		}
	}
}
func (h *readHandles) open(p *Project, principal, project, path string) (any, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(random)
	lease := &readLease{principal: principal, project: project, identity: p.Identity(), refs: 1}
	h.mu.Lock()
	if h.closed || len(h.leases) >= maxReadHandles {
		h.mu.Unlock()
		return nil, fail("LIMIT_EXCEEDED")
	}
	h.leases[token] = lease
	h.mu.Unlock()
	file, err := p.openFile(path)
	var metadata *Metadata
	if err == nil {
		info, e := file.Stat()
		err = e
		if err == nil {
			metadata = metadataOf(info)
		}
	}
	h.mu.Lock()
	lease.file = file
	lease.refs--
	if err != nil || h.closed {
		h.retireLocked(token, lease)
		h.mu.Unlock()
		if err == nil {
			err = fail("SOURCE_UNAVAILABLE")
		}
		if errors.Is(err, os.ErrNotExist) {
			return ReadResult{Outcome: "missing", CheckedAt: checkedAt()}, nil
		}
		return nil, err
	}
	lease.extent = metadata.Size
	lease.deadline = time.Now().Add(readHandleTTL)
	lease.timer = time.AfterFunc(readHandleTTL, func() { h.expire(token, lease) })
	h.mu.Unlock()
	return map[string]any{"outcome": "present", "readToken": token, "metadata": metadata, "leaseMs": readHandleTTL.Milliseconds(), "checkedAt": checkedAt()}, nil
}
func (h *readHandles) acquire(token, principal, project, identity string) (*readLease, func(), error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	lease := h.leases[token]
	if lease == nil || lease.closing || h.closed || !time.Now().Before(lease.deadline) {
		return nil, nil, fail("READ_HANDLE_EXPIRED")
	}
	if lease.principal != principal || lease.project != project || lease.identity != identity {
		return nil, nil, fail("FORBIDDEN")
	}
	lease.refs++
	lease.deadline = time.Now().Add(readHandleTTL)
	lease.timer.Reset(readHandleTTL)
	return lease, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		lease.refs--
		if lease.closing && lease.refs == 0 {
			h.retireLocked(token, lease)
		}
	}, nil
}
func (h *readHandles) read(token, principal, project, identity string, offset, length, limit int64) (any, error) {
	if offset < 0 || length <= 0 || length > limit || offset > 9007199254740991-length {
		return nil, fail("BAD_REQUEST")
	}
	lease, release, err := h.acquire(token, principal, project, identity)
	if err != nil {
		return nil, err
	}
	defer release()
	bytes := make([]byte, min(length, max(int64(0), lease.extent-offset)))
	n, err := lease.file.ReadAt(bytes, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	bytes = bytes[:n]
	content := base64.StdEncoding.EncodeToString(bytes)
	return RangeResult{Outcome: "present", Content: &content, Version: version(bytes), Offset: offset, Extent: lease.extent, CheckedAt: checkedAt()}, nil
}
func (h *readHandles) close(token, principal, project, identity string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	lease := h.leases[token]
	if lease == nil {
		return nil
	}
	if lease.principal != principal || lease.project != project || lease.identity != identity {
		return fail("FORBIDDEN")
	}
	if !lease.closing {
		h.retireLocked(token, lease)
	}
	return nil
}
func (h *readHandles) shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for token, lease := range h.leases {
		if !lease.closing {
			h.retireLocked(token, lease)
		}
	}
}
