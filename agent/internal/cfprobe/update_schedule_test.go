package cfprobe

import (
	"context"
	"reflect"
	"testing"
	"testing/synctest"
	"time"
)

func TestAutoUpdateChecksAtStartupAndEveryDay(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		var reasons []string
		go runAutoUpdateChecks(ctx, true, func(reason string) { reasons = append(reasons, reason) })
		synctest.Wait()
		if !reflect.DeepEqual(reasons, []string{"startup"}) {
			t.Fatal(reasons)
		}
		time.Sleep(24*time.Hour - time.Second)
		synctest.Wait()
		if len(reasons) != 1 {
			t.Fatalf("checked before daily deadline: %v", reasons)
		}
		time.Sleep(time.Second)
		synctest.Wait()
		time.Sleep(24 * time.Hour)
		synctest.Wait()
		if !reflect.DeepEqual(reasons, []string{"startup", "daily", "daily"}) {
			t.Fatal(reasons)
		}
		cancel()
		synctest.Wait()
		time.Sleep(48 * time.Hour)
		synctest.Wait()
		if len(reasons) != 3 {
			t.Fatal("checks continued after shutdown", reasons)
		}
	})
}

func TestAutoUpdateDisabledDoesNotCheck(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		calls := 0
		go runAutoUpdateChecks(context.Background(), false, func(string) { calls++ })
		synctest.Wait()
		time.Sleep(72 * time.Hour)
		synctest.Wait()
		if calls != 0 {
			t.Fatal("installation without AUTO_UPDATE checked for updates")
		}
	})
}

func TestAutoUpdateCancelledBeforeStartupDoesNotCheck(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runAutoUpdateChecks(ctx, true, func(string) { t.Fatal("checked after cancellation") })
}
