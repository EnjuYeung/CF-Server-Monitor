package cfprobe

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStoppedAgentDoesNotSendPOSTRequests(t *testing.T) {
	requests := make(chan struct{}, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- struct{}{}
		_, _ = w.Write([]byte("OK"))
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	a := &Agent{ctx: ctx, log: newLogger(false)}
	cfg := Config{ControllerURL: server.URL}
	if _, err := a.postReportBody(cfg, []byte(`{}`), 0, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("report error=%v, want canceled", err)
	}
	if err := a.sendCorrectionConfirm(cfg, "0", "0"); !errors.Is(err, context.Canceled) {
		t.Fatalf("correction error=%v, want canceled", err)
	}
	if len(requests) != 0 {
		t.Fatal("stopped agent still sent a POST request")
	}
}

func TestAgentCancellationInterruptsInFlightPOSTRequests(t *testing.T) {
	for _, mode := range []string{"report", "fallback", "correction", "response-body"} {
		t.Run(mode, func(t *testing.T) {
			started := make(chan struct{})
			release := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if mode == "response-body" {
					w.WriteHeader(200)
					w.(http.Flusher).Flush()
				}
				close(started)
				select {
				case <-r.Context().Done():
				case <-release:
				}
			}))
			defer server.Close()
			defer close(release)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			a := &Agent{ctx: ctx, log: newLogger(false)}
			cfg := Config{ControllerURL: server.URL}
			done := make(chan error, 1)
			go func() {
				if mode == "correction" {
					done <- a.sendCorrectionConfirm(cfg, "0", "0")
					return
				}
				_, err := a.postReportBody(cfg, []byte(`{}`), 0, mode == "fallback")
				done <- err
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("request never reached server")
			}
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("error=%v, want canceled", err)
				}
			case <-time.After(time.Second):
				t.Fatal("request did not respond to shutdown")
			}
		})
	}
}
