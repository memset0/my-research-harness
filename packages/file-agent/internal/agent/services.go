package agent

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ServicePort is one forwarded application port. A bare number in the config
// forwards to 127.0.0.1; {"host": "...", "port": N} forwards port N to that
// host on the cluster network. The operator's config is the only allowlist:
// a Report names a port, never a host.
type ServicePort struct {
	Host string `json:"host,omitempty"`
	Port int    `json:"port"`
}

func (s *ServicePort) UnmarshalJSON(data []byte) error {
	var port int
	if err := json.Unmarshal(data, &port); err == nil {
		*s = ServicePort{Port: port}
		return nil
	}
	type plain ServicePort
	var value plain
	if err := decodeStrict(data, &value); err != nil {
		return err
	}
	*s = ServicePort(value)
	return nil
}

func (s ServicePort) MarshalJSON() ([]byte, error) {
	if s.Host == "" {
		return json.Marshal(s.Port)
	}
	type plain ServicePort
	return json.Marshal(plain(s))
}

// address is the upstream the agent dials for this port.
func (s ServicePort) address() string {
	host := s.Host
	if host == "" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, strconv.Itoa(s.Port))
}

var serviceHostname = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$`)

// validServicePorts accepts ports 1-65535, each at most once, with an empty
// host, an IP address or a DNS hostname (no scheme, path or port).
func validServicePorts(ports []ServicePort) bool {
	seen := map[int]bool{}
	for _, port := range ports {
		if port.Port < 1 || port.Port > 65535 || seen[port.Port] {
			return false
		}
		seen[port.Port] = true
		if port.Host != "" && net.ParseIP(port.Host) == nil &&
			(len(port.Host) > 253 || !serviceHostname.MatchString(port.Host)) {
			return false
		}
	}
	return true
}

// A separately granted application transport. The source kernel knows ports
// and their configured hosts, never document manifests, commands, or
// application lifecycle.
func (s *Server) serveService(w http.ResponseWriter, r *http.Request) {
	select {
	case s.serviceCapacity <- struct{}{}:
		defer func() { <-s.serviceCapacity }()
	default:
		respondError(w, fail("LIMIT_EXCEEDED"))
		return
	}
	state, release := s.acquireState()
	defer release()
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/v1/services/"), "/", 3)
	if len(parts) != 3 {
		respondError(w, fail("BAD_REQUEST"))
		return
	}
	projectID := parts[0]
	principal, err := state.authorize(r, projectID, false)
	if err != nil {
		respondError(w, err)
		return
	}
	project := state.projects[projectID]
	if !state.serviceGrants[principal][projectID] {
		respondError(w, fail("FORBIDDEN"))
		return
	}
	port, err := strconv.Atoi(parts[1])
	var service *ServicePort
	for index, candidate := range project.Config.ServicePorts {
		if candidate.Port == port {
			service = &project.Config.ServicePorts[index]
		}
	}
	if err != nil || service == nil {
		respondError(w, fail("FORBIDDEN"))
		return
	}
	if r.Header.Get("X-Memon-Expected-Source-Identity") != project.Identity() {
		respondError(w, fail("SOURCE_UNAVAILABLE"))
		return
	}
	if err := project.available(); err != nil {
		respondError(w, err)
		return
	}
	// Authorized applications may stream for longer than ordinary file requests.
	// Keep admission bounded, but let cancellation/connection close end the stream.
	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(time.Time{}); err != nil {
		respondError(w, fail("SOURCE_UNAVAILABLE"))
		return
	}
	if err := controller.SetReadDeadline(time.Time{}); err != nil {
		respondError(w, fail("SOURCE_UNAVAILABLE"))
		return
	}
	target := &url.URL{Scheme: "http", Host: service.address()}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1
	// A remote upstream that cannot be reached fails like a stopped local one.
	proxy.Transport = &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		ResponseHeaderTimeout: 10 * time.Second,
		DisableKeepAlives:     true,
	}
	proxy.Director = func(out *http.Request) {
		out.URL.Scheme = target.Scheme
		out.URL.Host = target.Host
		out.URL.Path = "/" + parts[2]
		// Re-encode decoded path to preserve query/path separation.
		out.URL.RawPath = ""
		out.Host = target.Host
		out.Header.Del("Authorization")
		out.Header.Del("Proxy-Authorization")
		out.Header.Del("X-Memon-Expected-Source-Identity")
		cookies := []string{}
		for _, cookie := range out.Cookies() {
			if !strings.HasPrefix(strings.ToLower(cookie.Name), "memon-") {
				cookies = append(cookies, cookie.String())
			}
		}
		out.Header.Del("Cookie")
		if len(cookies) > 0 {
			out.Header.Set("Cookie", strings.Join(cookies, "; "))
		}
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		response.Header.Set("X-Memon-Source-Identity", project.Identity())
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { respondError(w, fail("SOURCE_UNAVAILABLE")) }
	proxy.ServeHTTP(w, r)
}
