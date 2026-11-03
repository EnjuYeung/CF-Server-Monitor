package cfprobe

import (
	"fmt"
	"log"
	"os"
	"time"
)

type logger struct {
	debug bool
	l     *log.Logger
}

func newLogger(debug bool) logger {
	return logger{
		debug: debug,
		l:     log.New(os.Stdout, "", 0),
	}
}

func (l logger) info(format string, args ...any) {
	l.l.Printf("[INFO] %s %s", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, args...))
}

func (l logger) debugf(format string, args ...any) {
	if l.debug {
		l.l.Printf("[DEBUG] %s %s", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, args...))
	}
}

func (l logger) warnf(format string, args ...any) {
	if l.debug {
		l.l.Printf("[WARN] %s %s", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, args...))
	}
}

// Operational failures must remain visible with DEBUG=0.
func (l logger) warn(format string, args ...any) {
	l.l.Printf("[WARN] %s %s", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, args...))
}
