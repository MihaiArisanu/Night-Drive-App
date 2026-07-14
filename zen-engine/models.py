from typing import List, Tuple

from pydantic import BaseModel, Field

class LocationRecord(BaseModel):
    latitude: float
    longitude: float

class HistoryRecord(LocationRecord):
    pass

class ExclusionZone(LocationRecord):
    radius_meters: float = 200.0
    coverage_type: str = "area"
    paths: List[List[Tuple[float, float]]] = Field(default_factory=list)
