package clientcompose

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

// ComposeIsland resolves one island of a screen in-process (spec §4.5): its next page, for a
// request with a cursor, or from its first page without one. The screen's requirements, layout
// and conditions run as they would for the screen, so the island answers 401, 403 or 404 as it
// would. The context should already carry what Config.Context would add.
func (c *Composer) ComposeIsland(ctx context.Context, req IslandRequest) Result {
	if req.Protocol == nil || *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", fmt.Sprintf("composer speaks protocol %d", ProtocolVersion))
	}
	screen, ok := c.screens[req.Screen]
	if !ok {
		return fail(http.StatusNotFound, "unknown_screen", req.Screen)
	}
	if req.Client == nil {
		req.Client = &ClientContext{}
	}

	ctx, endRequest := withRequestScope(ctx)
	defer endRequest()

	r := Request{Screen: screen.ID, Params: req.Params, Client: *req.Client, Cursor: req.Cursor}
	if r.Params == nil {
		r.Params = map[string]string{}
	}
	placements, err := c.placements(ctx, screen, r)
	if err != nil {
		if res, ok := protocolError(err); ok {
			return res
		}
		c.report(ctx, Failure{Kind: LayoutFailed, Screen: screen.ID, Err: err})
		return fail(http.StatusInternalServerError, "layout_failed", "")
	}
	var placement *Placement
	for i := range placements {
		if placements[i].Key == req.Key {
			placement = &placements[i]
			break
		}
	}
	if placement == nil {
		return fail(http.StatusNotFound, "unknown_island", req.Key)
	}
	var island *Island
	for i := range placement.Versions {
		if placement.Versions[i].Version == req.Version {
			island = &placement.Versions[i]
			break
		}
	}
	if island == nil {
		return fail(http.StatusBadRequest, "unsupported_island_version", fmt.Sprintf("%s v%d", req.Key, req.Version))
	}
	if req.Cursor != "" && !island.paged {
		return fail(http.StatusBadRequest, "invalid_cursor", req.Key+" has no pages")
	}

	// A page's strings are the ones the client has from the screen (spec §4.5).
	var words *LocaleStrings
	if req.Cursor == "" {
		words = c.words(req.Client.Locale)
	}
	entry, err := c.resolveEntry(ctx, *placement, *island, r, words)
	if errors.Is(err, ErrInvalidCursor) {
		return fail(http.StatusBadRequest, "invalid_cursor", "")
	}
	res := IslandResponse{Protocol: ProtocolVersion, Screen: screen.ID, Island: entry}
	if words != nil {
		res.Locale, res.Plurals = words.Locale, &words.Plurals
	}
	return Result{http.StatusOK, res}
}
