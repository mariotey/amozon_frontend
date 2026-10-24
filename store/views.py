"""Serve immediate page shells and live HTML sections for loading.js.

Page views do not contact FastAPI. The browser fetches each section through
Django and owns the retry deadline; these views perform one load per request.
All public views accept GET only and disable response caching.
"""

from django.http import JsonResponse, Http404
from django.template.loader import render_to_string
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from django.shortcuts import render

from .api_client import (
    BackendAPIError,
    get_item,
    get_popular_items,
    get_random_users,
    get_recommendations,
    get_reviews_by_item,
)


# Presentation limits for sample shoppers, recommendations, and review pages.
USER_LIMIT = 5
RECOMMENDATION_LIMIT = 8
REVIEW_PAGE_SIZE = 10


def _load_users():
    """Fetch the sample shopper options shared by both page types."""
    return get_random_users(limit=USER_LIMIT)


@never_cache
@require_GET
def home(request):
    """Render the home shell, preserving an optional user_id query parameter."""
    return render(request, "loading.html", {"loading": True, "current_user_id": request.GET.get("user_id", "")})


@never_cache
@require_GET
def product(request, item_id):
    """Render a product shell; JavaScript loads details and reviews by item_id."""
    return render(request, "loading.html", {
        "loading": True, "current_user_id": request.GET.get("user_id", ""), "item_id": item_id,
    })


@never_cache
@require_GET
def section(request, name):
    """Load one named section and return {html, user_id} as JSON.

    Supported names are shoppers, popular, recommendations, details, and
    reviews. Query parameters supply user_id, item_id, and the review page.
    HTML is rendered through Django templates, retaining normal escaping.
    Empty results are successful responses; backend failures return 503 so
    loading.js can retry. Unknown section names return 404.
    """
    context = {"current_user_id": request.GET.get("user_id", "")}
    try:
        if name == "shoppers":
            context["users"] = _load_users()
            if not context["current_user_id"] and context["users"]:
                context["current_user_id"] = context["users"][0]["user_id"]
            # A new random sample may omit the shopper preserved in a product link.
            context["selected_user_missing"] = bool(context["current_user_id"]) and all(
                user["user_id"] != context["current_user_id"] for user in context["users"]
            )
            template = "partials/shoppers.html"
        elif name == "popular":
            context["popular_items"] = get_popular_items(limit=5)
            template = "partials/popular.html"
        elif name == "recommendations":
            user_id = context["current_user_id"]
            # Direct section requests may arrive without a selected shopper.
            if not user_id and "user_id" not in request.GET:
                users = _load_users()
                user_id = users[0]["user_id"] if users else ""
                context["current_user_id"] = user_id
            payload = get_recommendations(user_id, limit=RECOMMENDATION_LIMIT) if user_id else {"items": []}
            context.update({
                "recommendations": payload["items"],
                "recommendation_engine": payload.get("engine_used"),
                "recommendations_empty_reason": payload.get("reason") or "No recommendations available for this shopper.",
            })
            template = "partials/recommendations.html"
        elif name == "details":
            try:
                context["item"] = get_item(request.GET.get("item_id", ""))
            except BackendAPIError as exc:
                # Missing products render a final empty state rather than retrying.
                if exc.status_code != 404:
                    raise
            template = "partials/details.html"
        elif name == "reviews":
            try:
                page = max(1, int(request.GET.get("page", "1")))
            except ValueError:
                page = 1
            item_id = request.GET.get("item_id", "")
            payload = get_reviews_by_item(item_id, page=page, page_size=REVIEW_PAGE_SIZE)
            total_pages = max(1, payload["page_count"])
            # Re-fetch the last valid page when a URL requests a page past the end.
            if page > total_pages:
                page = total_pages
                payload = get_reviews_by_item(item_id, page=page, page_size=REVIEW_PAGE_SIZE)
            context.update({
                "item_reviews": payload["items"], "review_page_number": page,
                "review_total_pages": total_pages, "review_has_previous": page > 1,
                "review_has_next": page < total_pages,
            })
            template = "partials/reviews.html"
        else:
            raise Http404
    except BackendAPIError:
        # Retry timing and the eventual retry button belong to the browser.
        return JsonResponse({"error": "Unable to load right now."}, status=503)
    return JsonResponse({
        "html": render_to_string(template, context, request=request),
        "user_id": context["current_user_id"],
    })
