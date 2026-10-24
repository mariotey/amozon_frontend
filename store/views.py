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


def home(request):
    context = {
        "users": [],
        "current_user_id": request.GET.get("user_id", ""),
        "popular_items": [],
    }

    try:
        context["users"] = _load_users()
    except BackendAPIError:
        context["api_error"] = "Shopper IDs could not be loaded from the Amozon API."

    if not context["current_user_id"] and context["users"]:
        context["current_user_id"] = context["users"][0]["user_id"]

    try:
        context["popular_items"] = get_popular_items(limit=5)
    except BackendAPIError:
        context["popular_items_error"] = (
            "Popular items could not be loaded from the Amozon API."
        )

    current_user_id = context["current_user_id"]
    if current_user_id:
        try:
            recommendation_response = get_recommendations(
                current_user_id,
                limit=RECOMMENDATION_LIMIT,
            )
            context["recommendations"] = recommendation_response["items"]
            context["recommendation_engine"] = recommendation_response.get("engine_used")
            context["recommendation_reason"] = recommendation_response.get("reason")
            if not context["recommendations"]:
                context["recommendations_empty_reason"] = recommendation_response.get("reason")
        except BackendAPIError:
            context["recommendations_error"] = (
                "Recommendations are temporarily unavailable. Please try again soon."
            )

    return render(request, "home.html", context)


def product(request, item_id):
    current_user_id = request.GET.get("user_id", "")
    context = {
        "item": None,
        "item_reviews": [],
        "users": [],
        "current_user_id": current_user_id,
        "review_page_number": 1,
        "review_total_pages": 1,
        "review_has_previous": False,
        "review_has_next": False,
    }

    try:
        context["users"] = _load_users()
    except BackendAPIError:
        context["api_error"] = "Shopper IDs could not be loaded from the Amozon API."

    if not current_user_id and context["users"]:
        current_user_id = context["users"][0]["user_id"]
        context["current_user_id"] = current_user_id

    try:
        context["item"] = get_item(item_id)
    except BackendAPIError as exc:
        if exc.status_code != 404:
            context["api_error"] = "Product details could not be loaded from the Amozon API."

    try:
        requested_page = max(1, int(request.GET.get("page", "1")))
    except ValueError:
        requested_page = 1
    try:
        reviews_response = get_reviews_by_item(
            item_id,
            page=requested_page,
            page_size=REVIEW_PAGE_SIZE,
        )
        total_pages = max(1, reviews_response["page_count"])
        current_page = min(requested_page, total_pages)
        if current_page != requested_page:
            reviews_response = get_reviews_by_item(
                item_id,
                page=current_page,
                page_size=REVIEW_PAGE_SIZE,
            )
        context.update({
            "item_reviews": reviews_response["items"],
            "review_page_number": current_page,
            "review_total_pages": total_pages,
            "review_has_previous": current_page > 1,
            "review_has_next": current_page < total_pages,
        })
    except BackendAPIError:
        context["api_error"] = "Product reviews could not be loaded from the Amozon API."

    return render(request, "product.html", context)
