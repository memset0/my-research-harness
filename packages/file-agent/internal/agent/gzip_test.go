package agent

import (
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFileOperationsCompressOnlyWhenAccepted(t *testing.T) {
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
	get := func(encoding, etag string) *http.Response {
		t.Helper()
		request, _ := http.NewRequest("GET", host.URL+"/v1/read?project=project-a&path=docs/a.txt", nil)
		request.Header.Set("X-Memon-Expected-Source-Identity", p.Identity())
		// An explicit header disables the Go client's transparent decompression.
		request.Header.Set("Accept-Encoding", encoding)
		if etag != "" {
			request.Header.Set("If-None-Match", etag)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	compressed := get("gzip", "")
	defer compressed.Body.Close()
	if compressed.StatusCode != 200 || compressed.Header.Get("Content-Encoding") != "gzip" {
		t.Fatal(compressed.StatusCode, compressed.Header)
	}
	reader, err := gzip.NewReader(compressed.Body)
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Outcome string `json:"outcome"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(reader).Decode(&value); err != nil || value.Outcome != "present" {
		t.Fatal(err, value)
	}
	plain := get("identity", "")
	defer plain.Body.Close()
	if plain.Header.Get("Content-Encoding") != "" {
		t.Fatal(plain.Header)
	}
	unchanged := get("gzip", compressed.Header.Get("ETag"))
	defer unchanged.Body.Close()
	if unchanged.StatusCode != 304 || unchanged.Header.Get("Content-Encoding") != "" {
		t.Fatal(unchanged.StatusCode, unchanged.Header)
	}
}
