package cfprobe

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestNetworkReadFailureReportsSavedOrCachedMonthlyTraffic(t *testing.T) {
	for _, running := range []bool{false, true} {
		name := "startup"
		if running {
			name = "running"
		}
		t.Run(name, func(t *testing.T) {
			reports := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload struct {
					Metrics map[string]any `json:"metrics"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Errorf("decode report: %v", err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				reports <- payload.Metrics
				_, _ = w.Write([]byte("OK"))
			}))
			defer server.Close()
			cfg := defaultConfig()
			cfg.ServerID = "network-failure-test"
			cfg.ControllerURL = server.URL
			cfg.ConnectionMode = connectionModeHTTP
			cfg.Interface = "cfsm_missing_interface_for_test"
			cfg.ResetDay = 0
			path := filepath.Join(t.TempDir(), "traffic.dat")
			st := trafficState{RXPrev: 100, TXPrev: 200, RXPeriod: 500, TXPeriod: 600, LastCheck: time.Now().Unix(), Interface: cfg.Interface}
			if err := writeTrafficState(path, st); err != nil {
				t.Fatal(err)
			}
			a := &Agent{cfg: cfg, paths: Paths{TrafficFile: path}, log: newLogger(false)}
			wantRX, wantTX := "500", "600"
			if running {
				a.fullAt = time.Now().Add(-time.Duration(cfg.ReportInterval) * time.Second)
				a.monthlyRX, a.monthlyTX = 510, 620
				wantRX, wantTX = "510", "620"
			}
			a.tick()
			select {
			case metrics := <-reports:
				if metrics["net_rx_monthly"] != wantRX || metrics["net_tx_monthly"] != wantTX {
					t.Fatalf("monthly traffic=%v/%v, want %s/%s", metrics["net_rx_monthly"], metrics["net_tx_monthly"], wantRX, wantTX)
				}
			default:
				t.Fatal("agent did not send a report")
			}
			if got := readTrafficState(path); got != st {
				t.Fatalf("failed read changed persisted state: %+v", got)
			}
		})
	}
}

func TestNetworkReadFailureDoesNotInflateTrafficOnRecovery(t *testing.T) {
	now := time.Now()
	a := &Agent{log: newLogger(false), prevNet: NetBytes{RX: 100, TX: 200}, prevTime: now}
	path := filepath.Join(t.TempDir(), "traffic.dat")
	if err := writeTrafficState(path, trafficState{RXPrev: 100, TXPrev: 200, RXPeriod: 500, TXPeriod: 600, LastCheck: now.Unix()}); err != nil {
		t.Fatal(err)
	}
	current, rx, tx := a.networkRates(now.Add(time.Second), NetBytes{}, errors.New("counter read failed"))
	if current != (NetBytes{RX: 100, TX: 200}) || rx != 0 || tx != 0 || !a.prevTime.Equal(now) {
		t.Fatalf("failed read changed the baseline: current=%+v rates=%d/%d at=%v", current, rx, tx, a.prevTime)
	}
	current, rx, tx = a.networkRates(now.Add(2*time.Second), NetBytes{RX: 110, TX: 220}, nil)
	if rx != 5 || tx != 10 {
		t.Fatalf("recovery rates=%d/%d, want 5/10", rx, tx)
	}
	monthlyRX, monthlyTX, err := calcMonthlyTraffic(path, current, 0, "")
	if err != nil || monthlyRX != 510 || monthlyTX != 620 {
		t.Fatalf("recovery totals=%d/%d error=%v", monthlyRX, monthlyTX, err)
	}
}

func TestNetworkRatesFirstReadAndCounterReset(t *testing.T) {
	now := time.Now()
	a := &Agent{log: newLogger(false)}
	_, rx, tx := a.networkRates(now, NetBytes{RX: 1000, TX: 2000}, nil)
	if rx != 0 || tx != 0 {
		t.Fatalf("first valid read produced rates=%d/%d", rx, tx)
	}
	_, rx, tx = a.networkRates(now.Add(time.Second), NetBytes{}, nil)
	if rx != 0 || tx != 0 {
		t.Fatalf("counter reset produced rates=%d/%d", rx, tx)
	}
	_, rx, tx = a.networkRates(now.Add(2*time.Second), NetBytes{RX: 3, TX: 4}, nil)
	if rx != 3 || tx != 4 {
		t.Fatalf("rates after reset=%d/%d, want 3/4", rx, tx)
	}
}

func TestReadNetBytesRejectsMissingInterface(t *testing.T) {
	if _, err := readNetBytes("cfsm_missing_interface_for_test"); err == nil {
		t.Fatal("missing interface returned a valid zero counter")
	}
}

func TestReadNetBytesReadsAvailableInterfaces(t *testing.T) {
	switch runtime.GOOS {
	case "linux", "darwin", "windows", "freebsd":
	default:
		t.Skip("network counters unsupported on this platform")
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || isExcludedNetInterface(iface.Name) {
			continue
		}
		if _, err := readNetBytes(""); err != nil {
			t.Fatalf("available network interfaces could not be read: %v", err)
		}
		return
	}
	t.Skip("no eligible network interface in this environment")
}

func TestNetworkFailureWarningAndRecoveryWithoutDebug(t *testing.T) {
	var output bytes.Buffer
	a := &Agent{log: logger{l: log.New(&output, "", 0)}}
	now := time.Now()
	for i := 0; i < 3; i++ {
		a.networkRates(now, NetBytes{}, errors.New("counter read failed"))
	}
	if strings.Count(output.String(), "[WARN]") != 1 {
		t.Fatalf("warnings=%q", output.String())
	}
	a.networkRates(now, NetBytes{100, 200}, nil)
	a.networkRates(now.Add(time.Second), NetBytes{}, errors.New("counter read failed again"))
	if strings.Count(output.String(), "[WARN]") != 2 || !strings.Contains(output.String(), "network counters recovered") {
		t.Fatalf("missing recovery or renewed warning: %s", output.String())
	}
}

func TestFailedRemoteCorrectionPreservesStateAndIsNotConfirmed(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; w.WriteHeader(204) }))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "traffic.dat")
	state := trafficState{RXPrev: 100, TXPrev: 200, RXPeriod: 500, TXPeriod: 600, LastCheck: time.Now().Unix(), Interface: "cfsm_missing_interface_for_test"}
	if err := writeTrafficState(path, state); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: Config{ControllerURL: server.URL, Interface: state.Interface}, paths: Paths{TrafficFile: path}, log: newLogger(false)}
	if err := a.applyRemoteConfig([]byte("rx_correction=1&tx_correction=2"), http.Header{}); err == nil {
		t.Fatal("correction accepted missing counters")
	}
	if got := readTrafficState(path); got != state {
		t.Fatalf("state changed: %+v", got)
	}
	if requests != 0 {
		t.Fatal("failed correction was confirmed")
	}
}

func TestCheckpointFailureWarnsWithoutDebugAndRecovers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "traffic.dat")
	initial, err := readNetBytes("")
	if err != nil {
		t.Skipf("no eligible network interface: %v", err)
	}
	state := trafficState{RXPrev: initial.RX, TXPrev: initial.TX, RXPeriod: 500, TXPeriod: 600, LastCheck: time.Now().Unix()}
	if err := writeTrafficState(path, state); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	cfg := defaultConfig()
	cfg.ControllerURL = server.URL
	cfg.ConnectionMode = connectionModeHTTP
	cfg.ResetDay = 0
	a := &Agent{cfg: cfg, paths: Paths{TrafficFile: path}, log: logger{l: log.New(&output, "", 0)}}
	a.tick()
	if !strings.Contains(output.String(), "[WARN]") || !strings.Contains(output.String(), "monthly traffic checkpoint failed") {
		t.Fatalf("missing warning: %s", output.String())
	}
	if got := readTrafficState(path); got != state {
		t.Fatalf("failed checkpoint changed state: %+v", got)
	}
	if err := os.Remove(path + ".tmp"); err != nil {
		t.Fatal(err)
	}
	a.fullAt = time.Time{}
	a.lastPostAttempt = time.Time{}
	a.lastPost = time.Time{}
	a.tick()
	if got := readTrafficState(path); got.RXPeriod < state.RXPeriod || got.TXPeriod < state.TXPeriod || got.LastCheck == 0 {
		t.Fatalf("checkpoint failed to recover: %+v", got)
	}
}
