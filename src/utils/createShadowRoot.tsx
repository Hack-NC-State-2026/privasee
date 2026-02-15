import { createRoot } from 'react-dom/client';

/**
 * Creates a shadow root with the specified styles and returns a React root in it.
 * @param {string} styles - CSS styles to be applied to the shadow root.
 * @returns {ReactRoot} - React root rendered inside the shadow root.
 */
export default function createShadowRoot(styles: string) {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.overflow = 'visible';
  host.style.zIndex = '2147483647';
  const shadow = host.attachShadow({ mode: 'open' });

  // Create an internal mount node to avoid Xray wrapper issues in Firefox
  const mount = document.createElement('div');
  shadow.appendChild(mount);

  // Apply styles: prefer constructable stylesheets, fallback safely
  try {
    const supportsConstructable =
      'adoptedStyleSheets' in shadow &&
      'replaceSync' in
        (CSSStyleSheet.prototype as unknown as { replaceSync?: unknown });
    if (supportsConstructable) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      shadow.adoptedStyleSheets = [sheet];
    } else {
      const styleEl = document.createElement('style');
      styleEl.textContent = styles;
      shadow.appendChild(styleEl);
    }
  } catch {
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    shadow.appendChild(styleEl);
  }

  document.body.appendChild(host);

  // Keep host as the last child so extension UI stays above late-mounted modals.
  const observer = new MutationObserver(() => {
    if (!document.body || !host.isConnected) return;
    if (document.body.lastElementChild !== host) {
      document.body.appendChild(host);
    }
  });
  observer.observe(document.body, { childList: true });

  return createRoot(mount);
}
