package cfprobe

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReportAndUpdateClientPreservesTrustedHTTP2(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor != 2 {
			t.Errorf("expected HTTP/2 request, got %s", r.Proto)
		}
		if r.URL.Path == "/update" {
			body, err := io.ReadAll(r.Body)
			if err != nil || string(body) != `{"metrics":{"cpu":1}}` {
				t.Errorf("report body changed: %q, %v", body, err)
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_, _ = io.WriteString(w, "agent-download-fixture")
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()

	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	client := newUpdateHTTPClient(5*time.Second, false)
	transport := client.Transport.(*http.Transport)
	transport.TLSClientConfig = &tls.Config{RootCAs: roots}
	defer transport.CloseIdleConnections()

	report, err := client.Post(server.URL+"/update", "application/json", strings.NewReader(`{"metrics":{"cpu":1}}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = report.Body.Close()
	if report.StatusCode != http.StatusNoContent || report.ProtoMajor != 2 {
		t.Fatalf("unexpected report response: %d %s", report.StatusCode, report.Proto)
	}
	download, err := client.Get(server.URL + "/agent/v1.3.1/cf-probe-linux-amd64")
	if err != nil {
		t.Fatal(err)
	}
	defer download.Body.Close()
	body, err := io.ReadAll(download.Body)
	if err != nil || string(body) != "agent-download-fixture" || download.ProtoMajor != 2 {
		t.Fatalf("unexpected HTTP/2 download: %q %s, %v", body, download.Proto, err)
	}
}

func TestReportAndUpdateClientRejectsUntrustedTLS(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("untrusted TLS peer reached HTTP handler")
	}))
	defer server.Close()
	client := newUpdateHTTPClient(5*time.Second, false)
	defer client.CloseIdleConnections()
	response, err := client.Get(server.URL)
	if response != nil {
		_ = response.Body.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "certificate") {
		t.Fatalf("expected certificate rejection, got %v", err)
	}
}

func TestReportWebSocketRejectsUntrustedTLS(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("untrusted TLS peer reached WebSocket handshake")
	}))
	defer server.Close()
	connection, _, _, _, err := dialReportWebSocket(context.Background(), "wss"+strings.TrimPrefix(server.URL, "https"), nil, false, 5*time.Second)
	if connection != nil {
		_ = connection.conn.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "certificate") {
		t.Fatalf("expected WebSocket certificate rejection, got %v", err)
	}
}
