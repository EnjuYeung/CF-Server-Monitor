//go:build linux

package cfprobe

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinuxNetworkCountersRejectIncompleteReads(t *testing.T) {
	valid := " eth0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\n"
	for _, tt := range []struct {
		name, body, iface string
		want              NetBytes
		bad               bool
	}{
		{"valid", valid, "eth0", NetBytes{100, 200}, false},
		{"valid zero", "eth0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n", "eth0", NetBytes{}, false},
		{"missing interface", valid, "eth1", NetBytes{}, true},
		{"empty file", "", "", NetBytes{}, true},
		{"short row", "eth0: 1 2\n", "", NetBytes{}, true},
		{"bad counter", "eth0: bad 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\n", "", NetBytes{}, true},
		{"partial aggregate", valid + "eth1: 1 2\n", "", NetBytes{}, true},
		{"unselected malformed row", valid + "eth1: 1 2\n", "eth0", NetBytes{100, 200}, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "netdev")
			if err := os.WriteFile(path, []byte(tt.body), 0o600); err != nil {
				t.Fatal(err)
			}
			got, err := readNetBytesFromFile(path, tt.iface)
			if (err != nil) != tt.bad || got != tt.want {
				t.Fatalf("got=%+v error=%v", got, err)
			}
		})
	}
	if _, err := readNetBytesFromFile(filepath.Join(t.TempDir(), "missing"), ""); err == nil {
		t.Fatal("missing counter file returned a usable sample")
	}
}
