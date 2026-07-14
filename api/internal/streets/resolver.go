package streets

import (
	"context"
	"errors"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

var (
	ErrStreetNotFound        = errors.New("the selected street could not be identified")
	ErrResolutionUnavailable = errors.New("street geometry service is unavailable")
)

const DefaultCorridorRadiusMeters = 35.0

type Selection struct {
	models.Coordinates
	Name string
}

type Geometry struct {
	Name  string
	Paths [][]models.Coordinates
}

type Resolver interface {
	Resolve(context.Context, Selection) (Geometry, error)
}
