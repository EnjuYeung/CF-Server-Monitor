package cfprobe

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Keep the existing configuration and traffic directory. Only installed program,
// service, PID and log names change; release asset names remain protocol-compatible.
func legacyServicePaths(paths Paths) Paths {
	legacy := paths
	legacy.ServiceName = legacyServiceName
	rename := func(path string) string {
		if path == "" {
			return ""
		}
		return filepath.Join(filepath.Dir(path), strings.ReplaceAll(filepath.Base(path), paths.ServiceName, legacyServiceName))
	}
	legacy.BinaryFile = rename(paths.BinaryFile)
	legacy.PIDFile = rename(paths.PIDFile)
	legacy.LogFile = rename(paths.LogFile)
	legacy.ServiceFile = rename(paths.ServiceFile)
	legacy.DebugEnvFile = rename(paths.DebugEnvFile)
	legacy.LaunchdLabel = strings.ReplaceAll(paths.LaunchdLabel, paths.ServiceName, legacyServiceName)
	legacy.LaunchdUserFile = rename(paths.LaunchdUserFile)
	legacy.LaunchdRootFile = rename(paths.LaunchdRootFile)
	return legacy
}

func hasLegacyService(paths Paths) bool {
	legacy := legacyServicePaths(paths)
	return paths.ServiceName != legacy.ServiceName && len(existingPaths(legacy.BinaryFile, legacy.ServiceFile, legacy.PIDFile)) > 0
}

func retireLegacyService(paths Paths) error {
	legacy := legacyServicePaths(paths)
	removeService(legacy)
	for _, file := range []string{legacy.BinaryFile, legacy.PIDFile} {
		if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove old service file %s: %w", file, err)
		}
	}
	if paths.UserMode {
		_ = os.Remove(userMigrationServiceFile(paths))
		_ = runCommandQuiet("systemctl", "--user", "daemon-reload")
	}
	return nil
}

func userMigrationServiceFile(paths Paths) string {
	return filepath.Join(filepath.Dir(paths.ServiceFile), serviceNameDefault+"-migrate.service")
}

func needsUserServiceMigration(paths Paths, executable, configFile string) bool {
	legacy := legacyServicePaths(paths)
	return runtime.GOOS == "linux" && paths.UserMode &&
		filepath.Clean(executable) == filepath.Clean(legacy.BinaryFile) &&
		(configFile == "" || filepath.Clean(configFile) == filepath.Clean(paths.ConfigFile)) &&
		fileExists(legacy.ServiceFile)
}

// Older user-mode Agents replace their binary and let the old service restart it.
// Run the new installer in a separate unit so stopping cf-probe cannot kill the
// migration itself. The old process keeps reporting until the installer stops it.
func scheduleLegacyUserServiceMigration(paths Paths, configFile string, debug bool) (bool, error) {
	executable, err := os.Executable()
	if err != nil {
		return false, err
	}
	if !needsUserServiceMigration(paths, executable, configFile) {
		return false, nil
	}
	unit := userMigrationServiceFile(paths)
	content := fmt.Sprintf(`[Unit]
Description=Jan Probe service name migration

[Service]
Type=oneshot
ExecStart=%s install -debug=%s
`, quoteSystemdExecArg(executable), boolInt(debug))
	if err := writeFileExecutable(unit, content, 0o600); err != nil {
		return false, err
	}
	if err := runCommand("systemctl", "--user", "daemon-reload"); err != nil {
		return false, err
	}
	if err := runCommand("systemctl", "--user", "start", "--no-block", filepath.Base(unit)); err != nil {
		return false, err
	}
	return true, nil
}
