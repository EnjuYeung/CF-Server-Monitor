package cfprobe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNativeConfigPreservesLegacyURLAndLocalMirror(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.conf")
	if err := os.WriteFile(path, []byte("SERVER_ID=\"sid\"\nSECRET=\"test\"\nWORKER_URL=\"http://127.0.0.1:8080/update\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := readConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ControllerURL != "http://127.0.0.1:8080/update" {
		t.Fatal(cfg.ControllerURL)
	}
	cfg.DownloadURL = "https://mirror.example.com/agent"
	if err = writeConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	got, err := readConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.ControllerURL != cfg.ControllerURL || got.DownloadURL != cfg.DownloadURL {
		t.Fatal(got)
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), "CONTROLLER_URL=") || !strings.Contains(string(raw), "WORKER_URL=") {
		t.Fatal(string(raw))
	}
	opts, err := parseInstallOptions([]string{"--download-url=https://other.example.com/agent"})
	if err != nil {
		t.Fatal(err)
	}
	mergeExplicitInstallConfig(&cfg, opts.Config, opts.Explicit)
	if cfg.ControllerURL != got.ControllerURL || cfg.DownloadURL != "https://other.example.com/agent" {
		t.Fatal(cfg)
	}
}

func TestNativeDownloadBase(t *testing.T) {
	for _, tc := range []struct {
		cfg  Config
		want string
	}{
		{Config{ControllerURL: "http://127.0.0.1:8080/update?secret=not-for-downloads"}, "http://127.0.0.1:8080/agent"},
		{Config{ControllerURL: "https://monitor.example.com/prefix/update"}, "https://monitor.example.com/prefix/agent"},
		{Config{ControllerURL: "wss://monitor.example.com/update"}, "https://monitor.example.com/agent"},
		{Config{ControllerURL: "http://127.0.0.1/update", DownloadURL: "https://mirror.example.com/agent/"}, "https://mirror.example.com/agent"},
	} {
		got, err := agentDownloadBase(tc.cfg)
		if err != nil || got != tc.want {
			t.Fatalf("got %q %v, want %q", got, err, tc.want)
		}
	}
	for _, raw := range []string{"file:///tmp/binary", "https://user:pass@example.com/agent", "https://example.com/agent?key=secret", "https://example.com/agent#fragment"} {
		if _, err := agentDownloadBase(Config{DownloadURL: raw}); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
}

func TestControllerUpdateDownloadAndChecksumFailures(t *testing.T) {
	artifact := []byte("native Agent binary fixture")
	hash := sha256.Sum256(artifact)
	expected := hex.EncodeToString(hash[:])
	name := expectedUpdateAssetName(runtime.GOOS, runtime.GOARCH)
	checksumMode := "valid"
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.RawQuery != "" || r.Header.Get("Authorization") != "" {
			t.Error("report credentials leaked to downloads")
		}
		switch r.URL.Path {
		case "/agent/releases.json":
			fmt.Fprintf(w, `[{"version":"v1.1.0","published_at":"2026-09-16T00:00:00Z","assets":[{"name":%q,"size":%d}]}]`, name, len(artifact))
		case "/agent/v1.1.0/checksums.txt":
			if checksumMode == "missing" {
				http.NotFound(w, r)
				return
			}
			sum := expected
			if checksumMode == "corrupt" {
				sum = strings.Repeat("0", 64)
			}
			fmt.Fprintf(w, "%s  %s\n", sum, name)
		default:
			if r.URL.Path != "/agent/v1.1.0/"+name {
				http.NotFound(w, r)
				return
			}
			w.Write(artifact)
		}
	}))
	defer server.Close()
	cfg := Config{ControllerURL: server.URL + "/update?secret=fixture"}
	candidate, found, err := checkLatestUpdate(context.Background(), "v1.0.99", cfg)
	if err != nil || !found || candidate.TagName != "v1.1.0" {
		t.Fatalf("candidate=%+v found=%v err=%v", candidate, found, err)
	}
	if _, found, err = checkLatestUpdate(context.Background(), "v1.1.0", cfg); found || err != nil {
		t.Fatal(found, err)
	}
	if _, found, err = checkLatestUpdate(context.Background(), "v2.0.0", cfg); found || err != nil {
		t.Fatal("automatic downgrade", found, err)
	}
	for _, mode := range []string{"valid", "corrupt", "missing"} {
		checksumMode = mode
		dir := t.TempDir()
		path, err := fetchUpdateBinary(dir, candidate, server.URL+"/agent", false)
		if mode == "valid" {
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(path)
			if err != nil || string(data) != string(artifact) {
				t.Fatal(string(data), err)
			}
		} else {
			if err == nil || path != "" {
				t.Fatalf("accepted %s checksum", mode)
			}
			files, _ := os.ReadDir(dir)
			if len(files) != 0 {
				t.Fatal("failed update left executable", files)
			}
		}
	}
	if len(paths) < 6 {
		t.Fatal(paths)
	}
}

func TestARMUpdateUsesBuiltVariant(t *testing.T) {
	original := buildARM
	defer func() { buildARM = original }()
	for _, arm := range []string{"5", "6", "7"} {
		buildARM = arm
		if got := expectedUpdateAssetName("linux", "arm"); got != "cf-probe-linux-armv"+arm {
			t.Fatal(got)
		}
		if got := expectedUpdateAssetName("freebsd", "arm"); got != "cf-probe-freebsd-arm" {
			t.Fatal(got)
		}
	}
}
