chrome.runtime.onMessage.addListener(
  (
    message: { type?: string },
    sender,
    sendResponse: (response: { ok: boolean; error?: string }) => void
  ) => {
    if (message.type !== 'OPEN_SIDE_PANEL') return undefined;

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
);
