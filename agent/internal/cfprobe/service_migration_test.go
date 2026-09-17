//go:build linux || freebsd

package cfprobe

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestJanServiceNamesPreserveExistingDataPaths(t *testing.T) {
	for _, paths := range []Paths{systemDefaultPaths(), userPaths("fixture", 1000, t.TempDir())} {
		legacy := legacyServicePaths(paths)
		if paths.ServiceName != "jan-probe" || filepath.Base(paths.BinaryFile) != "jan-probe" || filepath.Base(paths.ServiceFile) != "jan-probe.service" {
			t.Fatalf("new service paths: %+v", paths)
		}
		if legacy.ServiceName != "cf-probe" || filepath.Base(legacy.BinaryFile) != "cf-probe" || filepath.Base(legacy.ServiceFile) != "cf-probe.service" {
			t.Fatalf("legacy service paths: %+v", legacy)
		}
		if paths.ConfigFile != legacy.ConfigFile || paths.TrafficFile != legacy.TrafficFile || !strings.Contains(paths.ConfigDir, "cf-probe") {
			t.Fatal("existing state would be lost")
		}
	}
}

func TestOldUserBinaryRestartRequiresMigration(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("systemd user service is Linux-only")
	}
	paths := userPaths("fixture", 1000, t.TempDir())
	legacy := legacyServicePaths(paths)
	if err := os.MkdirAll(filepath.Dir(legacy.ServiceFile), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy.ServiceFile, []byte("[Service]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !needsUserServiceMigration(paths, legacy.BinaryFile, paths.ConfigFile) || !hasLegacyService(paths) {
		t.Fatal("old self-replaced user service was not recognized")
	}
	if needsUserServiceMigration(paths, paths.BinaryFile, paths.ConfigFile) || needsUserServiceMigration(paths, legacy.BinaryFile, filepath.Join(t.TempDir(), "config.conf")) {
		t.Fatal("normal or isolated foreground process must not migrate a service")
	}
	if err := os.Remove(legacy.ServiceFile); err != nil {
		t.Fatal(err)
	}
	if needsUserServiceMigration(paths, legacy.BinaryFile, "") {
		t.Fatal("absent service must not trigger migration")
	}
}

func TestProbeProcessDetectionIncludesBothServiceNames(t *testing.T) {
	for _, name := range []string{"cf-probe", "jan-probe"} {
		if !isProbeRunCommand("/usr/local/bin/"+name, []string{name, "run"}) {
			t.Fatalf("did not detect %s process", name)
		}
		if isProbeRunCommand("/usr/local/bin/"+name, []string{name, "install"}) {
			t.Fatalf("installer must not be killed as a running %s agent", name)
		}
	}
}

func TestOldAndNewServicesShareInstanceLock(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	release, err := acquireInstanceLock(Paths{ServiceName: "jan-probe"})
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if other, err := acquireInstanceLock(Paths{ServiceName: "cf-probe"}); err == nil {
		other()
		t.Fatal("old and new services could run concurrently")
	}
}

func TestJanSystemdUnitsUseNewServiceAndExistingConfiguration(t *testing.T) {
	paths := userPaths("fixture", 1000, t.TempDir())
	if err := writeSystemdUserService(paths, false); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(paths.ServiceFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{quoteSystemdExecArg(paths.BinaryFile), "-config=" + quoteSystemdExecArg(paths.ConfigFile), "SyslogIdentifier=jan-probe"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("missing %q in service definition", want)
		}
	}
	paths.ServiceFile = filepath.Join(t.TempDir(), "jan-probe.service")
	if err := writeSystemdService(paths, false); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(paths.ServiceFile)
	if err != nil || !strings.Contains(string(data), "SyslogIdentifier=jan-probe") {
		t.Fatalf("system service: %s, %v", data, err)
	}
}
