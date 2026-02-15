"""URL parsing utilities."""

import tldextract


def get_domain(url: str) -> str:
    """
    Return the registered (root) domain from a URL, stripping subdomains.
    Examples:
        https://example.com/path          -> example.com
        https://policies.google.com/terms -> google.com
        https://myactivity.google.com     -> google.com
        https://sub.example.co.uk:443/    -> example.co.uk
    """
    ext = tldextract.extract(url)
    if ext.domain and ext.suffix:
        return f"{ext.domain}.{ext.suffix}"
    return ext.domain or ""
