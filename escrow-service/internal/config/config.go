// Package config loads and validates process configuration at startup, so a
// missing credential fails the boot rather than the first real request.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port            string
	SupabaseURL     string
	SupabaseKey     string
	LogLevel        string
	Version         string
	UpstreamTimeout time.Duration // per Supabase call
	TransferTimeout time.Duration // per fund-transfer attempt
	ShutdownGrace   time.Duration // how long in-flight requests get to finish
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:            envOr("PORT", "4001"),
		SupabaseURL:     os.Getenv("NEXT_PUBLIC_SUPABASE_URL"),
		SupabaseKey:     os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		LogLevel:        envOr("LOG_LEVEL", "info"),
		Version:         envOr("SERVICE_VERSION", "dev"),
		UpstreamTimeout: 10 * time.Second,
		TransferTimeout: 15 * time.Second,
		// longer than UpstreamTimeout: a request mid-flight to Supabase when
		// SIGTERM lands should finish, not be cut off with the outcome unknown
		ShutdownGrace: 20 * time.Second,
		ReadTimeout:   15 * time.Second,
		WriteTimeout:  30 * time.Second,
	}

	if cfg.SupabaseURL == "" {
		return nil, fmt.Errorf("NEXT_PUBLIC_SUPABASE_URL must be set")
	}
	if cfg.SupabaseKey == "" {
		return nil, fmt.Errorf("SUPABASE_SERVICE_ROLE_KEY must be set")
	}
	if _, err := strconv.Atoi(cfg.Port); err != nil {
		return nil, fmt.Errorf("PORT %q is not a number", cfg.Port)
	}

	if raw := os.Getenv("SHUTDOWN_GRACE_SECONDS"); raw != "" {
		secs, err := strconv.Atoi(raw)
		if err != nil || secs <= 0 {
			return nil, fmt.Errorf("SHUTDOWN_GRACE_SECONDS %q must be a positive integer", raw)
		}
		cfg.ShutdownGrace = time.Duration(secs) * time.Second
	}

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
