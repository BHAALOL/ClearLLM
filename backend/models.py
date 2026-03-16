from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50000)
    language: str = Field(default="fr", pattern="^(fr|en)$")


class DetectedEntity(BaseModel):
    entity_type: str
    text: str
    start: int
    end: int
    score: float


class AnalyzeResponse(BaseModel):
    entities: list[DetectedEntity]


class AnonymizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50000)
    language: str = Field(default="fr", pattern="^(fr|en)$")


class AnonymizedEntity(BaseModel):
    entity_type: str
    original: str
    anonymized: str
    score: float


class AnonymizeResponse(BaseModel):
    session_id: str
    anonymized_text: str
    entities: list[AnonymizedEntity]


class DeanonymizeRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1, max_length=200000)


class DeanonymizeResponse(BaseModel):
    deanonymized_text: str
