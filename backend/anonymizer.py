import logging

from presidio_analyzer import AnalyzerEngine, RecognizerResult, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine

from backend.models import (
    DetectedEntity,
    AnonymizedEntity,
    AnonymizeResponse,
    AnalyzeResponse,
    EntityOverride,
)

logger = logging.getLogger("clearllm")


def _build_french_recognizers() -> list[PatternRecognizer]:
    """Custom recognizers for French-specific PII patterns."""
    recognizers = []

    fr_phone = PatternRecognizer(
        supported_entity="PHONE_NUMBER",
        supported_language="fr",
        name="FrenchPhoneRecognizer",
        patterns=[
            Pattern(
                name="fr_phone_spaces",
                regex=r"\b0[1-79]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b",
                score=0.7,
            ),
            Pattern(
                name="fr_phone_dots",
                regex=r"\b0[1-79]\.\d{2}\.\d{2}\.\d{2}\.\d{2}\b",
                score=0.7,
            ),
            Pattern(
                name="fr_phone_dashes",
                regex=r"\b0[1-79]-\d{2}-\d{2}-\d{2}-\d{2}\b",
                score=0.7,
            ),
            Pattern(
                name="fr_phone_intl",
                regex=r"\b\+33\s?[1-79]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b",
                score=0.85,
            ),
        ],
    )
    recognizers.append(fr_phone)

    fr_ssn = PatternRecognizer(
        supported_entity="FR_SSN",
        supported_language="fr",
        name="FrenchSSNRecognizer",
        patterns=[
            Pattern(
                name="fr_nir",
                regex=r"\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b",
                score=0.85,
            ),
        ],
    )
    recognizers.append(fr_ssn)

    fr_iban = PatternRecognizer(
        supported_entity="IBAN_CODE",
        supported_language="fr",
        name="FrenchIBANRecognizer",
        patterns=[
            Pattern(
                name="fr_iban",
                regex=r"\bFR\s?\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{3}\b",
                score=0.9,
            ),
        ],
    )
    recognizers.append(fr_iban)

    return recognizers


class PresidioService:
    """Presidio-based PII detection and anonymization service.

    Stateless: no PII is stored server-side. The mapping is returned
    to the client which handles encryption and storage.
    """

    def __init__(self):
        logger.info("Initializing Presidio engines...")

        configuration = {
            "nlp_engine_name": "spacy",
            "models": [
                {"lang_code": "en", "model_name": "en_core_web_md"},
                {"lang_code": "fr", "model_name": "fr_core_news_md"},
            ],
        }

        provider = NlpEngineProvider(nlp_configuration=configuration)
        nlp_engine = provider.create_engine()

        self.analyzer = AnalyzerEngine(
            nlp_engine=nlp_engine,
            supported_languages=["en", "fr"],
        )

        for recognizer in _build_french_recognizers():
            self.analyzer.registry.add_recognizer(recognizer)

        self.anonymizer_engine = AnonymizerEngine()
        logger.info("Presidio engines ready.")

    def analyze(self, text: str, language: str = "fr") -> AnalyzeResponse:
        results = self.analyzer.analyze(
            text=text,
            language=language,
            score_threshold=0.4,
        )
        results = self._remove_overlaps(results)

        entities = [
            DetectedEntity(
                entity_type=r.entity_type,
                text=text[r.start : r.end],
                start=r.start,
                end=r.end,
                score=round(r.score, 2),
            )
            for r in sorted(results, key=lambda r: r.start)
        ]
        return AnalyzeResponse(entities=entities)

    def anonymize(
        self,
        text: str,
        language: str = "fr",
        custom_entities: list[EntityOverride] | None = None,
    ) -> AnonymizeResponse:
        if custom_entities is not None:
            results = [
                RecognizerResult(
                    entity_type=e.entity_type,
                    start=e.start,
                    end=e.end,
                    score=e.score,
                )
                for e in custom_entities
            ]
        else:
            results = self.analyzer.analyze(
                text=text,
                language=language,
                score_threshold=0.4,
            )

        results = self._remove_overlaps(results)

        # First pass: assign placeholders in text order
        sorted_asc = sorted(results, key=lambda r: r.start)
        type_counters: dict[str, int] = {}
        reverse_mapping: dict[str, str] = {}
        mapping: dict[str, str] = {}
        entities: list[AnonymizedEntity] = []

        for r in sorted_asc:
            original = text[r.start : r.end]
            if original not in reverse_mapping:
                etype = r.entity_type
                type_counters[etype] = type_counters.get(etype, 0) + 1
                placeholder = f"<{etype}_{type_counters[etype]}>"
                reverse_mapping[original] = placeholder
                mapping[placeholder] = original

        # Second pass: replace from end to preserve positions
        anonymized_text = text
        for r in sorted(results, key=lambda r: r.start, reverse=True):
            original = text[r.start : r.end]
            placeholder = reverse_mapping[original]
            anonymized_text = (
                anonymized_text[: r.start] + placeholder + anonymized_text[r.end :]
            )
            entities.append(
                AnonymizedEntity(
                    entity_type=r.entity_type,
                    original=original,
                    anonymized=placeholder,
                    score=round(r.score, 2),
                )
            )

        # Deduplicate entities list
        seen = set()
        unique_entities = []
        for e in entities:
            key = (e.entity_type, e.original, e.anonymized)
            if key not in seen:
                seen.add(key)
                unique_entities.append(e)

        return AnonymizeResponse(
            anonymized_text=anonymized_text,
            entities=unique_entities,
            mapping=mapping,
        )

    @staticmethod
    def _remove_overlaps(
        results: list[RecognizerResult],
    ) -> list[RecognizerResult]:
        if not results:
            return []
        sorted_results = sorted(results, key=lambda r: (r.start, -r.score))
        filtered = [sorted_results[0]]
        for current in sorted_results[1:]:
            prev = filtered[-1]
            if current.start >= prev.end:
                filtered.append(current)
            elif current.score > prev.score:
                filtered[-1] = current
        return filtered
