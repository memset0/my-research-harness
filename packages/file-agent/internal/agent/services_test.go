package agent

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestServiceGrantPortPinAndAdmission(t *testing.T) {
	certs := certFixture(t)
	project := fixture(t)
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || strings.Contains(r.Header.Get("Cookie"), "memon-") {
			t.Error("central credentials leaked")
		}
		w.Write([]byte("application"))
	}))
	defer app.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(app.URL, "http://127.0.0.1:"))
	project.Config.ServicePorts = []ServicePort{{Port: port}}
	cfg := Config{Listen: "127.0.0.1:0", Certificate: certs.server, Key: certs.serverKey, ClientCA: certs.ca, ReplayDirectory: t.TempDir(), Projects: map[string]ProjectConfig{"project-a": project.Config}, Grants: map[string]map[string]string{certs.fingerprint: {"project-a": "read"}}, Limits: DefaultLimits()}
	handler, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer handler.Close()
	host := httptest.NewUnstartedServer(handler)
	host.TLS = handler.TLSConfig()
	host.StartTLS()
	defer host.Close()
	client := clientFor(t, certs, true)
	call := func(path, source string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest("GET", host.URL+path, nil)
		req.Header.Set("X-Memon-Expected-Source-Identity", source)
		req.Header.Set("Authorization", "Basic consumed-centrally")
		req.Header.Set("Cookie", "memon-session=private; app=1")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	path := "/v1/services/project-a/" + strconv.Itoa(port) + "/"
	denied := call(path, project.Identity())
	denied.Body.Close()
	if denied.StatusCode != 403 {
		t.Fatal("file grant must not grant services", denied.StatusCode)
	}
	cfg.ServiceGrants = map[string]map[string]bool{certs.fingerprint: {"project-a": true}}
	if err := handler.Reload(cfg); err != nil {
		t.Fatal(err)
	}
	allowed := call(path, project.Identity())
	body, _ := io.ReadAll(allowed.Body)
	allowed.Body.Close()
	if allowed.StatusCode != 200 || string(body) != "application" || allowed.Header.Get("X-Memon-Source-Identity") != project.Identity() {
		t.Fatal("allowed service response", allowed.StatusCode, string(body))
	}
	wrong := call(path, "wrong-source")
	wrong.Body.Close()
	if wrong.StatusCode != 503 {
		t.Fatal(wrong.StatusCode)
	}
	other := call("/v1/services/project-a/1/", project.Identity())
	other.Body.Close()
	if other.StatusCode != 403 {
		t.Fatal(other.StatusCode)
	}
	for i := 0; i < cap(handler.serviceCapacity); i++ {
		handler.serviceCapacity <- struct{}{}
	}
	limited := call(path, project.Identity())
	limited.Body.Close()
	if limited.StatusCode != 429 {
		t.Fatal(limited.StatusCode)
	}
	files := call("/v1/read?project=project-a&path=docs/a.txt", project.Identity())
	files.Body.Close()
	if files.StatusCode != 200 {
		t.Fatal("services starved files", files.StatusCode)
	}
	for len(handler.serviceCapacity) > 0 {
		<-handler.serviceCapacity
	}
	cfg.ServiceGrants = nil
	if err := handler.Reload(cfg); err != nil {
		t.Fatal(err)
	}
	revoked := call(path, project.Identity())
	revoked.Body.Close()
	if revoked.StatusCode != 403 {
		t.Fatal(revoked.StatusCode)
	}
}

// Application streams outlive the bounded deadlines used by file operations.
func TestServiceStreamOutlivesFileDeadline(t *testing.T) {
	certs := certFixture(t)
	project := fixture(t)
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("first\n"))
		w.(http.Flusher).Flush()
		time.Sleep(350 * time.Millisecond)
		w.Write([]byte("last\n"))
	}))
	defer app.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(app.URL, "http://127.0.0.1:"))
	project.Config.ServicePorts = []ServicePort{{Port: port}}
	cfg := Config{Listen: "127.0.0.1:0", Certificate: certs.server, Key: certs.serverKey, ClientCA: certs.ca, ReplayDirectory: t.TempDir(), Projects: map[string]ProjectConfig{"project-a": project.Config}, Grants: map[string]map[string]string{certs.fingerprint: {"project-a": "read"}}, ServiceGrants: map[string]map[string]bool{certs.fingerprint: {"project-a": true}}, Limits: DefaultLimits()}
	handler, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer handler.Close()
	host := httptest.NewUnstartedServer(handler)
	host.Config.WriteTimeout = 200 * time.Millisecond
	host.TLS = handler.TLSConfig()
	host.StartTLS()
	defer host.Close()
	req, _ := http.NewRequest("GET", host.URL+"/v1/services/project-a/"+strconv.Itoa(port)+"/", nil)
	req.Header.Set("X-Memon-Expected-Source-Identity", project.Identity())
	response, err := clientFor(t, certs, true).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "first\nlast\n" {
		t.Fatalf("stream cut off: %q (%v)", body, err)
	}
}

