# """Pydantic models for TOS/Privacy Policy risk extraction output."""

# from typing import Optional

# from pydantic import BaseModel, Field


# # -----------------------------
# # Reusable Sub-Models
# # -----------------------------

# class EvidenceBoolean(BaseModel):
#     present: bool = Field(..., description="Whether the clause is present in the document")
#     evidence: str = Field(..., description="Direct quoted language from the document or 'not found'")


# class VagueLanguage(BaseModel):
#     present: bool = Field(..., description="Whether vague language was detected")
#     phrases: list[str] = Field(default_factory=list, description="List of vague phrases detected")


# class LiabilityCap(BaseModel):
#     present: bool
#     amount: Optional[str] = Field(None, description="Exact dollar amount if specified")
#     evidence: str


# class Indemnification(BaseModel):
#     present: bool
#     evidence: str


# class AnonymizedDataUsage(BaseModel):
#     present: bool
#     clearly_defined: bool
#     evidence: str


# class RedFlag(BaseModel):
#     clause: str
#     risk_reason: str


# # -----------------------------
# # Top-Level Sections
# # -----------------------------

# class DocumentMetadata(BaseModel):
#     company_name: str
#     policy_type: list[str]
#     last_updated: Optional[str] = None
#     jurisdiction: Optional[str] = None


# class DataCollection(BaseModel):
#     personal_identifiers: EvidenceBoolean
#     ip_address: EvidenceBoolean
#     device_fingerprinting: EvidenceBoolean
#     user_content_collected: EvidenceBoolean
#     third_party_data_collection: EvidenceBoolean
#     broad_collection_language: VagueLanguage


# class DataUsage(BaseModel):
#     used_for_model_training: EvidenceBoolean
#     used_for_advertising: EvidenceBoolean
#     data_sold: EvidenceBoolean
#     anonymized_data_usage: AnonymizedDataUsage
#     vague_usage_language: VagueLanguage


# class DataRetention(BaseModel):
#     retention_period_specified: bool
#     retention_duration: Optional[str] = None
#     indefinite_retention: bool
#     deletion_rights_available: bool
#     retention_vague_language: VagueLanguage


# class LegalTerms(BaseModel):
#     liability_cap: LiabilityCap
#     indemnification: Indemnification
#     mandatory_arbitration: bool
#     class_action_waiver: bool
#     termination_without_notice: bool
#     perpetual_license_to_company: bool


# # -----------------------------
# # Root Model
# # -----------------------------

# class PolicyRiskExtraction(BaseModel):
#     document_metadata: DocumentMetadata
#     data_collection: DataCollection
#     data_usage: DataUsage
#     data_retention: DataRetention
#     legal_terms: LegalTerms
#     red_flags: list[RedFlag]

from typing import List, Literal, Optional
from pydantic import BaseModel, Field

# ---------------------------
# Data collection allowed values (Literal types for consistent model output)
# ---------------------------

PIIType = Literal[
    "name",
    "email",
    "phone_number",
    "physical_address",
    "date_of_birth",
    "government_id",
    "financial_account",
    "biometric",
    "photo",
    "gender",
    "nationality",
    "race_ethnicity",
    "ip_address",
]

DeviceDataType = Literal[
    "device_id",
    "browser_info",
    "os",
    "screen_resolution",
    "language",
    "timezone",
    "fingerprint",
    "ip_address",
]

LocationType = Literal[
    "precise_gps",
    "coarse_location",
    "wifi_cell",
    "ip_derived",
]

UserContentType = Literal[
    "posts",
    "messages",
    "photos",
    "videos",
    "search_history",
    "purchase_history",
    "contacts",
]

ThirdPartySourceType = Literal[
    "social_media",
    "advertisers",
    "analytics",
    "data_brokers",
    "affiliates",
]

SensitiveCategoryType = Literal[
    "health",
    "biometric",
    "genetic",
    "political",
    "religious",
    "sexual_orientation",
    "union_membership",
    "criminal",
]

ChildrenDataType = Literal[
    "age_under_13",
    "age_13_to_17",
    "parental_consent_required",
]


class PersonalIdentifiersCollected(BaseModel):
    """PII types the policy says are collected. Only use values from PIIType."""
    types: List[PIIType] = Field(default_factory=list, description="PII types collected")
    evidence: str = Field("", description="Quoted evidence from the document")


