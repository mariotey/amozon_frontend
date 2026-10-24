import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from django.conf import settings


logger = logging.getLogger(__name__)


class BackendAPIError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


def _get_json(path, params=None):
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
    if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
        logger.warning("Amozon API returned an unexpected list for %s", endpoint)
        raise BackendAPIError("The Amozon API returned an invalid response.")
    return payload


def get_random_users(limit=5):
    users = _require_dict_list(
        _get_json("/api/v1/randomusers", {"n": limit}),
        "/api/v1/randomusers",
    )
    if any(not isinstance(user.get("user_id"), str) for user in users):
        logger.warning("Amozon API returned a user without a valid user_id")
        raise BackendAPIError("The Amozon API returned invalid shopper data.")
    return users


def get_recommendations(user_id, limit=8):
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
    items = _require_dict_list(
        _get_json("/api/v1/popular_items", {"limit": limit}),
        "/api/v1/popular_items",
    )
    return items[:limit]


def get_item(parent_asin):
    payload = _get_json(f"/api/v1/items/{quote(parent_asin, safe='')}")
    if not isinstance(payload, dict):
        logger.warning("Amozon API returned an unexpected item payload for %s", parent_asin)
        raise BackendAPIError("The Amozon API returned an invalid product.")
    return payload


def get_reviews_by_item(parent_asin, page=1, page_size=10):
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
