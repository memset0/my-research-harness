package agent

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

const ProtocolMajor = 1
const WriterLockVersion = 1
const MaxDirectoryFileChecks = 32
const WriterLockPath = ".memon/locks/write-v1"

type Error struct {
	Code         string `json:"code"`
	RetryAfterMs int64  `json:"retryAfterMs,omitempty"`
}

func (e *Error) Error() string { return e.Code }
func fail(code string) error   { return &Error{Code: code} }
func errorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	if errors.Is(err, fs.ErrExist) {
		return "CONFLICT"
	}
	if errors.Is(err, fs.ErrPermission) {
		return "FORBIDDEN"
	}
	if strings.Contains(err.Error(), "escapes from parent") {
		return "OUTSIDE_PROJECT"
	}
	return "IO_ERROR"
}

type Limits struct {
	MaxBodyBytes      int64 `json:"maxBodyBytes"`
	MaxRangeBytes     int64 `json:"maxRangeBytes"`
	MaxBatchItems     int   `json:"maxBatchItems"`
	MaxConcurrent     int   `json:"maxConcurrent"`
	ReplayRetentionMs int64 `json:"replayRetentionMs"`
	MaxReplayRecords  int   `json:"-"`
}

func DefaultLimits() Limits { return Limits{16 << 20, 1 << 20, 128, 10, 24 * 60 * 60 * 1000, 10000} }
func (l Limits) valid() bool {
	return l.MaxBodyBytes > 0 && l.MaxRangeBytes > 0 && l.MaxBodyBytes <= 1<<30 && l.MaxRangeBytes <= l.MaxBodyBytes && l.MaxBatchItems > 0 && l.MaxBatchItems <= 4096 && l.MaxConcurrent > 0 && l.MaxConcurrent <= 1024 && l.ReplayRetentionMs > 0 && l.MaxReplayRecords > 0
}

type ProjectConfig struct {
	Root                          string `json:"root"`
	SourceIdentity                string `json:"sourceIdentity"`
	ReadOnly                      bool   `json:"readOnly"`
	AcknowledgedWriterLockVersion int    `json:"acknowledgedWriterLockVersion"`
	StorageGroup                  string `json:"storageGroup,omitempty"`
	MountType                     string `json:"mountType,omitempty"`
	MountSource                   string `json:"mountSource,omitempty"`
}
type rootReference struct{ count atomic.Int64 }
type Project struct {
	reference *rootReference
	closed    atomic.Bool
	Config    ProjectConfig
	root      *os.Root
	realRoot  string
	identity  string
}

func OpenProject(config ProjectConfig) (*Project, error) {
	if !filepath.IsAbs(config.Root) || config.SourceIdentity == "" || len(config.SourceIdentity) > 128 {
		return nil, fail("BAD_REQUEST")
	}
	root, err := os.OpenRoot(config.Root)
	if err != nil {
		return nil, fail("SOURCE_UNAVAILABLE")
	}
	real, err := filepath.EvalSymlinks(config.Root)
	if err != nil {
		root.Close()
		return nil, fail("SOURCE_UNAVAILABLE")
	}
	reference := &rootReference{}
	reference.count.Store(1)
	p := &Project{Config: config, root: root, realRoot: real, reference: reference}
	if err = p.available(); err != nil {
		root.Close()
		return nil, err
	}
	p.identity = p.Identity()
	return p, nil
}
func (p *Project) Identity() string {
	if p.identity != "" {
		return p.identity
	}
	info, err := p.root.Stat(".")
	if err != nil {
		return p.Config.SourceIdentity + ":unavailable"
	}
	proof := p.realRoot + "\x00" + p.Config.MountType + "\x00" + p.Config.MountSource
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if value.IsValid() && value.Kind() == reflect.Struct {
		for _, name := range []string{"Dev", "Ino"} {
			field := value.FieldByName(name)
			if field.IsValid() && field.CanInterface() {
				proof += "\x00" + fmt.Sprint(field.Interface())
			}
		}
	}
	hash := sha256.Sum256([]byte(proof))
	return p.Config.SourceIdentity + ":" + hex.EncodeToString(hash[:])
}

