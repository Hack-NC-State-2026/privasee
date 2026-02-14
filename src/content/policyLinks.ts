/**
 * Keywords used to find policy/terms links in the page.
 */
const POLICY_KEYWORDS = [
  'terms',
  'terms and conditions',
  'terms of use',
  'terms of service',
  'policy',
  'privacy policy',
  'cookie policy',
  'cookies policy',
  'legal',
] as const;

export type PolicyLink = { url: string; text: string };

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function linkMatchesKeywords(
  a: HTMLAnchorElement,
  keywords: readonly string[]
): boolean {
  const text = normalizeForMatch(a.innerText || a.textContent || '');
  const href = normalizeForMatch(a.href || '');
  const title = normalizeForMatch(a.title || '');
  const combined = `${text} ${href} ${title}`;

  return keywords.some((kw) => {
    const n = normalizeForMatch(kw);
    return combined.includes(n) || href.includes(n);
  });
}

/**
 * Scans the document for anchor tags whose text or href match policy/terms keywords.
 * Returns deduplicated links (url + link text).
 */
export function findPolicyLinks(doc: Document): PolicyLink[] {
  const keywords = [...POLICY_KEYWORDS];
  const links = doc.querySelectorAll<HTMLAnchorElement>('a[href]');
  const seen = new Set<string>();
  const results: PolicyLink[] = [];

  links.forEach((a) => {
    try {
      const url = a.href?.trim();
      if (!url || seen.has(url)) return;
      if (!linkMatchesKeywords(a, keywords)) return;
      seen.add(url);
      results.push({
        url,
        text: (a.innerText || a.textContent || '').trim().slice(0, 200),
      });
    } catch {
      // skip invalid or inaccessible links
    }
  });

  return results;
}
