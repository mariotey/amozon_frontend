"""Fetch and validate live FastAPI data for the storefront.

Each helper makes a synchronous GET request without caching or retrying.
Transport, decoding, and expected-shape failures become BackendAPIError;
views translate that exception into a response the browser can retry.
"""

import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from django.conf import settings


logger = logging.getLogger(__name__)


class BackendAPIError(Exception):
    """Backend failure with an optional upstream HTTP status.

    status_code is None for connection, decoding, and validation failures.
    A preserved 404 lets the product view distinguish a missing item from
    an unavailable service.
    """
    def __init__(self, message, status_code=None):
        """Keep a safe display message and the upstream status, if available."""
        super().__init__(message)
        self.status_code = status_code


def _get_json(path, params=None):
    """GET a backend-relative path and decode its UTF-8 JSON response.

    params is an optional mapping of query parameters. Connection settings
    come from Django settings; failures are logged and wrapped, with HTTP
    status codes retained. Endpoint helpers validate the decoded shape.
    """
    query_string = f"?{urlencode(params)}" if params else ""
    url = f"{settings.BACKEND_API_URL.rstrip('/')}{path}{query_string}"
    request = Request(url, headers={"Accept": "application/json"})

    try:
        with urlopen(request, timeout=settings.BACKEND_API_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        logger.warning("Amozon API returned HTTP %s for %s", exc.code, path)
        raise BackendAPIError("The Amozon API returned an error.", exc.code) from exc
    except (URLError, TimeoutError, OSError) as exc:
        logger.warning("Could not reach Amozon API at %s: %s", path, exc)
        raise BackendAPIError("The Amozon API could not be reached.") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning("Amozon API returned invalid JSON for %s: %s", path, exc)
        raise BackendAPIError("The Amozon API returned an invalid response.") from exc


def _require_dict_list(payload, endpoint):
    """Return a list of dictionaries or raise BackendAPIError.

    endpoint identifies the source in logs; individual fields are validated
    separately where required.
    """
    if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
        logger.warning("Amozon API returned an unexpected list for %s", endpoint)
        raise BackendAPIError("The Amozon API returned an invalid response.")
    return payload


def get_random_users(limit=5):
    """Request sample shoppers, requiring string user_id values for selection."""
    users = _require_dict_list(
        _get_json("/api/v1/randomusers", {"n": limit}),
        "/api/v1/randomusers",
    )
    if any(not isinstance(user.get("user_id"), str) for user in users):
        logger.warning("Amozon API returned a user without a valid user_id")
        raise BackendAPIError("The Amozon API returned invalid shopper data.")
    return users


def get_recommendations(user_id, limit=8):
    """Return a shopper's recommendation object with a usable items list.

    Missing or null items become an empty list. Each returned item must have
    a string parent_asin for product links. Other metadata is preserved.
    User IDs are URL-escaped so embedded slashes stay inside one path segment.
    """
    payload = _get_json(
        f"/api/v1/users/{quote(user_id, safe='')}/recommendations",
        {"n": limit},
    )
    if not isinstance(payload, dict):
        logger.warning("Amozon API returned an unexpected recommendation payload")
        raise BackendAPIError("The Amozon API returned an invalid response.")

    items = payload.get("items")
    if items is None:
        payload["items"] = []
    elif not isinstance(items, list) or any(
        not isinstance(item, dict) or not isinstance(item.get("parent_asin"), str)
        for item in items
    ):
        logger.warning("Amozon API returned invalid recommendation items for %s", user_id)
        raise BackendAPIError("The Amozon API returned invalid recommendations.")
    return payload


def get_popular_items(limit=5):
    """Request popular product dictionaries and cap the result locally at limit."""
    items = _require_dict_list(
        _get_json("/api/v1/popular_items", {"limit": limit}),
        "/api/v1/popular_items",
    )
    return items[:limit]


def get_item(parent_asin):
    """Return a product dictionary for its URL-escaped catalog identifier.

    Backend HTTP errors, including a missing product's 404, are propagated
    as BackendAPIError for the caller to handle.
    """
    payload = _get_json(f"/api/v1/items/{quote(parent_asin, safe='')}")
    if not isinstance(payload, dict):
        logger.warning("Amozon API returned an unexpected item payload for %s", parent_asin)
        raise BackendAPIError("The Amozon API returned an invalid product.")
    return payload


def get_reviews_by_item(parent_asin, page=1, page_size=10):
    """Return a review page with items and integer pagination counts.

    page is one-based. The view handles input normalization and pages beyond
    page_count; this helper validates the envelope, not each review's fields.
    """
    payload = _get_json(
        f"/api/v1/items/{quote(parent_asin, safe='')}/reviews",
        {"page": page, "page_size": page_size},
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        logger.warning("Amozon API returned an unexpected reviews payload for %s", parent_asin)
        raise BackendAPIError("The Amozon API returned invalid product reviews.")
    if not isinstance(payload.get("total_count"), int) or not isinstance(
        payload.get("page_count"), int
    ):
        logger.warning("Amozon API returned invalid review pagination for %s", parent_asin)
        raise BackendAPIError("The Amozon API returned invalid review pagination.")
    return payload
