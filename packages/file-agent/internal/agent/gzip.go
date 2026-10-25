package agent

import (
	"compress/gzip"
	"net/http"
	"strings"
)

// gzipResponse compresses file-operation bodies for clients that accept gzip.
// File bodies travel base64-encoded in JSON, so compression mostly pays on
// slow source links; bodiless statuses stay uncompressed.
type gzipResponse struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		if strings.TrimSpace(strings.SplitN(part, ";", 2)[0]) == "gzip" {
			return true
		}
	}
	return false
}

func (g *gzipResponse) WriteHeader(status int) {
	if g.wroteHeader {
		return
	}
	g.wroteHeader = true
	if status != http.StatusNotModified && status != http.StatusNoContent {
		g.Header().Set("Content-Encoding", "gzip")
		g.Header().Add("Vary", "Accept-Encoding")
		g.Header().Del("Content-Length")
		g.gz, _ = gzip.NewWriterLevel(g.ResponseWriter, gzip.BestSpeed)
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponse) Write(b []byte) (int, error) {
	g.WriteHeader(http.StatusOK)
	if g.gz == nil {
		return g.ResponseWriter.Write(b)
	}
	return g.gz.Write(b)
}

func (g *gzipResponse) Close() {
	if g.gz != nil {
		g.gz.Close()
	}
}
