import json
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .api_client import (
    BackendAPIError,
    get_item,
    get_popular_items,
    get_random_users,
    get_recommendations,
    get_reviews_by_item,
)


class BackendAPIClientTests(SimpleTestCase):
    @override_settings(BACKEND_API_URL="https://api.example", BACKEND_API_TIMEOUT=5)
    @patch("store.api_client.urlopen")
    def test_fetches_recommendations(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = json.dumps({
            "user_id": "shopper/1",
            "engine_used": "collaborative",
            "items": [{"parent_asin": "item-1", "item_title": "A neat thing"}],
        }).encode()

        payload = get_recommendations("shopper/1", limit=6)

        self.assertEqual(payload["items"][0]["parent_asin"], "item-1")
        self.assertEqual(
            mock_urlopen.call_args.args[0].full_url,
            "https://api.example/api/v1/users/shopper%2F1/recommendations?n=6",
        )
        self.assertEqual(mock_urlopen.call_args.kwargs["timeout"], 5)

    @override_settings(BACKEND_API_URL="https://api.example", BACKEND_API_TIMEOUT=5)
    @patch("store.api_client.urlopen")
    def test_null_recommendations_are_an_empty_list(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"items":null,"engine_used":null}'

        self.assertEqual(get_recommendations("shopper-1")["items"], [])

    @override_settings(BACKEND_API_URL="https://api.example", BACKEND_API_TIMEOUT=5)
    @patch("store.api_client.urlopen")
    def test_gets_random_users(self, mock_urlopen):
        first_response = mock_urlopen.return_value.__enter__.return_value
        first_response.read.return_value = b'[{"user_id":"shopper-1"}]'

        self.assertEqual(get_random_users(limit=1), [{"user_id": "shopper-1"}])
        self.assertIn("/api/v1/randomusers?n=1", mock_urlopen.call_args.args[0].full_url)

    @override_settings(BACKEND_API_URL="https://api.example", BACKEND_API_TIMEOUT=5)
    @patch("store.api_client.urlopen")
    def test_popular_items_use_the_documented_endpoint(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = json.dumps([
            {"parent_asin": f"popular-{index}"} for index in range(6)
        ]).encode()

        items = get_popular_items(limit=5)
        self.assertEqual(len(items), 5)
        self.assertEqual(items[0]["parent_asin"], "popular-0")
        self.assertTrue(
            mock_urlopen.call_args.args[0].full_url.endswith("/api/v1/popular_items?limit=5")
        )

    @override_settings(BACKEND_API_URL="https://api.example", BACKEND_API_TIMEOUT=5)
    @patch("store.api_client.urlopen")
    def test_item_and_paginated_review_endpoints(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"parent_asin":"item-1","item_title":"A neat thing"}'
        self.assertEqual(get_item("item-1")["item_title"], "A neat thing")

        response.read.return_value = json.dumps({
            "items": [{"review_id": "review-1", "review_date": "2025-01-01"}],
            "page": 2,
            "page_size": 10,
            "total_count": 11,
            "page_count": 2,
        }).encode()
        payload = get_reviews_by_item("item-1", page=2, page_size=10)
        self.assertEqual(payload["total_count"], 11)
        self.assertEqual(
            mock_urlopen.call_args.args[0].full_url,
            "https://api.example/api/v1/items/item-1/reviews?page=2&page_size=10",
        )


class HomePageTests(SimpleTestCase):
    @patch("store.views.get_popular_items", return_value=[{
        "parent_asin": "popular-1",
        "item_title": "A popular thing",
        "main_category": "Useful stuff",
        "is_free": True,
    }])
    @patch("store.views.get_recommendations", return_value={
        "engine_used": "collaborative",
        "items": [{
            "parent_asin": "item-1",
            "item_title": "A neat thing",
            "main_category": "Useful stuff",
            "is_free": True,
        }],
    })
    @patch("store.views._load_users", return_value=[
        {"user_id": "shopper-1"},
    ])
    def test_home_renders_api_recommendations_popular_items_and_user_id(
        self, mock_users, mock_recommendations, mock_popular
    ):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Recommended for shopper-1")
        self.assertContains(response, "Hello,")
        self.assertContains(response, "<option value=\"shopper-1\" selected>shopper-1</option>")
        self.assertContains(response, "A neat thing")
        self.assertContains(response, "Popular items")
        self.assertContains(response, "A popular thing")
        content = response.content
        self.assertLess(
            content.index(b'id="popular-items"'),
            content.index(b'id="recommendations"'),
        )
        mock_recommendations.assert_called_once_with("shopper-1", limit=8)

    @patch("store.views.get_popular_items", side_effect=BackendAPIError("Not found", 404))
    @patch("store.views.get_recommendations", return_value={"items": []})
    @patch("store.views._load_users", return_value=[
        {"user_id": "shopper-1"},
    ])
    def test_home_surfaces_missing_popular_endpoint(
        self, mock_users, mock_recommendations, mock_popular
    ):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Popular items could not be loaded from the Amozon API.")

    @patch("store.views.get_random_users", return_value=[{"user_id": "shopper-1"}])
    def test_shoppers_are_loaded_without_profile_requests(self, mock_random):
        from .views import _load_users

        self.assertEqual(_load_users(), [{"user_id": "shopper-1"}])
        mock_random.assert_called_once_with(limit=5)

    @patch("store.views.get_reviews_by_item", return_value={
        "items": [{
            "review_id": "review-1",
            "user_id": "reviewer-1",
            "review_title": "Works as promised",
            "review_text": "A very useful item.",
            "review_rating": 5,
            "verified_purchase": True,
            "review_date": "2025-01-01",
        }],
        "total_count": 1,
        "page_count": 1,
    })
    @patch("store.views.get_item", return_value={
        "parent_asin": "item-1",
        "item_title": "A neat thing",
        "main_category": "Useful stuff",
        "price": -1,
        "is_free": False,
        "num_reviews": 1,
    })
    @patch("store.views._load_users", return_value=[
        {"user_id": "shopper-1"},
    ])
    def test_product_page_uses_api_product_and_reviews(
        self, mock_users, mock_item, mock_reviews
    ):
        response = self.client.get("/product/item-1/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "A neat thing")
        self.assertContains(response, "Price not listed")
        self.assertContains(response, "Customer reviews")
        self.assertContains(response, "Works as promised")
        self.assertContains(response, "A very useful item.")
        mock_reviews.assert_called_once_with("item-1", page=1, page_size=10)
