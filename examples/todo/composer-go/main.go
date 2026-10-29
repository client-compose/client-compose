// The todo example's composer, in Go: the screen and actions every todo client uses.
//
//	go run .   # serves on :8080; PORT changes it
//
// The words come from ../strings, the catalog every composer serves.
package main

//go:generate node ../../../codegen/cli.ts ../client-compose.codegen.json

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// newComposer serves the todos screen and its actions, in each client's language.
func newComposer(todos *Todos, catalog cc.Catalog) *cc.Composer {
	return cc.New(cc.Config{
		Screens: []cc.Screen{todosScreen(todos)},
		Actions: todoActions(todos),
		Strings: &cc.StringsConfig{Catalog: catalog, DefaultLocale: "en"},
		Use:     []cc.Plugin{cc.ReportErrors(logFailure)},
	})
}

// logFailure logs what went wrong: an island that failed, or an action.
func logFailure(_ context.Context, f cc.Failure) {
	log.Printf("%s failed: %v", f.Kind, f.Err)
}

func main() {
	catalog, err := cc.LoadCatalog(os.DirFS(filepath.Join("..", "strings")))
	if err != nil {
		log.Fatal(err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("todo composer (Go) on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, newComposer(&Todos{}, catalog)))
}
