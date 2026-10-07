package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strconv"
	"syscall"
	"time"
)

// Held descriptor locks are the authoritative physical-operation budget.
// A disconnected client (or another agent process) cannot release a slot
// while its actual filesystem work is still executing.
type admissionRecord struct {
	Group string `json:"group"`
	Limit int    `json:"limit"`
}

func (s *Server) admit(group string, requested int) (func(), error) {
	if requested < 1 || requested > s.limits.MaxConcurrent {
		return nil, fail("BAD_REQUEST")
	}
	root := s.replay.root
	if err := root.MkdirAll("slots", 0700); err != nil {
		return nil, err
	}
	gate, err := root.OpenFile("slots/admission", os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, err
	}
	defer gate.Close()
	// Local admission bookkeeping contention is not exhausted source capacity.
	deadline := time.Now().Add(100 * time.Millisecond)
	for {
		err = syscall.Flock(int(gate.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			return nil, err
		}
		if time.Now().After(deadline) {
			return nil, fail("LIMIT_EXCEEDED")
		}
		time.Sleep(time.Millisecond)
	}
	defer syscall.Flock(int(gate.Fd()), syscall.LOCK_UN)
	hash := sha256.Sum256([]byte(group))
	groupKey := hex.EncodeToString(hash[:])
	s.mu.Lock()
	groupCap := s.groupCaps[group]
	s.mu.Unlock()
	limit := min(requested, groupCap)
	if limit < 1 {
		limit = requested
	}
	var chosen *os.File
	active := 0
	for i := 0; i < s.limits.MaxConcurrent; i++ {
		name := fmtSlot(i)
		file, err := root.OpenFile(name, os.O_RDWR|os.O_CREATE, 0600)
		if err != nil {
			if chosen != nil {
				chosen.Close()
			}
			return nil, err
		}
		if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err == nil {
			if chosen == nil {
				chosen = file
			} else {
				file.Close()
			}
			continue
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			file.Close()
			if chosen != nil {
				chosen.Close()
			}
			return nil, err
		}
		bytes, readErr := io.ReadAll(io.LimitReader(file, 1024))
		file.Close()
		var record admissionRecord
		if readErr != nil || json.Unmarshal(bytes, &record) != nil {
			if chosen != nil {
				chosen.Close()
			}
			return nil, fail("LIMIT_EXCEEDED")
		}
		if record.Group == groupKey {
			active++
			limit = min(limit, record.Limit)
		}
	}
	if chosen == nil || active >= limit {
		if chosen != nil {
			chosen.Close()
		}
		return nil, fail("LIMIT_EXCEEDED")
	}
	record, _ := json.Marshal(admissionRecord{groupKey, requested})
	if err = chosen.Truncate(0); err == nil {
		_, err = chosen.WriteAt(record, 0)
	}
	if err != nil {
		chosen.Close()
		return nil, err
	}
	return func() { chosen.Close() }, nil
}
func fmtSlot(i int) string { return "slots/slot-" + strconv.Itoa(i) }
