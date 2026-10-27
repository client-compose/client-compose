// Test-only server exposing the `__conformance` screen and `conformance` action (spec §8.1).
//
//	go run ./cmd/conformance-server -addr :4100 -strings ../../../conformance/composer/strings
//	node ../../../conformance/runner/cli.ts composer http://localhost:4100
package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	clientcompose "github.com/client-compose/client-compose/composers/go/core"
)

func main() {
	addr := flag.String("addr", ":4100", "listen address")
	strings := flag.String("strings", "", "the conformance strings catalog: conformance/composer/strings")
	flag.Parse()
	cfg := clientcompose.Config{
		Screens: []clientcompose.Screen{clientcompose.ConformanceScreen()},
		Actions: clientcompose.ConformanceActions(),
	}
	if *strings != "" {
		catalog, err := clientcompose.LoadCatalog(os.DirFS(*strings))
		if err != nil {
			log.Fatal(err)
		}
		cfg.Strings = &clientcompose.StringsConfig{Catalog: catalog}
	}
	c := clientcompose.New(cfg)
	log.Printf("conformance server on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, c))
}