func (p *Project) Close() error {
	if p.closed.Swap(true) {
		return nil
	}
	if p.reference == nil || p.reference.count.Add(-1) == 0 {
		return p.root.Close()
	}
	return nil
}

// Credential/grant/policy reloads reuse anchored roots without touching a possibly blocked mount.
func (p *Project) clone(config ProjectConfig) *Project {
	p.reference.count.Add(1)
	return &Project{Config: config, root: p.root, realRoot: p.realRoot, identity: p.identity, reference: p.reference}
}
func (p *Project) available() error {
	held, err := p.root.Stat(".")
	if err != nil {
		return fail("SOURCE_UNAVAILABLE")
	}
	current, err := os.Stat(p.Config.Root)
	if err != nil || !os.SameFile(held, current) {
		return fail("SOURCE_UNAVAILABLE")
	}
	if p.Config.MountType != "" || p.Config.MountSource != "" {
		raw, err := os.ReadFile("/proc/self/mountinfo")
		if err != nil {
			return fail("SOURCE_UNAVAILABLE")
		}
		best := ""
		var typ, source string
		for _, line := range strings.Split(string(raw), "\n") {
			halves := strings.SplitN(line, " - ", 2)
			if len(halves) != 2 {
				continue
			}
			left, right := strings.Fields(halves[0]), strings.Fields(halves[1])
			if len(left) < 5 || len(right) < 2 {
				continue
			}
			mount := strings.NewReplacer("\\040", " ", "\\011", "\t", "\\012", "\n", "\\134", "\\").Replace(left[4])
			if (p.realRoot == mount || strings.HasPrefix(p.realRoot, strings.TrimSuffix(mount, "/")+"/")) && len(mount) > len(best) {
				best, typ, source = mount, right[0], right[1]
			}
		}
		if best == "" || (p.Config.MountType != "" && typ != p.Config.MountType) || (p.Config.MountSource != "" && source != p.Config.MountSource) {
			return fail("SOURCE_UNAVAILABLE")
		}
	}
	return nil
}
func validPath(name string, allowRoot bool) bool {
	if name == "" {
		return allowRoot
	}
	if len(name) > 4096 || strings.Contains(name, "\\") || strings.HasPrefix(name, "/") || (len(name) > 1 && name[1] == ':') {
		return false
	}
	for _, c := range name {
		if c < 32 || c == 127 {
			return false
		}
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

// Preliminary canonicalization accommodates legacy in-root absolute links.
// Every actual operation still uses Root, never a checked absolute pathname.
func (p *Project) resolveContained(name string, allowRoot bool) (string, error) {
	if !validPath(name, allowRoot) {
		return "", fail("OUTSIDE_PROJECT")
	}
	if name == "" {
		return ".", nil
	}
	candidate := filepath.Join(p.realRoot, filepath.FromSlash(name))
	missing := []string{}
	for {
		resolved, err := filepath.EvalSymlinks(candidate)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			rel, err := filepath.Rel(p.realRoot, resolved)
			if err != nil || !filepath.IsLocal(rel) || (rel == "." && !allowRoot) {
				return "", fail("OUTSIDE_PROJECT")
			}
			return filepath.ToSlash(rel), nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return "", fail("OUTSIDE_PROJECT")
		}
		missing = append(missing, filepath.Base(candidate))
		candidate = parent
	}
}

func version(bytes []byte) string {
	hash := sha256.Sum256(bytes)
	return "sha256:" + hex.EncodeToString(hash[:])
}
func checkedAt() float64 { return float64(time.Now().UnixNano()) / 1e6 }

type ReadResult struct {
	Outcome   string  `json:"outcome"`
	Content   *string `json:"content,omitempty"`
	Version   string  `json:"version,omitempty"`
	CheckedAt float64 `json:"checkedAt"`
}

func presentRead(bytes []byte, known string) ReadResult {
	v := version(bytes)
	if known == v {
		return ReadResult{Outcome: "unchanged", Version: v, CheckedAt: checkedAt()}
	}
	content := base64.StdEncoding.EncodeToString(bytes)
	return ReadResult{Outcome: "present", Content: &content, Version: v, CheckedAt: checkedAt()}
}
func (p *Project) openFile(name string) (*os.File, error) {
	rel, err := p.resolveContained(name, false)
	if err != nil {
		return nil, err
	}
	file, err := p.root.OpenFile(rel, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() {
		file.Close()
		return nil, fail("BAD_REQUEST")
	}
	return file, nil
}
func (p *Project) Read(name, known string, limit int64) (ReadResult, error) {
	if err := p.available(); err != nil {
		return ReadResult{}, err
	}
	file, err := p.openFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		return ReadResult{Outcome: "missing", CheckedAt: checkedAt()}, nil
	}
	if err != nil {
		return ReadResult{}, err
	}
	defer file.Close()
	bytes, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return ReadResult{}, err
	}
	if int64(len(bytes)) > limit {
		return ReadResult{}, fail("LIMIT_EXCEEDED")
	}
	return presentRead(bytes, known), nil
}

