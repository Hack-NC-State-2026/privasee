type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

type InsightItem = {
  title: string;
  details?: string;
};

type PrivacyInsight = {
  domain: string;
  riskLevel: RiskLevel;
  summary: string;
  likelyDataCollected: InsightItem[];
  keyConcerns: InsightItem[];
  recommendations: string[];
  generatedAt: number;
};

type GetInsightMessage = {
  type: 'GET_PRIVACY_INSIGHT';
  payload?: {
    domain?: string;
    pathname?: string;
  };
};

type OpenPanelMessage = {
  type: 'OPEN_SIDE_PANEL';
};

type RuntimeMessage = OpenPanelMessage | GetInsightMessage | { type?: string };

const createFallbackInsight = (domain: string): PrivacyInsight => ({
  domain,
  riskLevel: 'unknown',
  summary:
    'Policy analysis is in progress. Treat this as a preliminary snapshot.',
  likelyDataCollected: [
    {
      title: 'Account identity',
      details: 'Name, email, and authentication data',
    },
    { title: 'Device and usage', details: 'IP, browser, and activity events' },
  ],
  keyConcerns: [
    {
      title: 'Sharing details may be broad',
      details: 'Review third-party and affiliate sharing clauses.',
    },
    {
      title: 'Retention duration not yet verified',
      details: 'Look for explicit deletion and retention windows.',
    },
  ],
  recommendations: [
    'Use a dedicated email alias for new signups.',
    'Skip optional profile fields where possible.',
    'Review account privacy settings immediately after registration.',
  ],
  generatedAt: Date.now(),
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === 'OPEN_SIDE_PANEL') {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, error: 'Missing tab context.' });
        return undefined;
      }

      if (!chrome.sidePanel?.open) {
        sendResponse({
          ok: false,
          error: 'Side panel API is not available in this browser.',
        });
        return undefined;
      }

      chrome.sidePanel.open({ tabId }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        sendResponse({ ok: true });
      });

      return true;
    }

    if (message.type === 'GET_PRIVACY_INSIGHT') {
      const payload = 'payload' in message ? message.payload : undefined;
      const domain = payload?.domain?.trim() || sender.url || 'unknown-domain';
      sendResponse({
        ok: true,
        data: createFallbackInsight(domain),
      });
      return undefined;
    }

    return undefined;
  }
);
