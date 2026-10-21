package agent

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// A separately granted loopback transport. The source kernel knows ports,
// never document manifests, commands, or application lifecycle.
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
	allowed := false
	for _, candidate := range project.Config.ServicePorts {
		if candidate == port {
			allowed = true
		}
	}
	if err != nil || !allowed {
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
	target := &url.URL{Scheme: "http", Host: "127.0.0.1:" + strconv.Itoa(port)}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1
	proxy.Transport = &http.Transport{ResponseHeaderTimeout: 10 * time.Second, DisableKeepAlives: true}
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
