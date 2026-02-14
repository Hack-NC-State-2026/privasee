"""URL parsing utilities."""

from urllib.parse import urlparse


def get_domain(url: str) -> str:
    """
    Return the domain (hostname) from a URL, without port or path.
    Examples:
        https://example.com/path -> example.com
        https://sub.example.com:443/ -> sub.example.com
    """
    parsed = urlparse(url)
    netloc = parsed.netloc or parsed.path.split("/")[0]
    return netloc.split(":")[0].strip() or ""
