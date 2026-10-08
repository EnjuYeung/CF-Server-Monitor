package cfprobe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

type agentUninstallCommand struct {
	Type      string `json:"type"`
	ServerID  string `json:"server_id"`
	CommandID string `json:"command_id"`
	IssuedAt  int64  `json:"issued_at"`
	Signature string `json:"signature"`
}

var removalUUID = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)

func (command agentUninstallCommand) valid(cfg Config) bool {
	if command.Type != "agent_uninstall" || command.ServerID != cfg.ServerID || cfg.Secret == "" ||
		!removalUUID.MatchString(command.ServerID) || !removalUUID.MatchString(command.CommandID) || command.IssuedAt <= 0 {
		return false
	}
	signature, err := hex.DecodeString(command.Signature)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(cfg.Secret))
	fmt.Fprintf(mac, "jan-monitor:agent-uninstall:v1\n%s\n%s\n%d", command.ServerID, command.CommandID, command.IssuedAt)
	return hmac.Equal(signature, mac.Sum(nil))
}

func remoteUninstallIntentFile(paths Paths) string {
	return filepath.Join(paths.ConfigDir, "remote-uninstall.json")
}

func readRemoteUninstallIntent(paths Paths, cfg Config) (agentUninstallCommand, bool) {
	var command agentUninstallCommand
	body, err := os.ReadFile(remoteUninstallIntentFile(paths))
	if err != nil || json.Unmarshal(body, &command) != nil {
		return command, false
	}
	return command, command.valid(cfg)
}

func saveRemoteUninstallIntent(paths Paths, command agentUninstallCommand) error {
	file, err := os.CreateTemp(paths.ConfigDir, ".remote-uninstall-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := json.NewEncoder(file).Encode(command); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), remoteUninstallIntentFile(paths))
}

func (a *Agent) handleRemoteUninstall(body []byte) bool {
	var command agentUninstallCommand
	if json.Unmarshal(body, &command) != nil || command.Type != "agent_uninstall" {
		return false
	}
	if !command.valid(a.configSnapshot()) {
		a.log.warnf("remote uninstall rejected: invalid signature or server ID")
		return false
	}
	a.uninstallMu.Lock()
	defer a.uninstallMu.Unlock()
	if a.uninstallRequested {
		return true
	}
	// A service restart must resume cleanup without starting collection again.
	if err := saveRemoteUninstallIntent(a.paths, command); err != nil {
		a.log.warnf("remote uninstall intent could not be saved: %v", err)
		return false
	}
	a.uninstallRequested = true
	a.log.info("remote uninstall accepted server=%s command=%s; stopping reports", command.ServerID, command.CommandID)
	if a.cancel != nil {
		a.cancel()
	}
	return true
}

// Only a normal managed installation can clean system/user service paths.
// Foreground runs with custom configs still stop, but cannot remove host services.
func managedRemoteUninstall(paths Paths, executable string, installed Paths) bool {
	return filepath.Clean(paths.ConfigFile) == filepath.Clean(installed.ConfigFile) &&
		(filepath.Clean(executable) == filepath.Clean(installed.BinaryFile) ||
			filepath.Clean(executable) == filepath.Clean(legacyServicePaths(installed).BinaryFile))
}
