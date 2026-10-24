from django.shortcuts import render
from django.core.paginator import Paginator
from .data.data_loader import (
    get_item,
    get_popular_items,
    get_reviews_by_item,
    get_sliced_users,
)
from .models import Item
from .recommendations import RecommendationServiceError, get_recommendations

START_IDX = 5
END_IDX = 10

def home(request):
    users = get_sliced_users(start=START_IDX, end=END_IDX)

    default_user_id = users[0]["user_id"] if users else ""
    current_user_id = request.GET.get("user_id") or default_user_id

    context = {
        'users': users,
        'current_user_id': current_user_id,
        'popular_items': get_popular_items(),
    }

    if current_user_id:
        try:
            recommendation_response = get_recommendations(current_user_id)
            item_ids = [entry["parent_asin"] for entry in recommendation_response["items"]]
            catalog_items = {
                item.parent_asin: item
                for item in Item.objects.filter(parent_asin__in=item_ids)
            }
            recommendation_cards = []
            for entry in recommendation_response["items"]:
                card = entry.copy()
                catalog_item = catalog_items.get(entry["parent_asin"])
                if catalog_item:
                    for field in (
                        "item_title",
                        "main_category",
                        "price",
                        "is_free",
                        "avg_rating",
                        "num_reviews",
                        "num_verified_reviews",
                        "quality_score",
                    ):
                        value = getattr(catalog_item, field)
                        if value is not None:
                            card[field] = value
                recommendation_cards.append(card)
            context["recommendations"] = recommendation_cards
            context["recommendation_engine"] = recommendation_response.get("engine_used")
            context["recommendation_reason"] = recommendation_response.get("reason")
        except RecommendationServiceError:
            context["recommendations_error"] = (
                "Recommendations are temporarily unavailable. Please try again soon."
            )

    return render(request, 'home.html', context)

def product(request, item_id):
    users = get_sliced_users(start=START_IDX, end=END_IDX)

    default_user_id = users[0]["user_id"] if users else ""
    current_user_id = request.GET.get("user_id") or default_user_id

    item = get_item(item_id)
    item_reviews = get_reviews_by_item(item_id)
    paginator = Paginator(item_reviews, 10)
    page_obj = paginator.get_page(request.GET.get("page", 1))

    return render(request, 'product.html', {
        'item': item,
        'item_reviews': page_obj,
        'users': users,
        'current_user_id': current_user_id,
        'page_obj': page_obj,
    })