import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from django.conf import settings


logger = logging.getLogger(__name__)


class RecommendationServiceError(Exception):
    pass


def get_recommendations(user_id, limit=8):
    base_url = settings.RECOMMENDATION_API_URL.rstrip("/")
    url = f"{base_url}/api/v1/users/{quote(str(user_id), safe='')}/recommendations?n={limit}"
    request = Request(url, headers={"Accept": "application/json"})

    try:
        with urlopen(request, timeout=settings.RECOMMENDATION_API_TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        logger.warning("Recommendation API returned HTTP %s for user %s", exc.code, user_id)
        raise RecommendationServiceError("The recommendation service returned an error.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        logger.warning("Could not reach recommendation API for user %s: %s", user_id, exc)
        raise RecommendationServiceError("The recommendation service could not be reached.") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning("Recommendation API returned invalid JSON for user %s: %s", user_id, exc)
        raise RecommendationServiceError("The recommendation service returned an invalid response.") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        logger.warning("Recommendation API response has an unexpected shape for user %s", user_id)
        raise RecommendationServiceError("The recommendation service returned an invalid response.")

    items = payload["items"]
    if any(not isinstance(item, dict) or not isinstance(item.get("parent_asin"), str) for item in items):
        logger.warning("Recommendation API response contains invalid items for user %s", user_id)
        raise RecommendationServiceError("The recommendation service returned invalid products.")

    return payload
