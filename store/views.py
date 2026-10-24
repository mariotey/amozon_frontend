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


USER_LIMIT = 5
RECOMMENDATION_LIMIT = 8
REVIEW_PAGE_SIZE = 10


def _load_users():
    return get_random_users(limit=USER_LIMIT)


@never_cache
@require_GET
def home(request):
    return render(request, "loading.html", {"loading": True, "current_user_id": request.GET.get("user_id", "")})


@never_cache
@require_GET
def product(request, item_id):
    return render(request, "loading.html", {
        "loading": True, "current_user_id": request.GET.get("user_id", ""), "item_id": item_id,
    })


@never_cache
@require_GET
def section(request, name):
    context = {"current_user_id": request.GET.get("user_id", "")}
    try:
        if name == "shoppers":
            context["users"] = _load_users()
            if not context["current_user_id"] and context["users"]:
                context["current_user_id"] = context["users"][0]["user_id"]
            template = "partials/shoppers.html"
        elif name == "popular":
            context["popular_items"] = get_popular_items(limit=5)
            template = "partials/popular.html"
        elif name == "recommendations":
            user_id = context["current_user_id"]
            if not user_id:
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
        return JsonResponse({"error": "Unable to load right now."}, status=503)
    return JsonResponse({
        "html": render_to_string(template, context, request=request),
        "user_id": context["current_user_id"],
    })
