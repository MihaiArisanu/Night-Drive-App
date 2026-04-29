from pydantic import BaseModel

class LocationRecord(BaseModel):
    latitude: float
    longitude: float

class HistoryRecord(LocationRecord):
    pass

class ExclusionZone(LocationRecord):
    pass
