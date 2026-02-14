const BACKEND_ORIGIN = 'http://localhost:8000';
const TOS_PROCESSOR_PROCESS_URL = `${BACKEND_ORIGIN}/api/tos_processor/process`;

type PolicyLink = { url: string; text: string };

type TabAnalysis = {
  links: PolicyLink[];
  tosResult: Record<string, unknown> | null;
  tosError: string | null;
  tosLoading: boolean;
};

const tabAnalysisCache = new Map<number, TabAnalysis>();

function updateCache(tabId: number, updates: Partial<TabAnalysis>): void {
  const current = tabAnalysisCache.get(tabId);
  if (current) {
    tabAnalysisCache.set(tabId, { ...current, ...updates });
  }
}

async function processTos(tabId: number, links: PolicyLink[]): Promise<void> {
  const urls = links.map((l) => l.url);
  const getUrl = `${TOS_PROCESSOR_PROCESS_URL}?${urls.map((u) => `url=${encodeURIComponent(u)}`).join('&')}`;

  try {
    const res = await fetch(getUrl);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = (body as { detail?: unknown }).detail ?? res.statusText;
      updateCache(tabId, {
        tosError: typeof detail === 'string' ? detail : JSON.stringify(detail),
        tosResult: null,
        tosLoading: false,
      });
    } else {
      const data = (await res.json()) as Record<string, unknown>;
      updateCache(tabId, {
        tosResult: data,
        tosError: null,
        tosLoading: false,
      });
    }
  } catch (err) {
    updateCache(tabId, {
      tosError:
        err instanceof Error ? err.message : 'Failed to run policy analysis',
      tosResult: null,
      tosLoading: false,
    });
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: { type?: string; links?: PolicyLink[]; tabId?: number },
    sender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === 'POLICY_LINKS_FOUND') {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return undefined;

      const links = message.links ?? [];

      tabAnalysisCache.set(tabId, {
        links,
        tosResult: null,
        tosError: null,
        tosLoading: links.length > 0,
      });

      if (links.length > 0) {
        processTos(tabId, links);
      }

      return undefined;
    }

    if (message.type === 'GET_CACHED_ANALYSIS') {
      const { tabId } = message;
      const empty: TabAnalysis = {
        links: [],
        tosResult: null,
        tosError: null,
        tosLoading: false,
      };
      if (typeof tabId !== 'number') {
        sendResponse(empty);
        return true;
      }
      const cached = tabAnalysisCache.get(tabId);
      sendResponse(cached ?? empty);
      return true;
    }

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

    return undefined;
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabAnalysisCache.delete(tabId);
});
