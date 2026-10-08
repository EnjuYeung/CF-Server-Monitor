package cfprobe

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func scheduleRemoteUninstall(paths Paths, cfg Config) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if !managedRemoteUninstall(paths, executable, defaultPaths()) {
		fmt.Println("[INFO] Foreground Agent stopped; custom configuration does not permit removing installed services")
		return nil
	}
	command, pending := readRemoteUninstallIntent(paths, cfg)
	if !pending {
		return fmt.Errorf("remote uninstall requires a valid saved command")
	}
	stage, err := os.MkdirTemp(os.TempDir(), "jan-probe-uninstall-")
	if err != nil {
		return err
	}
	binary := filepath.Join(stage, "uninstaller")
	if err := copySelfTo(binary); err != nil {
		_ = os.RemoveAll(stage)
		return err
	}
	if err := os.Chmod(binary, 0o700); err != nil {
		_ = os.RemoveAll(stage)
		return err
	}
	if err := startRemoteUninstaller(paths, command.CommandID, binary); err != nil {
		_ = os.RemoveAll(stage)
		return err
	}
	return nil
}

func remoteUninstallUnit(commandID string) string {
	return serviceNameDefault + "-uninstall-" + commandID
}

func startRemoteUninstaller(paths Paths, commandID, binary string) error {
	system := serviceSystem(paths)
	if system == "systemd" || system == "systemd-user" {
		// A child in jan-probe's cgroup would be killed by systemctl stop.
		args := []string{}
		if paths.UserMode {
			args = append(args, "--user")
		}
		unit := remoteUninstallUnit(commandID)
		if commandExists("systemd-run") {
			runArgs := append(append([]string{}, args...), "--quiet", "--collect", "--unit="+unit, binary, "remote-uninstall")
			if err := exec.Command("systemd-run", runArgs...).Run(); err == nil {
				return nil
			}
		}
		serviceFile := filepath.Join(filepath.Dir(paths.ServiceFile), unit+".service")
		content := fmt.Sprintf("[Unit]\nDescription=Jan Probe remote uninstall\n\n[Service]\nType=oneshot\nExecStart=%s remote-uninstall\n", quoteSystemdExecArg(binary))
		if err := os.WriteFile(serviceFile, []byte(content), 0o600); err != nil {
			return err
		}
		if err := exec.Command("systemctl", append(append([]string{}, args...), "daemon-reload")...).Run(); err != nil {
			_ = os.Remove(serviceFile)
			return err
		}
		out, err := exec.Command("systemctl", append(args, "start", "--no-block", unit+".service")...).CombinedOutput()
		if err != nil {
			_ = os.Remove(serviceFile)
			return fmt.Errorf("start remote uninstaller: %w: %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	cmd := exec.Command(binary, "remote-uninstall")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func executeRemoteUninstall(version string) error {
	// Always remove our temporary copy, including failed cleanup attempts.
	if executable, err := os.Executable(); err == nil && filepath.Base(executable) == "uninstaller" &&
		strings.HasPrefix(filepath.Base(filepath.Dir(executable)), "jan-probe-uninstall-") &&
		filepath.Dir(filepath.Dir(executable)) == filepath.Clean(os.TempDir()) {
		defer os.RemoveAll(filepath.Dir(executable))
	}
	paths := defaultPaths()
	cfg, err := readConfig(paths.ConfigFile)
	if err != nil {
		return err
	}
	command, pending := readRemoteUninstallIntent(paths, cfg)
	if !pending {
		return fmt.Errorf("remote uninstall requires a valid saved command")
	}
	defer func() {
		unit := filepath.Join(filepath.Dir(paths.ServiceFile), remoteUninstallUnit(command.CommandID)+".service")
		if err := os.Remove(unit); err == nil {
			args := []string{}
			if paths.UserMode {
				args = append(args, "--user")
			}
			_ = exec.Command("systemctl", append(args, "daemon-reload")...).Run()
		}
	}()
	return Uninstall(version)
}
