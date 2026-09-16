// Build the same platform set as upstream v1.0.16, without a release service.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type target struct{ OS, Arch, Suffix, ARM string }

var targets = []target{
	{"linux", "amd64", "amd64", ""}, {"linux", "arm64", "arm64", ""}, {"linux", "386", "386", ""},
	{"linux", "arm", "armv5", "5"}, {"linux", "arm", "armv6", "6"}, {"linux", "arm", "armv7", "7"}, {"linux", "loong64", "loong64", ""},
	{"freebsd", "amd64", "amd64", ""}, {"freebsd", "arm64", "arm64", ""}, {"freebsd", "386", "386", ""}, {"freebsd", "arm", "arm", "7"},
	{"darwin", "amd64", "amd64", ""}, {"darwin", "arm64", "arm64", ""},
	{"windows", "amd64", "amd64", ""}, {"windows", "arm64", "arm64", ""}, {"windows", "386", "386", ""},
}

type asset struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type manifest struct {
	Schema      int     `json:"schema_version"`
	Version     string  `json:"version"`
	PublishedAt string  `json:"published_at"`
	Prerelease  bool    `json:"prerelease"`
	Assets      []asset `json:"assets"`
}

func main() {
	if err := build(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func build() error {
	out := flag.String("out", "../agent-dist", "versioned output directory")
	selection := flag.String("targets", "all", "comma-separated OS/architecture names, e.g. linux/amd64,darwin/arm64")
	version := flag.String("version", "", "override release.json version (for independently versioned builds)")
	flag.Parse()
	raw, err := os.ReadFile("release.json")
	if err != nil {
		return err
	}
	var info manifest
	if err = json.Unmarshal(raw, &info); err != nil {
		return err
	}
	if *version != "" {
		info.Version = *version
		info.PublishedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if !regexp.MustCompile(`^(v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?|Snapshot-[0-9]+)$`).MatchString(info.Version) {
		return fmt.Errorf("invalid Agent version %q", info.Version)
	}
	info.Schema = 1
	info.Prerelease = strings.Contains(info.Version, "-")
	requested := map[string]bool{}
	if *selection != "all" {
		for _, s := range strings.Split(*selection, ",") {
			requested[strings.TrimSpace(s)] = false
		}
	}
	chosen := []target{}
	for _, t := range targets {
		key := t.OS + "/" + t.Suffix
		if _, ok := requested[key]; *selection == "all" || ok {
			chosen = append(chosen, t)
			requested[key] = true
		}
	}
	for key, found := range requested {
		if !found {
			return fmt.Errorf("unsupported target %q", key)
		}
	}
	if len(chosen) == 0 {
		return fmt.Errorf("no Agent targets selected")
	}
	if err = os.MkdirAll(*out, 0755); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(*out, ".build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	stage, err = filepath.Abs(stage)
	if err != nil {
		return err
	}
	var checksums strings.Builder
	for _, t := range chosen {
		name := "cf-probe-" + t.OS + "-" + t.Suffix
		if t.OS == "windows" {
			name += ".exe"
		}
		fmt.Printf("Building Agent %s %s/%s\n", info.Version, t.OS, t.Suffix)
		ldflags := "-s -w -X main.version=" + info.Version + " -X github.com/EnjuYeung/CF-Server-Monitor/agent/internal/cfprobe.buildARM=" + t.ARM
		cmd := exec.Command("go", "build", "-trimpath", "-buildvcs=false", "-ldflags="+ldflags, "-o", filepath.Join(stage, name), "./cmd/cf-probe")
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS="+t.OS, "GOARCH="+t.Arch, "GOARM="+t.ARM)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err = cmd.Run(); err != nil {
			return err
		}
		f, err := os.Open(filepath.Join(stage, name))
		if err != nil {
			return err
		}
		hash := sha256.New()
		size, err := io.Copy(hash, f)
		f.Close()
		if err != nil {
			return err
		}
		sum := hex.EncodeToString(hash.Sum(nil))
		info.Assets = append(info.Assets, asset{Name: name, Size: size, SHA256: sum})
		fmt.Fprintf(&checksums, "%s  %s\n", sum, name)
	}
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stage, "manifest.json"), append(data, '\n'), 0644); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stage, "checksums.txt"), []byte(checksums.String()), 0644); err != nil {
		return err
	}
	final := filepath.Join(*out, info.Version)
	// MkdirTemp creates 0700; the runtime image serves artifacts as UID 1000.
	if err = os.Chmod(stage, 0755); err != nil {
		return err
	}
	if err = os.RemoveAll(final); err != nil {
		return err
	}
	if err = os.Rename(stage, final); err != nil {
		return err
	}
	for _, name := range []string{"install.sh", "install.ps1"} {
		data, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(*out, name), data, 0644); err != nil {
			return err
		}
	}
	fmt.Printf("Agent %s: %d verified artifacts in %s\n", info.Version, len(info.Assets), final)
	return nil
}