class DeviceDataCollected(BaseModel):
    """Device/technical data types collected. Only use values from DeviceDataType."""
    types: List[DeviceDataType] = Field(default_factory=list, description="Device data types collected")
    evidence: str = Field("", description="Quoted evidence from the document")


class LocationDataCollected(BaseModel):
    """Location data types collected. Only use values from LocationType."""
    types: List[LocationType] = Field(default_factory=list, description="Location data types collected")
    evidence: str = Field("", description="Quoted evidence from the document")


class UserContentCollected(BaseModel):
    """User-generated content types collected. Only use values from UserContentType."""
    types: List[UserContentType] = Field(default_factory=list, description="User content types collected")
    evidence: str = Field("", description="Quoted evidence from the document")


class ThirdPartyDataCollected(BaseModel):
    """Third-party source types from which data is obtained. Only use values from ThirdPartySourceType."""
    types: List[ThirdPartySourceType] = Field(default_factory=list, description="Third-party source types")
    evidence: str = Field("", description="Quoted evidence from the document")


class SensitiveDataCollected(BaseModel):
    """Sensitive/special category data. Only use values from SensitiveCategoryType."""
    types: List[SensitiveCategoryType] = Field(default_factory=list, description="Sensitive categories collected")
    evidence: str = Field("", description="Quoted evidence from the document")


class ChildrenDataCollected(BaseModel):
    """Children-related data or provisions. Only use values from ChildrenDataType."""
    types: List[ChildrenDataType] = Field(default_factory=list, description="Children data types or provisions")
    evidence: str = Field("", description="Quoted evidence from the document")


class Signal(BaseModel):
    """A single extracted signal: found/not_found/unknown + evidence quote."""
    status: str = Field(..., description="One of: true, false, not_found, unknown")
    evidence: str = Field("", description="Direct quoted language from the document, or empty")


class RedFlag(BaseModel):
    clause: str = Field(..., description="The problematic clause text")
    severity: str = Field(..., description="One of: low, medium, high")
    explanation: str = Field(..., description="Why this is a red flag")


# ---------------------------
# Metadata
# ---------------------------

class CrawlMetadata(BaseModel):
    domain: str
    site_name: Optional[str] = None
    policy_url: Optional[str] = None
    tos_url: Optional[str] = None
    policy_last_updated: Optional[str] = None


# ---------------------------
# Privacy Signals
# ---------------------------

class DataCollectionSection(BaseModel):
    """Data collection signals. Use only the allowed Literal values in each types array."""
    personal_identifiers: PersonalIdentifiersCollected
    ip_address: Signal
    precise_location: LocationDataCollected
    device_fingerprinting: DeviceDataCollected
    user_content: UserContentCollected
    third_party_data: ThirdPartyDataCollected
    sensitive_data: SensitiveDataCollected
    children_data: ChildrenDataCollected


class DataUsageSection(BaseModel):
    model_training: Signal
    advertising: Signal
    data_sale: Signal
    cross_company_sharing: Signal
    anonymization_claimed: Signal


class UserRightsSection(BaseModel):
    access: Signal
    correction: Signal
    deletion: Signal
    portability: Signal
    opt_out_ads: Signal
    opt_out_training: Signal


class RetentionSection(BaseModel):
    retention_duration: str = Field(..., description="Normalized: indefinite, P2Y, case_by_case, unknown, etc.")
    deletion_rights: Signal
    vague_retention_language: Signal


class LegalTermsSection(BaseModel):
    liability_cap: Signal
    indemnification: Signal
    mandatory_arbitration: Signal
    class_action_waiver: Signal
    unilateral_modification: Signal
    termination_without_notice: Signal
    perpetual_license: Signal


# ---------------------------
# Dashboard Scoring
# ---------------------------

class ScoreSection(BaseModel):
    privacy_score: int = Field(..., description="Overall privacy score 0-100")
    posture: str = Field(..., description="One of: low_risk, moderate_risk, high_risk, unknown")
    data_minimization: int = Field(..., description="Score 0-100")
    retention_transparency: int = Field(..., description="Score 0-100")
    third_party_exposure: int = Field(..., description="Score 0-100")
    user_control: int = Field(..., description="Score 0-100")


# ---------------------------
# Root Model
# ---------------------------

class PolicyAnalysis(BaseModel):
    metadata: CrawlMetadata
    data_collection: DataCollectionSection
    data_usage: DataUsageSection
    user_rights: UserRightsSection
    retention: RetentionSection
    legal_terms: LegalTermsSection
    red_flags: List[RedFlag]
    scores: ScoreSection