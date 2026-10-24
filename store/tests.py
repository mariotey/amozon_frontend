"""Backend-contract and section-rendering tests with mocked upstream requests.

SimpleTestCase requires no database. These checks cover Python responses and
HTML content; they do not execute browser animations or retry timers.
"""

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
    """Check endpoint URLs, request options, and expected payload handling."""
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


class InvalidBackendResponseTests(SimpleTestCase):
    """Distinguish backend failures from valid empty results and allow recovery."""
    @patch("store.api_client.urlopen")
    def test_empty_body_is_retryable_failure(self, mock_urlopen):
        mock_urlopen.return_value.__enter__.return_value.read.return_value = b""
        response = self.client.get("/sections/popular/")
        self.assertEqual(response.status_code, 503)

    @patch("store.views.get_popular_items", side_effect=[BackendAPIError("Sleeping"), []])
    def test_retry_can_recover_without_cached_data(self, mock_items):
        self.assertEqual(self.client.get("/sections/popular/").status_code, 503)
        response = self.client.get("/sections/popular/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("No popular items available.", response.json()["html"])
        self.assertEqual(mock_items.call_count, 2)


class LoadingPageTests(SimpleTestCase):
    """Verify immediate shells, live sections, empty states, and pagination."""
    @patch("store.api_client.urlopen")
    def test_pages_render_loading_sections_without_backend_requests(self, mock_urlopen):
        for url, sections in [("/", ["popular", "recommendations"]),
                              ("/product/item-1/?page=2&user_id=shopper-1", ["details", "reviews"])]:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, 'data-section="shoppers"')
            for section in sections:
                self.assertContains(response, f'data-section="{section}"')
            self.assertContains(response, "loading-dots")
            self.assertContains(response, "store/loading.js")
            self.assertIn("no-store", response.headers["Cache-Control"])
        mock_urlopen.assert_not_called()

    @patch("store.views.get_random_users", return_value=[{"user_id": "shopper-1"}])
    def test_shoppers_choose_default_user(self, mock_users):
        response = self.client.get("/sections/shoppers/")
        self.assertEqual(response.json()["user_id"], "shopper-1")
        self.assertIn('selected>shopper-1', response.json()["html"])

    @patch("store.views.get_popular_items", return_value=[{"parent_asin": "item-1", "item_title": "A neat thing"}])
    def test_popular_items_render_live_links(self, mock_items):
        response = self.client.get("/sections/popular/?user_id=shopper-1")
        self.assertContains(response, "A neat thing")
        self.assertIn("/product/item-1/?user_id=shopper-1", response.json()["html"])
        self.assertIn("no-store", response.headers["Cache-Control"])

    @patch("store.views.get_popular_items", return_value=[])
    def test_empty_popular_items_stop_loading(self, mock_items):
        response = self.client.get("/sections/popular/")
        self.assertIn("No popular items available.", response.json()["html"])
        self.assertNotIn("loading-dots", response.json()["html"])

    @patch("store.views.get_recommendations", return_value={"items": []})
    def test_empty_recommendations(self, mock_items):
        response = self.client.get("/sections/recommendations/?user_id=shopper-1")
        self.assertIn("No recommendations available", response.json()["html"])
        mock_items.assert_called_once_with("shopper-1", limit=8)

    @patch("store.views.get_random_users", side_effect=BackendAPIError("Sleeping"))
    def test_failed_shoppers_do_not_look_like_empty_recommendations(self, mock_users):
        response = self.client.get("/sections/recommendations/")
        self.assertEqual(response.status_code, 503)

    @patch("store.views.get_popular_items", side_effect=BackendAPIError("Sleeping"))
    def test_backend_failure_is_retryable(self, mock_items):
        response = self.client.get("/sections/popular/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "Unable to load right now.")

    @patch("store.views.get_item", side_effect=BackendAPIError("Not found", 404))
    def test_missing_product_is_a_final_empty_state(self, mock_item):
        response = self.client.get("/sections/details/?item_id=missing")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Product not found", response.json()["html"])

    @patch("store.views.get_reviews_by_item", return_value={"items": [], "page_count": 1, "total_count": 0})
    def test_empty_reviews(self, mock_reviews):
        response = self.client.get("/sections/reviews/?item_id=item-1")
        self.assertIn("No reviews are available", response.json()["html"])

    @patch("store.views.get_reviews_by_item", side_effect=[
        {"items": [], "page_count": 2, "total_count": 11},
        {"items": [{"review_title": "Useful", "review_rating": 5}], "page_count": 2, "total_count": 11},
    ])
    def test_reviews_clamp_page_and_preserve_pagination(self, mock_reviews):
        response = self.client.get("/sections/reviews/?item_id=item-1&page=99&user_id=shopper-1")
        self.assertIn("Useful", response.json()["html"])
        self.assertIn("Page 2 of 2", response.json()["html"])
        self.assertIn("user_id=shopper-1", response.json()["html"])
        self.assertEqual(mock_reviews.call_args.kwargs["page"], 2)

    def test_unknown_section(self):
        self.assertEqual(self.client.get("/sections/unknown/").status_code, 404)
