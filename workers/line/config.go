package main

import (
	"bufio"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type config struct {
	endpoint, token, codexBin, ghBin string
	development                      bool
}

var configKeys = map[string]bool{
	"LINE_WORKER_URL": true, "LINE_WORKER_TOKEN": true,
	"LINE_DEV_ISSUES_ENABLED": true, "CODEX_LOCAL_BIN": true, "LINE_GH_BIN": true,
	"NODE_ENV": true, "CHAT_PROVIDER": true, "VERCEL": true,
}
var hexToken = regexp.MustCompile(`(?i)^[0-9a-f]{64}$`)

// Read only worker settings. Never source a shell script or import DB/API secrets.
// Explicit environment (including empty values) wins over development dotenv files.
// Values must be literal single-line strings; expansions are intentionally rejected.
func loadConfig(dir string) (config, error) {
	values := map[string]string{}
	for k := range configKeys {
		if v, ok := os.LookupEnv(k); ok {
			values[k] = v
		}
	}
	for _, name := range []string{".env.development.local", ".env.local", ".env.development", ".env"} {
		f, err := os.Open(filepath.Join(dir, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return config{}, errors.New("cannot read worker configuration")
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			line = strings.TrimPrefix(line, "export ")
			key, raw, ok := strings.Cut(line, "=")
			key = strings.TrimSpace(key)
			if !ok || !configKeys[key] {
				continue
			}
			if _, exists := values[key]; exists {
				continue
			}
			v, err := literalEnv(raw)
			if err != nil {
				f.Close()
				return config{}, err
			}
			values[key] = v
		}
		err = scanner.Err()
		f.Close()
		if err != nil {
			return config{}, errors.New("cannot parse worker configuration")
		}
	}
	if values["VERCEL"] != "" || values["NODE_ENV"] != "development" || values["CHAT_PROVIDER"] != "codex-local" {
		return config{}, errors.New("worker requires local development / codex-local mode")
	}
	origin := values["LINE_WORKER_URL"]
	if origin == "" {
		origin = "http://localhost:3000"
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.RawPath != "" {
		return config{}, errors.New("invalid worker origin")
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return config{}, errors.New("worker origin must use HTTPS")
	}
	if !hexToken.MatchString(values["LINE_WORKER_TOKEN"]) {
		return config{}, errors.New("worker token must be 32-byte hex")
	}
	u.Path = "/api/line/worker"
	c := config{endpoint: u.String(), token: values["LINE_WORKER_TOKEN"], codexBin: values["CODEX_LOCAL_BIN"], ghBin: values["LINE_GH_BIN"], development: values["LINE_DEV_ISSUES_ENABLED"] == "true"}
	if c.codexBin == "" {
		c.codexBin = "codex"
	}
	if c.ghBin == "" {
		c.ghBin = "/opt/homebrew/bin/gh"
	}
	return c, nil
}

func literalEnv(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if strings.HasPrefix(v, "\"") || strings.HasPrefix(v, "'") {
		quote := v[0]
		end := strings.IndexByte(v[1:], quote)
		if end < 0 {
			return "", errors.New("worker dotenv values must be single-line literals")
		}
		end++
		tail := strings.TrimSpace(v[end+1:])
		if tail != "" && !strings.HasPrefix(tail, "#") {
			return "", errors.New("invalid worker dotenv value")
		}
		v = v[1:end]
	} else {
		v, _, _ = strings.Cut(v, "#")
		v = strings.TrimSpace(v)
	}
	if strings.ContainsAny(v, "$`\\\r\n") {
		return "", errors.New("worker dotenv requires literal values, not expansion")
	}
	return v, nil
}