type Entry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func kind(mode fs.FileMode) string {
	if mode.IsRegular() {
		return "file"
	}
	if mode.IsDir() {
		return "directory"
	}
	if mode&fs.ModeSymlink != 0 {
		return "symlink"
	}
	return "other"
}
func listVersion(entries []Entry) string {
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	hash := sha256.New()
	for _, entry := range entries {
		name := []byte(entry.Name)
		var size [4]byte
		binary.BigEndian.PutUint32(size[:], uint32(len(name)))
		hash.Write(size[:])
		hash.Write(name)
		hash.Write([]byte{map[string]byte{"file": 1, "directory": 2, "symlink": 3, "other": 4}[entry.Kind]})
	}
	return "sha256:" + hex.EncodeToString(hash.Sum(nil))
}

type ListResult struct {
	Outcome   string   `json:"outcome"`
	Entries   *[]Entry `json:"entries,omitempty"`
	Version   string   `json:"version,omitempty"`
	CheckedAt float64  `json:"checkedAt"`
}

func (p *Project) List(name, known string, maxEntries int, maxBytes ...int64) (ListResult, error) {
	if err := p.available(); err != nil {
		return ListResult{}, err
	}
	rel, err := p.resolveContained(name, true)
	if err != nil {
		return ListResult{}, err
	}
	dir, err := p.root.Open(rel)
	if errors.Is(err, fs.ErrNotExist) {
		return ListResult{Outcome: "missing", CheckedAt: checkedAt()}, nil
	}
	if err != nil {
		return ListResult{}, err
	}
	defer dir.Close()
	children, err := dir.ReadDir(maxEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return ListResult{}, err
	}
	if len(children) > maxEntries {
		return ListResult{}, fail("LIMIT_EXCEEDED")
	}
	entries := make([]Entry, 0, len(children))
	bodyBytes := int64(2)
	for _, child := range children {
		entry := Entry{child.Name(), kind(child.Type())}
		encoded, err := json.Marshal(entry)
		if err != nil {
			return ListResult{}, err
		}
		bodyBytes += int64(len(encoded))
		if len(entries) > 0 {
			bodyBytes++
		}
		if len(maxBytes) > 0 && bodyBytes > maxBytes[0] {
			return ListResult{}, fail("LIMIT_EXCEEDED")
		}
		entries = append(entries, entry)
	}
	v := listVersion(entries)
	if v == known {
		return ListResult{Outcome: "unchanged", Version: v, CheckedAt: checkedAt()}, nil
	}
	return ListResult{Outcome: "present", Entries: &entries, Version: v, CheckedAt: checkedAt()}, nil
}

