from django.shortcuts import render
from django.core.paginator import Paginator
from .data.data_loader import (
    get_item,
    get_reviews_by_item,
    get_reviews_by_user,
    get_sliced_users,
    search_items,
)
from .models import Item
from .recommendations import RecommendationServiceError, get_recommendations

START_IDX = 5
END_IDX = 10

def home(request):
    users = get_sliced_users(start=START_IDX, end=END_IDX)

    default_user_id = users[0]["user_id"] if users else ""
    current_user_id = request.GET.get("user_id") or default_user_id
    query = request.GET.get("q", "").strip()

    current_user_reviews = get_reviews_by_user(current_user_id) if current_user_id else []

    paginator = Paginator(current_user_reviews, 5)  # 5 reviews per page
    page_number = request.GET.get("page", 1)
    page_obj = paginator.get_page(page_number)

    context = {
        'users': users,
        'current_user_id': current_user_id,
        'current_recent_reviews': page_obj,
        'page_obj': page_obj,
        'search_query': query,
    }

    if query:
        context["search_results"] = search_items(query)
    elif current_user_id:
        try:
            recommendation_response = get_recommendations(current_user_id)
            item_ids = [entry["parent_asin"] for entry in recommendation_response["items"]]
            catalog_items = {
                item.parent_asin: item
                for item in Item.objects.filter(parent_asin__in=item_ids)
            }
            context["recommendations"] = [
                {
                    **entry,
                    **(
                        {
                            "item_title": catalog_items[entry["parent_asin"]].item_title,
                            "main_category": catalog_items[entry["parent_asin"]].main_category,
                            "price": catalog_items[entry["parent_asin"]].price,
                            "is_free": catalog_items[entry["parent_asin"]].is_free,
                        }
                        if entry["parent_asin"] in catalog_items
                        else {}
                    ),
                }
                for entry in recommendation_response["items"]
            ]
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

    paginator = Paginator(item_reviews, 5)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, 'product.html', {
        'item': item,
        'item_reviews': page_obj,
        'users': users,
        'current_user_id': current_user_id,
        'page_obj': page_obj,
    })