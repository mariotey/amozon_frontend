from django.db.models import Q

from ..models import User, Item, Review

def get_users():
    return list(User.objects.all().values())

def get_sliced_users(start=0, end=10):
    return list(User.objects.all()[start:end].values())

def get_items():
    return list(Item.objects.all().values())

def get_reviews():
    return list(Review.objects.all().values())

def get_reviews_by_user(user_id):
    return list(Review.objects.filter(user_id=user_id).order_by("-review_datetime").values())

def get_item(parent_asin):
    return Item.objects.filter(parent_asin=parent_asin).values().first()

def get_reviews_by_item(parent_asin):
    return list(Review.objects.filter(parent_asin=parent_asin).order_by("-review_datetime").values())


def search_items(query, limit=24):
    return list(
        Item.objects.filter(
            Q(item_title__icontains=query)
            | Q(main_category__icontains=query)
            | Q(store__icontains=query)
            | Q(parent_asin__icontains=query)
        )
        .order_by("-num_reviews")[:limit]
        .values()
    )