type Metadata struct {
	FileID   string   `json:"fileId,omitempty"`
	Ino      *uint64  `json:"ino,omitempty"`
	Dev      *uint64  `json:"dev,omitempty"`
	CtimeMs  *float64 `json:"ctimeMs,omitempty"`
	Identity string   `json:"identity,omitempty"`
	Kind     string   `json:"kind"`
	Size     int64    `json:"size"`
	MtimeMs  float64  `json:"mtimeMs"`
	Mode     uint32   `json:"mode"`
}
type StatResult struct {
	Outcome   string    `json:"outcome"`
	Metadata  *Metadata `json:"metadata,omitempty"`
	CheckedAt float64   `json:"checkedAt"`
}

func mtime(info fs.FileInfo) float64 {
	return float64(info.ModTime().Unix())*1000 + float64(info.ModTime().Nanosecond())/1e6
}
func (p *Project) Stat(name string) (StatResult, error) { return p.stat(name, true) }

func (p *Project) stat(name string, follow bool) (StatResult, error) {
	if err := p.available(); err != nil {
		return StatResult{}, err
	}
	anchor := name
	if !follow && name != "" {
		anchor = filepath.ToSlash(filepath.Dir(name))
		if anchor == "." {
			anchor = ""
		}
	}
	rel, err := p.resolveContained(anchor, true)
	if !follow && name != "" {
		rel = filepath.ToSlash(filepath.Join(rel, filepath.Base(name)))
	}
	if err != nil {
		return StatResult{}, err
	}
	var info fs.FileInfo
	if follow {
		info, err = p.root.Stat(rel)
	} else {
		info, err = p.root.Lstat(rel)
	}
	if errors.Is(err, fs.ErrNotExist) {
		return StatResult{Outcome: "missing", CheckedAt: checkedAt()}, nil
	}
	if err != nil {
		return StatResult{}, err
	}
	return StatResult{Outcome: "present", Metadata: metadataOf(info), CheckedAt: checkedAt()}, nil
}

type RangeResult struct {
	Outcome   string  `json:"outcome"`
	Content   *string `json:"content,omitempty"`
	Version   string  `json:"version,omitempty"`
	Offset    int64   `json:"offset"`
	Extent    int64   `json:"extent"`
	CheckedAt float64 `json:"checkedAt"`
}

