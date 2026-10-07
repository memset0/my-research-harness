package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"memon/file-agent/internal/agent"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	configPath := flag.String("config", "", "operator JSON config for authenticated file service")
	lockRoot := flag.String("lock-root", "", "hold the shared writer lock for a local transaction until stdin closes")
	describe := flag.Bool("describe", false, "print source identities for pinning central configuration")
	flag.Parse()
	if *lockRoot != "" {
		project, err := agent.OpenProject(agent.ProjectConfig{Root: *lockRoot, SourceIdentity: "local-lock"})
		if err != nil {
			log.Fatal(err)
		}
		defer project.Close()
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		err = project.WithWriterLock(ctx, func() error {
			fmt.Println("locked:1")
			done := make(chan error, 1)
			go func() { _, err := io.Copy(io.Discard, os.Stdin); done <- err }()
			select {
			case err := <-done:
				return err
			case <-ctx.Done():
				return nil
			}
		})
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	if *configPath == "" {
		log.Fatal("--config is required")
	}
	cfg, err := agent.LoadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	if *describe {
		identities := map[string]string{}
		for name, config := range cfg.Projects {
			project, err := agent.OpenProject(config)
			if err != nil {
				log.Fatal(err)
			}
			identities[name] = project.Identity()
			project.Close()
		}
		json.NewEncoder(os.Stdout).Encode(map[string]any{"protocolMajor": agent.ProtocolMajor, "writerLockVersion": agent.WriterLockVersion, "projects": identities})
		return
	}
	handler, err := agent.NewServer(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer handler.Close()
	server := &http.Server{Addr: cfg.Listen, Handler: handler, TLSConfig: handler.TLSConfig(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	events := make(chan os.Signal, 1)
	signal.Notify(events, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for event := range events {
			if event == syscall.SIGHUP {
				next, err := agent.LoadConfig(*configPath)
				if err == nil {
					if next.Listen != cfg.Listen || next.ReplayDirectory != cfg.ReplayDirectory {
						err = fmt.Errorf("listener/replay changes require restart")
					} else {
						err = handler.Reload(next)
					}
				}
				if err != nil {
					log.Print("config reload rejected")
				} else {
					log.Print("config reloaded")
				}
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			server.Shutdown(ctx)
			cancel()
			return
		}
	}()
	if err = server.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
