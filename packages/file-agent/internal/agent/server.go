package agent

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Listen          string                       `json:"listen"`
	Certificate     string                       `json:"certificate"`
	Key             string                       `json:"key"`
	ClientCA        string                       `json:"clientCA"`
	ReplayDirectory string                       `json:"replayDirectory"`
	Projects        map[string]ProjectConfig     `json:"projects"`
	Grants          map[string]map[string]string `json:"grants"`
	Limits          Limits                       `json:"limits"`
}
type snapshot struct {
	projects map[string]*Project
	grants   map[string]map[string]string
	tls      *tls.Config
	refs     int
	retired  bool
}
type Server struct {
	mu        sync.Mutex
	current   *snapshot
	limits    Limits
	capacity  chan struct{}
	replay    *ReplayStore
	groupCaps map[string]int
	handles   *readHandles
}

func LoadConfig(name string) (Config, error) {
	bytes, err := os.ReadFile(name)
	if err != nil {
		return Config{}, err
	}
	cfg := Config{Limits: DefaultLimits()}
	if err = decodeStrict(bytes, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.Listen == "" || cfg.ReplayDirectory == "" || !cfg.Limits.valid() {
		return Config{}, fail("BAD_REQUEST")
	}
	return cfg, nil
}
func loadSnapshot(cfg Config, previous *snapshot) (*snapshot, error) {
	cert, err := tls.LoadX509KeyPair(cfg.Certificate, cfg.Key)
	if err != nil {
		return nil, err
	}
	pem, err := os.ReadFile(cfg.ClientCA)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fail("BAD_REQUEST")
	}
	state := &snapshot{projects: map[string]*Project{}, grants: cfg.Grants, tls: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{cert}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert}}
	for id, project := range cfg.Projects {
		if id == "" {
			state.close()
			return nil, fail("BAD_REQUEST")
		}
		var p *Project
		var err error
		old := (*Project)(nil)
		if previous != nil {
			old = previous.projects[id]
		}
		if old != nil && old.Config.Root == project.Root && old.Config.SourceIdentity == project.SourceIdentity && old.Config.MountType == project.MountType && old.Config.MountSource == project.MountSource {
			p = old.clone(project)
		} else {
			p, err = OpenProject(project)
		}
		if err != nil {
			state.close()
			return nil, err
		}
		state.projects[id] = p
	}
	for fingerprint, grants := range cfg.Grants {
		if len(fingerprint) != 64 {
			state.close()
			return nil, fail("BAD_REQUEST")
		}
		if _, err := hex.DecodeString(fingerprint); err != nil {
			state.close()
			return nil, fail("BAD_REQUEST")
		}
		for project, grant := range grants {
			if state.projects[project] == nil || (grant != "read" && grant != "read-write") {
				state.close()
				return nil, fail("BAD_REQUEST")
			}
		}
	}
	return state, nil
}
func (st *snapshot) close() {
	for _, project := range st.projects {
		project.Close()
	}
}
func NewServer(cfg Config) (*Server, error) {
	state, err := loadSnapshot(cfg, nil)
	if err != nil {
		return nil, err
	}
	if !cfg.Limits.valid() {
		state.close()
		return nil, fail("BAD_REQUEST")
	}
	replay, err := OpenReplayStore(cfg.ReplayDirectory, cfg.Limits)
	if err != nil {
		state.close()
		return nil, err
	}
	groups := map[string]int{}
	for _, p := range state.projects {
		groups[sourceGroup(p)] = 0
	}
	for name := range groups {
		groups[name] = max(1, cfg.Limits.MaxConcurrent/max(1, len(groups)))
	}
	return &Server{current: state, limits: cfg.Limits, capacity: make(chan struct{}, cfg.Limits.MaxConcurrent*4), replay: replay, groupCaps: groups, handles: newReadHandles()}, nil
}
func (s *Server) Reload(cfg Config) error {
	if cfg.Limits != s.limits {
		return fail("BAD_REQUEST")
	}
	previous, release := s.acquireState()
	defer release()
	next, err := loadSnapshot(cfg, previous)
	if err != nil {
		return err
	}
	s.mu.Lock()
	old := s.current
	s.current = next
	groups := map[string]int{}
	for _, p := range next.projects {
		groups[sourceGroup(p)] = 0
	}
	for name := range groups {
		groups[name] = max(1, s.limits.MaxConcurrent/max(1, len(groups)))
	}
	s.groupCaps = groups
	old.retired = true
	closeOld := old.refs == 0
	s.mu.Unlock()
	if closeOld {
		old.close()
	}
	return nil
}
func (s *Server) Close() {
	s.handles.shutdown()
	s.mu.Lock()
	old := s.current
	old.retired = true
	closeOld := old.refs == 0
	s.mu.Unlock()
	if closeOld {
		old.close()
	}
	s.replay.Close()
}
func (s *Server) TLSConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS13, GetConfigForClient: func(*tls.ClientHelloInfo) (*tls.Config, error) {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.current.tls, nil
	}}
}
func (s *Server) acquireState() (*snapshot, func()) {
	s.mu.Lock()
	state := s.current
	state.refs++
	s.mu.Unlock()
	return state, func() {
		s.mu.Lock()
		state.refs--
		closeOld := state.retired && state.refs == 0
		s.mu.Unlock()
		if closeOld {
			state.close()
		}
	}
}
func (st *snapshot) authorize(r *http.Request, project string, write bool) (string, error) {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		return "", fail("UNAUTHORIZED")
	}
	leaf := r.TLS.PeerCertificates[0]
	intermediates := x509.NewCertPool()
	for _, cert := range r.TLS.PeerCertificates[1:] {
		intermediates.AddCert(cert)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: st.tls.ClientCAs, Intermediates: intermediates, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		return "", fail("UNAUTHORIZED")
	}
	sum := sha256.Sum256(leaf.Raw)
	principal := hex.EncodeToString(sum[:])
	grant := st.grants[principal][project]
	if grant == "" || st.projects[project] == nil {
		return "", fail("FORBIDDEN")
	}
	if write && grant != "read-write" {
		return "", fail("FORBIDDEN")
	}
	return principal, nil
}
func respond(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(value)
}
func respondError(w http.ResponseWriter, err error) {
	code := errorCode(err)
	status := http.StatusInternalServerError
	switch code {
	case "BAD_REQUEST", "OUTSIDE_PROJECT":
		status = 400
	case "UNAUTHORIZED":
		status = 401
	case "FORBIDDEN", "READ_ONLY", "WRITER_UPGRADE_REQUIRED":
		status = 403
	case "CONFLICT", "REPLAY_CONFLICT", "MUTATION_UNCERTAIN", "READ_HANDLE_EXPIRED":
		status = 409
	case "LIMIT_EXCEEDED":
		status = 429
		w.Header().Set("Retry-After", "1")
	case "SOURCE_UNAVAILABLE":
		status = 503
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": Error{Code: code}})
}

type query struct {
	Project      string `json:"project"`
	Path         string `json:"path"`
	KnownVersion string `json:"knownVersion,omitempty"`
	Operation    string `json:"operation,omitempty"`
	Offset       int64  `json:"offset,omitempty"`
	Length       int64  `json:"length,omitempty"`
	ReadToken    string `json:"readToken,omitempty"`
}

func (s *Server) perform(st *snapshot, r *http.Request, q query, readLimit int64) (any, error) {
	principal, err := st.authorize(r, q.Project, false)
	if err != nil {
		return nil, err
	}
	project := st.projects[q.Project]
	if r.Header.Get("X-Memon-Expected-Source-Identity") != project.Identity() {
		return nil, fail("SOURCE_UNAVAILABLE")
	}
	release, err := s.admit(sourceGroup(project), requestConcurrency(r, s.limits.MaxConcurrent))
	if err != nil {
		return nil, err
	}
	defer release()
	if q.Operation == "open-read" || q.Operation == "read-at" || q.Operation == "close-read" {
		if err := project.available(); err != nil {
			return nil, err
		}
	}
	switch q.Operation {
	case "close-read":
		return map[string]string{"outcome": "closed"}, s.handles.close(q.ReadToken, principal, q.Project, project.Identity())
	case "open-read":
		return s.handles.open(project, principal, q.Project, q.Path)
	case "read-at":
		return s.handles.read(q.ReadToken, principal, q.Project, project.Identity(), q.Offset, q.Length, min(readLimit, s.limits.MaxRangeBytes))
	case "read":
		return project.Read(q.Path, q.KnownVersion, readLimit)
	case "list":
		return project.List(q.Path, q.KnownVersion, int(readLimit/64), readLimit)
	case "stat":
		return project.Stat(q.Path)
	case "lstat":
		return project.stat(q.Path, false)
	case "resolve":
		return project.Resolve(q.Path)
	case "range":
		return project.Range(q.Path, q.Offset, q.Length, min(readLimit, s.limits.MaxRangeBytes))
	default:
		return nil, fail("BAD_REQUEST")
	}
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select {
	case s.capacity <- struct{}{}:
		defer func() { <-s.capacity }()
	default:
		respondError(w, fail("LIMIT_EXCEEDED"))
		return
	}
	state, release := s.acquireState()
	defer release()
	if r.Method == http.MethodGet {
		q := query{Project: r.URL.Query().Get("project"), Path: r.URL.Query().Get("path"), KnownVersion: strings.Trim(r.Header.Get("If-None-Match"), "\"")}
		if q.KnownVersion == "" {
			q.KnownVersion = r.URL.Query().Get("knownVersion")
		}
		if _, err := state.authorize(r, q.Project, false); err != nil {
			respondError(w, err)
			return
		}
		w.Header().Set("X-Memon-Source-Identity", state.projects[q.Project].Identity())
		if r.URL.Path == "/v1/capabilities" {
			respond(w, map[string]any{"protocolMajor": ProtocolMajor, "writerLockVersion": WriterLockVersion, "sourceIdentity": state.projects[q.Project].Identity(), "capabilities": []string{"read", "list", "stat", "lstat", "resolve", "range", "mutate", "batch", "replay", "directory-guards-v1", "read-handles-v1"}, "limits": s.advertisedLimits()})
			return
		}
		q.Operation = strings.TrimPrefix(r.URL.Path, "/v1/")
		q.ReadToken = r.URL.Query().Get("readToken")
		if q.Operation == "range" || q.Operation == "read-at" {
			var err error
			q.Offset, err = strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
			if err != nil {
				respondError(w, fail("BAD_REQUEST"))
				return
			}
			q.Length, err = strconv.ParseInt(r.URL.Query().Get("length"), 10, 64)
			if err != nil {
				respondError(w, fail("BAD_REQUEST"))
				return
			}
		}
		result, err := s.perform(state, r, q, s.limits.MaxBodyBytes)
		if err != nil {
			respondError(w, err)
			return
		}
		switch value := result.(type) {
		case ReadResult:
			if value.Version != "" {
				w.Header().Set("ETag", "\""+value.Version+"\"")
			}
			w.Header().Set("X-Memon-Checked-At", strconv.FormatFloat(value.CheckedAt, 'f', -1, 64))
			if value.Outcome == "unchanged" {
				w.WriteHeader(304)
				return
			}
		case ListResult:
			if value.Version != "" {
				w.Header().Set("ETag", "\""+value.Version+"\"")
			}
			w.Header().Set("X-Memon-Checked-At", strconv.FormatFloat(value.CheckedAt, 'f', -1, 64))
			if value.Outcome == "unchanged" {
				w.WriteHeader(304)
				return
			}
		}
		respond(w, result)
		return
	}
	if r.Method != http.MethodPost {
		respondError(w, fail("BAD_REQUEST"))
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.limits.MaxBodyBytes*2+4096))
	if err != nil {
		respondError(w, fail("LIMIT_EXCEEDED"))
		return
	}
	switch r.URL.Path {
	case "/v1/mutate":
		var mutation Mutation
		if decodeStrict(raw, &mutation) != nil {
			respondError(w, fail("BAD_REQUEST"))
			return
		}
		principal, err := state.authorize(r, mutation.Project, true)
		if err != nil {
			respondError(w, err)
			return
		}
		if mutation.RequestID == "" || len(mutation.RequestID) > 256 {
			respondError(w, fail("BAD_REQUEST"))
			return
		}
		project := state.projects[mutation.Project]
		if r.Header.Get("X-Memon-Expected-Source-Identity") != project.Identity() {
			respondError(w, fail("SOURCE_UNAVAILABLE"))
			return
		}
		w.Header().Set("X-Memon-Source-Identity", project.Identity())
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		mutation.Authority = project.Identity()
		err = s.replay.RunPrepared(ctx, principal, mutation, func() (func() error, func(), error) {
			if err := project.validateMutation(mutation); err != nil {
				return nil, nil, err
			}
			release, err := s.admit(sourceGroup(project), requestConcurrency(r, s.limits.MaxConcurrent))
			if err != nil {
				return nil, nil, err
			}
			unlock, err := project.AcquireWriterLock(ctx)
			if err != nil {
				release()
				return nil, nil, err
			}
			return func() error { return project.mutateLocked(mutation, s.limits) }, func() { unlock(); release() }, nil
		})
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, map[string]string{"outcome": "applied"})
	case "/v1/batch":
		var request struct {
			Items []query `json:"items"`
		}
		if decodeStrict(raw, &request) != nil {
			respondError(w, fail("BAD_REQUEST"))
			return
		}
		if len(request.Items) > s.limits.MaxBatchItems {
			respondError(w, fail("LIMIT_EXCEEDED"))
			return
		}
		results := make([]any, 0, len(request.Items))
		remaining := s.limits.MaxBodyBytes
		for _, q := range request.Items {
			if remaining < 256 {
				results = append(results, map[string]any{"error": Error{Code: "LIMIT_EXCEEDED"}})
				continue
			}
			result, err := s.perform(state, r, q, max(int64(1), (remaining-256)*3/4))
			if err != nil {
				result = map[string]any{"error": Error{Code: errorCode(err)}}
			}
			bytes, _ := json.Marshal(result)
			if int64(len(bytes)) > remaining {
				result = map[string]any{"error": Error{Code: "LIMIT_EXCEEDED"}}
			} else {
				remaining -= int64(len(bytes))
			}
			results = append(results, result)
		}
		respond(w, map[string]any{"items": results})
	default:
		respondError(w, fail("BAD_REQUEST"))
	}
}

var _ http.Handler = (*Server)(nil)

func sourceGroup(p *Project) string {
	if p.Config.StorageGroup != "" {
		return p.Config.StorageGroup
	}
	if p.Config.MountSource != "" {
		return p.Config.MountType + ":" + p.Config.MountSource
	}
	return p.Config.SourceIdentity
}
func requestConcurrency(r *http.Request, maximum int) int {
	value := r.Header.Get("X-Memon-Concurrency")
	if value == "" {
		return maximum
	}
	count, err := strconv.Atoi(value)
	if err != nil || count < 1 {
		return 0
	}
	return min(count, maximum)
}

func (s *Server) advertisedLimits() map[string]any {
	return map[string]any{"maxBodyBytes": s.limits.MaxBodyBytes, "maxRangeBytes": s.limits.MaxRangeBytes,
		"maxBatchItems": s.limits.MaxBatchItems, "maxConcurrent": s.limits.MaxConcurrent,
		"replayRetentionMs": s.limits.ReplayRetentionMs, "maxReadHandles": maxReadHandles, "readHandleIdleMs": readHandleTTL.Milliseconds()}
}
