export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export type InsightItem = {
  title: string;
  details?: string;
};

export type PrivacyInsight = {
  domain: string;
  riskLevel: RiskLevel;
  summary: string;
  likelyDataCollected: InsightItem[];
  keyConcerns: InsightItem[];
  recommendations: string[];
  retentionSummary: string;
  generatedAt: number;
};

export type OverlayInsightProcessingState = {
  status: 'processing';
  domain: string;
  message: string;
  generatedAt: number;
};

export type OverlayInsightReadyState = {
  status: 'ready';
  domain: string;
  insight: PrivacyInsight;
};

export type OverlayInsightState =
  | OverlayInsightProcessingState
  | OverlayInsightReadyState;

export const OVERLAY_PROCESSING_MESSAGE =
  "We are still processing this site's policies.";

export const createProcessingOverlayState = (
  domain: string,
  message = OVERLAY_PROCESSING_MESSAGE
): OverlayInsightProcessingState => ({
  status: 'processing',
  domain,
  message,
  generatedAt: Date.now(),
});

export const createReadyOverlayState = (
  insight: PrivacyInsight
): OverlayInsightReadyState => ({
  status: 'ready',
  domain: insight.domain,
  insight,
});