func (p *Project) Range(name string, offset, length, limit int64) (any, error) {
	if offset < 0 || length <= 0 || length > limit || offset > 9007199254740991-length {
		return nil, fail("BAD_REQUEST")
	}
	if err := p.available(); err != nil {
		return nil, err
	}
	file, err := p.openFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		return ReadResult{Outcome: "missing", CheckedAt: checkedAt()}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	extent := info.Size()
	count := min(length, max(int64(0), extent-offset))
	bytes := make([]byte, count)
	n, err := file.ReadAt(bytes, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	bytes = bytes[:n]
	content := base64.StdEncoding.EncodeToString(bytes)
	return RangeResult{Outcome: "present", Content: &content, Version: version(bytes), Offset: offset, Extent: extent, CheckedAt: checkedAt()}, nil
}

// Never steal by age or remote PID: a paused NFS writer may still own the
// critical section. Operator recovery of a crash requires stopping writers.
func (p *Project) WithWriterLock(ctx context.Context, work func() error) error {
	release, err := p.AcquireWriterLock(ctx)
	if err != nil {
		return err
	}
	defer release()
	return work()
}

func (p *Project) AcquireWriterLock(ctx context.Context) (func(), error) {
	if err := p.available(); err != nil {
		return nil, err
	}
	if err := p.root.MkdirAll(".memon/locks", 0700); err != nil {
		return nil, err
	}
	ignore, err := p.root.OpenFile(".memon/locks/.gitignore", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		_, err = ignore.WriteString("*\n")
		closed := ignore.Close()
		if err == nil {
			err = closed
		}
	} else if errors.Is(err, fs.ErrExist) {
		err = nil
	}
	if err != nil {
		return nil, err
	}
	for {
		err = p.root.Mkdir(WriterLockPath, 0700)
		if err == nil {
			break
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, fail("LIMIT_EXCEEDED")
		case <-time.After(50 * time.Millisecond):
		}
	}
	return func() { p.root.Remove(WriterLockPath) }, nil
}

type Precondition struct {
	ExpectedIdentity string   `json:"expectedIdentity,omitempty"`
	Kind             string   `json:"kind"`
	ExpectedMtime    *float64 `json:"expectedMtime,omitempty"`
	ExpectedHash     string   `json:"expectedHash,omitempty"`
}
type FileCheck struct {
	Path         string        `json:"path"`
	Precondition *Precondition `json:"precondition"`
}
type Mutation struct {
	Authority               string        `json:"-"`
	Project                 string        `json:"project"`
	Path                    string        `json:"path"`
	Operation               string        `json:"operation"`
	RequestID               string        `json:"requestId"`
	LockVersion             int           `json:"lockVersion"`
	Content                 string        `json:"content,omitempty"`
	Mode                    *uint32       `json:"mode,omitempty"`
	Precondition            *Precondition `json:"precondition,omitempty"`
	Destination             string        `json:"destination,omitempty"`
	DestinationPrecondition *Precondition `json:"destinationPrecondition,omitempty"`
	FileChecks              []FileCheck   `json:"fileChecks,omitempty"`
	Recursive               bool          `json:"recursive,omitempty"`
}

func (p *Project) check(name string, pre *Precondition, limit int64) error {
	return p.checkBudget(name, pre, &limit)
}
func (p *Project) checkBudget(name string, pre *Precondition, remaining *int64) error {
	if pre == nil {
		return fail("BAD_REQUEST")
	}
	// Existence and directory identity must be checked without opening a directory as a file.
	info, err := p.root.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		if pre.Kind == "absent" {
			return nil
		}
		return fail("CONFLICT")
	}
	if err != nil {
		return err
	}
	if pre.Kind == "absent" {
		return fail("CONFLICT")
	}
	if pre.Kind == "entry" {
		if info.Mode()&fs.ModeSymlink == 0 || pre.ExpectedIdentity == "" || pre.ExpectedIdentity != fileIdentity(info) {
			return fail("CONFLICT")
		}
		return nil
	}
	if pre.Kind == "directory" {
		if !info.IsDir() || pre.ExpectedIdentity == "" || pre.ExpectedIdentity != fileIdentity(info) {
			return fail("CONFLICT")
		}
		return nil
	}
	file, err := p.openFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		if pre.Kind == "absent" {
			return nil
		}
		return fail("CONFLICT")
	}
	if err != nil {
		return err
	}
	defer file.Close()
	if pre.Kind == "absent" {
		return fail("CONFLICT")
	}
	if pre.Kind != "match" || pre.ExpectedMtime == nil || (len(pre.ExpectedHash) != 40 && len(pre.ExpectedHash) != 64) {
		return fail("BAD_REQUEST")
	}
	info, err = file.Stat()
	if err != nil {
		return err
	}
	bytes, err := io.ReadAll(io.LimitReader(file, *remaining+1))
	if err != nil {
		return err
	}
	if int64(len(bytes)) > *remaining {
		return fail("LIMIT_EXCEEDED")
	}
	*remaining -= int64(len(bytes))
	sum := sha256.Sum256(bytes)
	actual := hex.EncodeToString(sum[:])
	if len(pre.ExpectedHash) == 40 {
		old := sha1.Sum(bytes)
		actual = hex.EncodeToString(old[:])
	}
	if mtime(info) != *pre.ExpectedMtime || actual != pre.ExpectedHash {
		return fail("CONFLICT")
	}
	return nil
}
func (p *Project) Mutate(ctx context.Context, m Mutation, limits Limits) error {
	if err := p.validateMutation(m); err != nil {
		return err
	}
	return p.WithWriterLock(ctx, func() error { return p.mutateLocked(m, limits) })
}
func (p *Project) validateMutation(m Mutation) error {
	if p.Config.ReadOnly {
		return fail("READ_ONLY")
	}
	if p.Config.AcknowledgedWriterLockVersion != WriterLockVersion {
		return fail("WRITER_UPGRADE_REQUIRED")
	}
	if m.LockVersion != WriterLockVersion || m.RequestID == "" || !validPath(m.Path, false) {
		return fail("BAD_REQUEST")
	}
	if len(m.FileChecks) > MaxDirectoryFileChecks {
		return fail("LIMIT_EXCEEDED")
	}
	seen := map[string]bool{}
	for _, check := range m.FileChecks {
		if m.Operation != "rename" || m.Precondition == nil || m.Precondition.Kind != "directory" ||
			!validPath(check.Path, false) || !strings.HasPrefix(check.Path, m.Path+"/") || seen[check.Path] ||
			check.Precondition == nil || check.Precondition.Kind != "match" {
			return fail("BAD_REQUEST")
		}
		seen[check.Path] = true
	}
	return nil
}
func (p *Project) mutateLocked(m Mutation, limits Limits) error {
	parent := filepath.ToSlash(filepath.Dir(m.Path))
	if parent == "." {
		parent = ""
	}
	anchor, err := p.resolveContained(parent, true)
	rel := path.Join(anchor, filepath.Base(m.Path))

	if err != nil {
		return err
	}
	if m.Mode != nil && *m.Mode > 07777 {
		return fail("BAD_REQUEST")
	}
	if m.Operation == "mkdir" {
		mode := fs.FileMode(0755)
		if m.Mode != nil {
			mode = permissionMode(*m.Mode)
		}
		if m.Recursive {
			return p.root.MkdirAll(rel, mode)
		}
		return p.root.Mkdir(rel, mode)
	}
	if m.Operation == "replace" && m.Precondition != nil && (m.Precondition.Kind == "directory" || m.Precondition.Kind == "entry") {
		return fail("BAD_REQUEST")
	}
	if err = p.check(rel, m.Precondition, limits.MaxBodyBytes); err != nil {
		return err
	}
	switch m.Operation {
	case "replace":
		bytes, err := base64.StdEncoding.Strict().DecodeString(m.Content)
		if err != nil || base64.StdEncoding.EncodeToString(bytes) != m.Content {
			return fail("BAD_REQUEST")
		}
		if int64(len(bytes)) > limits.MaxBodyBytes {
			return fail("LIMIT_EXCEEDED")
		}
		mode := fs.FileMode(0644)
		if info, err := p.root.Stat(rel); err == nil {
			mode = info.Mode()
		}
		if m.Mode != nil {
			mode = permissionMode(*m.Mode)
		}
		random := make([]byte, 16)
		if _, err = rand.Read(random); err != nil {
			return err
		}
		temp := path.Join(path.Dir(rel), "."+path.Base(rel)+"."+hex.EncodeToString(random)+".tmp")
		file, err := p.root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			return err
		}
		defer p.root.Remove(temp)
		if err = file.Chmod(mode); err != nil {
			file.Close()
			return err
		}
		_, err = file.Write(bytes)
		closed := file.Close()
		if err != nil {
			return err
		}
		if closed != nil {
			return closed
		}
		return p.root.Rename(temp, rel)
	case "delete":
		if m.Precondition.Kind == "absent" {
			return nil
		}
		return p.root.Remove(rel)
	case "rename":
		if m.Precondition.Kind == "directory" && (m.DestinationPrecondition == nil || m.DestinationPrecondition.Kind != "absent") {
			return fail("BAD_REQUEST")
		}
		if !validPath(m.Destination, false) {
			return fail("OUTSIDE_PROJECT")
		}
		destinationParent := filepath.ToSlash(filepath.Dir(m.Destination))
		if destinationParent == "." {
			destinationParent = ""
		}
		resolvedParent, err := p.resolveContained(destinationParent, true)
		destination := path.Join(resolvedParent, filepath.Base(m.Destination))
		if err != nil {
			return err
		}
		if err = p.check(destination, m.DestinationPrecondition, limits.MaxBodyBytes); err != nil {
			return err
		}
		remaining := limits.MaxBodyBytes
		for _, check := range m.FileChecks {
			name, err := p.resolveContained(check.Path, true)
			if errors.Is(err, fs.ErrNotExist) {
				return fail("CONFLICT")
			}
			if err != nil {
				return err
			}
			if !strings.HasPrefix(name, rel+"/") {
				return fail("OUTSIDE_PROJECT")
			}
			if err = p.checkBudget(name, check.Precondition, &remaining); err != nil {
				return err
			}
		}
		return p.root.Rename(rel, destination)
	default:
		return fail("BAD_REQUEST")
	}
}
func decodeStrict(bytes []byte, out any) error {
	decoder := json.NewDecoder(strings.NewReader(string(bytes)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fail("BAD_REQUEST")
	}
	var extra any
	if !errors.Is(decoder.Decode(&extra), io.EOF) {
		return fail("BAD_REQUEST")
	}
	return nil
}

// Resolve exposes only a canonical project-relative name; Root validates existence.
func (p *Project) Resolve(name string) (map[string]string, error) {
	if err := p.available(); err != nil {
		return nil, err
	}
	rel, err := p.resolveContained(name, true)
	if err != nil {
		return nil, err
	}
	if _, err = p.root.Stat(rel); err != nil {
		return nil, err
	}
	if rel == "." {
		rel = ""
	}
	return map[string]string{"path": rel}, nil
}

func fileIdentity(info fs.FileInfo) string {
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	proof := ""
	if value.IsValid() && value.Kind() == reflect.Struct {
		for _, name := range []string{"Dev", "Ino", "Ctim", "Ctimespec"} {
			field := value.FieldByName(name)
			if field.IsValid() && field.CanInterface() {
				proof += name + ":" + fmt.Sprint(field.Interface()) + "\x00"
			}
		}
	}
	return version([]byte(proof))
}

func metadataOf(info fs.FileInfo) *Metadata {
	m := &Metadata{Kind: kind(info.Mode()), Size: info.Size(), MtimeMs: mtime(info), Mode: permissionBits(info.Mode()), Identity: fileIdentity(info), FileID: nodeIdentity(info)}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return m
	}
	for name, out := range map[string]**uint64{"Ino": &m.Ino, "Dev": &m.Dev} {
		field := value.FieldByName(name)
		if field.IsValid() && field.CanUint() {
			n := field.Uint()
			if n <= 1<<53-1 {
				*out = &n
			}
		}
	}
	for _, name := range []string{"Ctim", "Ctimespec"} {
		field := value.FieldByName(name)
		if field.IsValid() && field.Kind() == reflect.Struct {
			sec, nano := field.FieldByName("Sec"), field.FieldByName("Nsec")
			if sec.IsValid() && nano.IsValid() && sec.CanInt() && nano.CanInt() {
				n := float64(sec.Int())*1000 + float64(nano.Int())/1e6
				m.CtimeMs = &n
			}
		}
	}
	return m
}

func permissionMode(mode uint32) fs.FileMode {
	result := fs.FileMode(mode & 0777)
	if mode&04000 != 0 {
		result |= fs.ModeSetuid
	}
	if mode&02000 != 0 {
		result |= fs.ModeSetgid
	}
	if mode&01000 != 0 {
		result |= fs.ModeSticky
	}
	return result
}
func permissionBits(mode fs.FileMode) uint32 {
	result := uint32(mode.Perm())
	if mode&fs.ModeSetuid != 0 {
		result |= 04000
	}
	if mode&fs.ModeSetgid != 0 {
		result |= 02000
	}
	if mode&fs.ModeSticky != 0 {
		result |= 01000
	}
	return result
}

// Descriptor identity excludes ctime, which changes on ordinary log appends.
func nodeIdentity(info fs.FileInfo) string {
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return ""
	}
	proof := ""
	for _, name := range []string{"Dev", "Ino"} {
		field := value.FieldByName(name)
		if !field.IsValid() || !field.CanInterface() {
			return ""
		}
		proof += name + ":" + fmt.Sprint(field.Interface()) + "\x00"
	}
	return version([]byte(proof))
}
