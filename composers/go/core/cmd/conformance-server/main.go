// Test-only server exposing the `__conformance` screen and `conformance` action (spec §8.1).
//
//	go run ./cmd/conformance-server -addr :4100
//	node ../../../conformance/runner/cli.ts composer http://localhost:4100
package main

import (
	"flag"
	"log"
	"net/http"

	clientcompose "github.com/client-compose/client-compose/composers/go/core"
)

func main() {
	addr := flag.String("addr", ":4100", "listen address")
	flag.Parse()
	c := clientcompose.New(
		[]clientcompose.Screen{clientcompose.ConformanceScreen()},
		clientcompose.WithActions(clientcompose.ConformanceActions()...),
	)
	log.Printf("conformance server on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, c.Handler()))
}
