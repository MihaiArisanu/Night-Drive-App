package routing

import "math"

const (
	maximumCurrentRouteOffsetMeters = 750.0
	maximumTargetRouteOffsetMeters  = 3_000.0
)

type routeProjection struct {
	distanceAlongMeters float64
	distanceFromMeters  float64
}

// IsPointAheadOnRoute compares the projections of the driver's live position
// and a stop on the same route. The second result is false when the available
// route is too short or too far away to make a safe decision.
func IsPointAheadOnRoute(
	route []Coordinate,
	current Coordinate,
	target Coordinate,
	toleranceMeters float64,
) (bool, bool) {
	currentProjection, currentOK := projectPointOnRoute(route, current)
	targetProjection, targetOK := projectPointOnRoute(route, target)
	if !currentOK || !targetOK ||
		currentProjection.distanceFromMeters > maximumCurrentRouteOffsetMeters ||
		targetProjection.distanceFromMeters > maximumTargetRouteOffsetMeters {
		return false, false
	}
	return targetProjection.distanceAlongMeters+toleranceMeters >= currentProjection.distanceAlongMeters, true
}

func DistanceMeters(first, second Coordinate) float64 {
	return haversineMeters(first, second)
}

func DecodePolyline(encoded string) ([]Coordinate, error) {
	return decodePolyline(encoded)
}

func projectPointOnRoute(route []Coordinate, point Coordinate) (routeProjection, bool) {
	if len(route) < 2 {
		return routeProjection{}, false
	}

	best := routeProjection{distanceFromMeters: math.Inf(1)}
	distanceBeforeSegment := 0.0
	for index := 0; index < len(route)-1; index++ {
		start := route[index]
		end := route[index+1]
		meanLatitudeRadians := ((start.Latitude + end.Latitude + point.Latitude) / 3) * math.Pi / 180
		longitudeScale := earthRadiusMeters * math.Cos(meanLatitudeRadians) * math.Pi / 180
		latitudeScale := earthRadiusMeters * math.Pi / 180

		segmentX := (end.Longitude - start.Longitude) * longitudeScale
		segmentY := (end.Latitude - start.Latitude) * latitudeScale
		pointX := (point.Longitude - start.Longitude) * longitudeScale
		pointY := (point.Latitude - start.Latitude) * latitudeScale
		segmentLengthSquared := segmentX*segmentX + segmentY*segmentY
		if segmentLengthSquared == 0 {
			continue
		}

		fraction := (pointX*segmentX + pointY*segmentY) / segmentLengthSquared
		fraction = math.Max(0, math.Min(1, fraction))
		projectedX := fraction * segmentX
		projectedY := fraction * segmentY
		distanceFrom := math.Hypot(pointX-projectedX, pointY-projectedY)
		segmentLength := math.Sqrt(segmentLengthSquared)
		if distanceFrom < best.distanceFromMeters {
			best = routeProjection{
				distanceAlongMeters: distanceBeforeSegment + fraction*segmentLength,
				distanceFromMeters:  distanceFrom,
			}
		}
		distanceBeforeSegment += segmentLength
	}
	return best, !math.IsInf(best.distanceFromMeters, 1)
}
