package agent

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
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
	project.Config.ServicePorts = []int{port}
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
