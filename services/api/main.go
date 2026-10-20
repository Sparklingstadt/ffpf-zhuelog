package main

import (
	"fmt"
	"os"
)

func main() {
	if _, err := LoadConfig(os.Getenv); err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
}
