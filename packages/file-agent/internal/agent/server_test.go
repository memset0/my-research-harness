package agent

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type certificates struct {
	ca          string
	server      string
	serverKey   string
	client      string
	clientKey   string
	fingerprint string
}

func certFixture(t *testing.T) certificates {
	t.Helper()
	goBin := os.Getenv("MEMON_GO")
	if goBin == "" {
		goBin = "go"
	}
	program := filepath.Join("..", "..", "..", "test-utils", "native", "tls-fixture", "main.go")
	output, err := exec.Command(goBin, "run", program, t.TempDir()).Output()
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		CA          string `json:"ca"`
		Server      string `json:"server"`
		ServerKey   string `json:"serverKey"`
		Client      string `json:"client"`
		ClientKey   string `json:"clientKey"`
		Fingerprint string `json:"fingerprint"`
	}
	if err = json.Unmarshal(output, &value); err != nil {
		t.Fatal(err)
	}
	return certificates{value.CA, value.Server, value.ServerKey, value.Client, value.ClientKey, value.Fingerprint}
}

func clientFor(t *testing.T, certs certificates, withCertificate bool) *http.Client {
	t.Helper()
	raw, _ := os.ReadFile(certs.ca)
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(raw)
	cfg := &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}
	if withCertificate {
		cert, err := tls.LoadX509KeyPair(certs.client, certs.clientKey)
		if err != nil {
			t.Fatal(err)
		}
		cfg.Certificates = []tls.Certificate{cert}
	}
	return &http.Client{Transport: &http.Transport{TLSClientConfig: cfg}, Timeout: 5 * time.Second}
}
func TestTLSGrantsReloadConditionalAndLimits(t *testing.T) {
	certs := certFixture(t)
	p := fixture(t)
	cfg := Config{Listen: "127.0.0.1:0", Certificate: certs.server, Key: certs.serverKey, ClientCA: certs.ca, ReplayDirectory: t.TempDir(), Projects: map[string]ProjectConfig{"project-a": p.Config}, Grants: map[string]map[string]string{certs.fingerprint: {"project-a": "read"}}, Limits: DefaultLimits()}
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
	post := func(body string) (*http.Response, error) {
		request, _ := http.NewRequest("POST", host.URL+"/v1/mutate", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Memon-Expected-Source-Identity", p.Identity())
		return client.Do(request)
	}
	get := func(path string) *http.Response {
		t.Helper()
		request, _ := http.NewRequest("GET", host.URL+path, nil)
		request.Header.Set("X-Memon-Expected-Source-Identity", p.Identity())
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	first := get("/v1/read?project=project-a&path=docs/a.txt")
	if first.StatusCode != 200 {
		t.Fatal(first.StatusCode)
	}
	etag := first.Header.Get("ETag")
	first.Body.Close()
	req, _ := http.NewRequest("GET", host.URL+"/v1/read?project=project-a&path=docs/a.txt", nil)
	req.Header.Set("If-None-Match", etag)
	req.Header.Set("X-Memon-Expected-Source-Identity", p.Identity())
	same, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(same.Body)
	same.Body.Close()
	if same.StatusCode != 304 || len(body) != 0 || same.Header.Get("X-Memon-Checked-At") == "" {
		t.Fatal(same.StatusCode, string(body))
	}
	unauthorized := get("/v1/read?project=project-b&path=docs/a.txt")
	unauthorized.Body.Close()
	if unauthorized.StatusCode != 403 {
		t.Fatal(unauthorized.StatusCode)
	}
	mutation := Mutation{Project: "project-a", Path: "new.txt", Operation: "replace", RequestID: "request-1", LockVersion: 1, Content: "eA==", Precondition: &Precondition{Kind: "absent"}}
	bytes, _ := json.Marshal(mutation)
	response, err := post(string(bytes))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("read grant mutated", response.StatusCode)
	}
	cfg.Grants = map[string]map[string]string{certs.fingerprint: {"project-a": "read-write"}}
	if err = handler.Reload(cfg); err != nil {
		t.Fatal(err)
	}
	response, err = post(string(bytes))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	response, err = post(string(bytes))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("duplicate was not replayed", response.StatusCode)
	}
	cfg.Grants = map[string]map[string]string{}
	if err = handler.Reload(cfg); err != nil {
		t.Fatal(err)
	}
	revoked := get("/v1/read?project=project-a&path=docs/a.txt")
	revoked.Body.Close()
	if revoked.StatusCode != 403 {
		t.Fatal("old connection retained revoked grant")
	}
	if response, err = clientFor(t, certs, false).Get(host.URL + "/v1/read?project=project-a&path=docs/a.txt"); err == nil {
		response.Body.Close()
		t.Fatal("missing certificate accepted")
	}
}
