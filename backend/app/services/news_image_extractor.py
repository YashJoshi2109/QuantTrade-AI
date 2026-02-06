"""
News Image Extractor - Extract OpenGraph images from article URLs

Implementation Notes:
- Fetches article HTML and extracts og:image meta tag
- Falls back to first <img> in article body
- Caches results in news_cache table
- Uses async HTTP for performance

Usage:
    from app.services.news_image_extractor import extract_og_image
    
    image_url = await extract_og_image("https://example.com/article")
"""
import re
from typing import Optional
from urllib.parse import urljoin, urlparse
import httpx
from bs4 import BeautifulSoup


async def extract_og_image(url: str, timeout: float = 5.0) -> Optional[str]:
    """
    Extract OpenGraph image from article URL.
    
    Priority:
    1. og:image meta tag
    2. twitter:image meta tag
    3. First large image in article body
    
    Args:
        url: Article URL to fetch
        timeout: HTTP timeout in seconds
    
    Returns:
        Image URL string or None if not found
    """
    if not url:
        return None
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            
            if response.status_code != 200:
                return None
            
            html = response.text
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None
    
    return extract_image_from_html(html, url)


def extract_image_from_html(html: str, base_url: str) -> Optional[str]:
    """
    Extract image URL from HTML content.
    
    Args:
        html: HTML content
        base_url: Base URL for resolving relative paths
    
    Returns:
        Absolute image URL or None
    """
    try:
        soup = BeautifulSoup(html, 'html.parser')
        
        # Priority 1: og:image
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            return _resolve_url(og_image['content'], base_url)
        
        # Priority 2: twitter:image
        twitter_image = soup.find('meta', attrs={'name': 'twitter:image'})
        if twitter_image and twitter_image.get('content'):
            return _resolve_url(twitter_image['content'], base_url)
        
        # Priority 3: twitter:image:src
        twitter_image_src = soup.find('meta', attrs={'name': 'twitter:image:src'})
        if twitter_image_src and twitter_image_src.get('content'):
            return _resolve_url(twitter_image_src['content'], base_url)
        
        # Priority 4: First large image in article
        article = soup.find('article') or soup.find('main') or soup.find('body')
        if article:
            images = article.find_all('img')
            for img in images:
                src = img.get('src') or img.get('data-src')
                if src and _is_valid_article_image(src, img):
                    return _resolve_url(src, base_url)
        
        # Priority 5: Any og:image in head (some sites use this differently)
        head = soup.find('head')
        if head:
            for meta in head.find_all('meta'):
                if meta.get('property') in ['og:image', 'og:image:url']:
                    content = meta.get('content')
                    if content:
                        return _resolve_url(content, base_url)
        
        return None
        
    except Exception as e:
        print(f"Error parsing HTML: {e}")
        return None


def _resolve_url(image_url: str, base_url: str) -> str:
    """Resolve relative URL to absolute"""
    if not image_url:
        return ""
    
    # Already absolute
    if image_url.startswith(('http://', 'https://')):
        return image_url
    
    # Protocol-relative
    if image_url.startswith('//'):
        return 'https:' + image_url
    
    # Relative URL
    return urljoin(base_url, image_url)


def _is_valid_article_image(src: str, img_tag) -> bool:
    """
    Check if image is likely a valid article image (not icon/logo).
    
    Filters out:
    - Small images (icons, logos)
    - Tracking pixels
    - Social media icons
    - Ads
    """
    if not src:
        return False
    
    src_lower = src.lower()
    
    # Skip common non-article images
    skip_patterns = [
        'logo', 'icon', 'avatar', 'sprite', 'button',
        'banner', 'ad-', 'ads/', 'tracking', 'pixel',
        'facebook', 'twitter', 'linkedin', 'instagram',
        'share', 'social', 'badge', 'favicon',
        '1x1', 'spacer', 'placeholder', 'loading',
        '.gif', 'data:image',
    ]
    
    for pattern in skip_patterns:
        if pattern in src_lower:
            return False
    
    # Check dimensions if available
    width = img_tag.get('width', '')
    height = img_tag.get('height', '')
    
    try:
        if width and int(width) < 200:
            return False
        if height and int(height) < 100:
            return False
    except (ValueError, TypeError):
        pass
    
    # Check CSS class for hints
    css_class = ' '.join(img_tag.get('class', [])).lower()
    if any(p in css_class for p in ['logo', 'icon', 'avatar', 'social']):
        return False
    
    return True


async def batch_extract_images(urls: list[str], timeout: float = 3.0) -> dict[str, Optional[str]]:
    """
    Extract images from multiple URLs concurrently.
    
    Args:
        urls: List of article URLs
        timeout: Timeout per request
    
    Returns:
        Dict mapping URL to image URL (or None)
    """
    import asyncio
    
    async def extract_one(url: str) -> tuple[str, Optional[str]]:
        try:
            image = await extract_og_image(url, timeout)
            return (url, image)
        except Exception:
            return (url, None)
    
    tasks = [extract_one(url) for url in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    return {
        url: img for url, img in results 
        if isinstance((url, img), tuple)
    }