func TestServicePortConfig(t *testing.T) {
	var ports []ServicePort
	if err := json.Unmarshal([]byte(`[8000, {"host": "gpu-node-1", "port": 8792}, {"host": "10.0.0.5", "port": 9000}]`), &ports); err != nil {
		t.Fatal(err)
	}
	want := []ServicePort{{Port: 8000}, {Host: "gpu-node-1", Port: 8792}, {Host: "10.0.0.5", Port: 9000}}
	if !reflect.DeepEqual(ports, want) || !validServicePorts(ports) {
		t.Fatal(ports)
	}
	if ports[0].address() != "127.0.0.1:8000" || ports[1].address() != "gpu-node-1:8792" {
		t.Fatal(ports[0].address(), ports[1].address())
	}
	if err := json.Unmarshal([]byte(`[{"host": "a", "port": 1, "path": "/x"}]`), &ports); err == nil {
		t.Fatal("unknown field accepted")
	}
	for _, bad := range [][]ServicePort{
		{{Host: "http://gpu-node-1", Port: 80}},
		{{Host: "gpu-node-1:22", Port: 80}},
		{{Host: "gpu node", Port: 80}},
		{{Port: 0}},
		{{Port: 8000}, {Host: "gpu-node-1", Port: 8000}},
	} {
		if validServicePorts(bad) {
			t.Errorf("accepted %+v", bad)
		}
	}
	encoded, _ := json.Marshal(want)
	if string(encoded) != `[8000,{"host":"gpu-node-1","port":8792},{"host":"10.0.0.5","port":9000}]` {
		t.Fatal(string(encoded))
	}
}

// A port with a configured host is forwarded to that host, under the same
// grant, identity and error handling as a loopback port.
func TestServiceForwardsToConfiguredHost(t *testing.T) {
	certs := certFixture(t)
	project := fixture(t)
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("remote " + r.URL.Path))
	}))
	defer app.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(app.URL, "http://127.0.0.1:"))
	closed := httptest.NewServer(http.NotFoundHandler())
	closedPort, _ := strconv.Atoi(strings.TrimPrefix(closed.URL, "http://127.0.0.1:"))
	closed.Close()
	project.Config.ServicePorts = []ServicePort{{Host: "localhost", Port: port}, {Host: "localhost", Port: closedPort}}
	cfg := Config{Listen: "127.0.0.1:0", Certificate: certs.server, Key: certs.serverKey, ClientCA: certs.ca, ReplayDirectory: t.TempDir(),
		Projects: map[string]ProjectConfig{"project-a": project.Config}, Grants: map[string]map[string]string{certs.fingerprint: {"project-a": "read"}},
		ServiceGrants: map[string]map[string]bool{certs.fingerprint: {"project-a": true}}, Limits: DefaultLimits()}
	handler, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer handler.Close()
	host := httptest.NewUnstartedServer(handler)
	host.TLS = handler.TLSConfig()
	host.StartTLS()
	defer host.Close()
	client := clientFor(t, certs, true)
	call := func(port int) (*http.Response, string) {
		t.Helper()
		req, _ := http.NewRequest("GET", host.URL+"/v1/services/project-a/"+strconv.Itoa(port)+"/page", nil)
		req.Header.Set("X-Memon-Expected-Source-Identity", project.Identity())
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res, string(body)
	}
	if res, body := call(port); res.StatusCode != 200 || body != "remote /page" {
		t.Fatal(res.StatusCode, body)
	}
	if res, _ := call(closedPort); res.StatusCode != 503 {
		t.Fatal("unreachable upstream", res.StatusCode)
	}
}
