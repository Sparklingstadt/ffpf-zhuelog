package main

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("output limit")
	}
	return b.Buffer.Write(p)
}
func boundedCommand(ctx context.Context, bin string, args, env []string, limit int) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = env
	cmd.WaitDelay = time.Second
	out := &limitedBuffer{limit: limit}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		return "", errors.New("local command failed")
	}
	return out.String(), nil
}

var batteryLine = regexp.MustCompile(`-InternalBattery-\d+\b`)
var percentPattern = regexp.MustCompile(`\b(\d{1,3})%;`)
var timePattern = regexp.MustCompile(`\b(\d{1,3}):(\d{2}) remaining\b`)
var sourcePattern = regexp.MustCompile(`Now drawing from '(AC|Battery) Power'`)

func batteryUnavailable(reason string) map[string]any {
	return map[string]any{"available": false, "reason": reason, "checkedAt": time.Now().UTC().Format(time.RFC3339Nano)}
}
func parseBattery(output string) map[string]any {
	line := ""
	for _, s := range strings.Split(output, "\n") {
		if batteryLine.MatchString(s) {
			line = s
			break
		}
	}
	if line == "" {
		if sourcePattern.MatchString(output) {
			return batteryUnavailable("no-battery")
		}
		return batteryUnavailable("read-failed")
	}
	p := percentPattern.FindStringSubmatch(line)
	if len(p) == 0 {
		return batteryUnavailable("read-failed")
	}
	percent, _ := strconv.Atoi(p[1])
	if percent > 100 {
		return batteryUnavailable("read-failed")
	}
	state := "unknown"
	parts := strings.Split(line, ";")
	if len(parts) > 1 {
		switch raw := strings.TrimSpace(parts[1]); raw {
		case "charging", "discharging", "charged":
			state = raw
		case "not charging", "AC attached":
			state = "not-charging"
		}
	}
	source := "unknown"
	if strings.Contains(output, "Now drawing from 'AC Power'") {
		source = "ac"
	} else if strings.Contains(output, "Now drawing from 'Battery Power'") {
		source = "battery"
	}
	var minutes any
	if m := timePattern.FindStringSubmatch(line); len(m) > 0 {
		h, _ := strconv.Atoi(m[1])
		min, _ := strconv.Atoi(m[2])
		if min < 60 && h*60+min <= 7*24*60 {
			minutes = h*60 + min
		}
	}
	return map[string]any{"available": true, "percent": percent, "state": state, "powerSource": source, "remainingMinutes": minutes, "checkedAt": time.Now().UTC().Format(time.RFC3339Nano)}
}
func readBattery(ctx context.Context) (map[string]any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if runtime.GOOS != "darwin" {
		return batteryUnavailable("unsupported"), nil
	}
	deadline, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := boundedCommand(deadline, "/usr/bin/pmset", []string{"-g", "batt"}, []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C"}, 16*1024)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return batteryUnavailable("read-failed"), nil
	}
	return parseBattery(output), nil
}
