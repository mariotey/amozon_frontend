import json
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .recommendations import RecommendationServiceError, get_recommendations


class RecommendationClientTests(SimpleTestCase):
    @override_settings(
        RECOMMENDATION_API_URL="https://recommendations.example",
        RECOMMENDATION_API_TIMEOUT=4,
    )
    @patch("store.recommendations.urlopen")
    def test_fetches_and_validates_recommendations(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = json.dumps({
            "user_id": "shopper/1",
            "engine_used": "popular",
            "items": [{"parent_asin": "item-1", "item_title": "A neat thing"}],
        }).encode()

        payload = get_recommendations("shopper/1", limit=6)

        self.assertEqual(payload["engine_used"], "popular")
        self.assertEqual(payload["items"][0]["parent_asin"], "item-1")
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://recommendations.example/api/v1/users/shopper%2F1/recommendations?n=6",
        )

    @override_settings(
        RECOMMENDATION_API_URL="https://recommendations.example",
        RECOMMENDATION_API_TIMEOUT=4,
    )
    @patch("store.recommendations.urlopen")
    def test_default_recommendation_limit_is_eight(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"items":[]}'

        get_recommendations("shopper-1")

        request = mock_urlopen.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/recommendations?n=8"))

    @override_settings(
        RECOMMENDATION_API_URL="https://recommendations.example",
        RECOMMENDATION_API_TIMEOUT=4,
    )
    @patch("store.recommendations.urlopen")
    def test_rejects_unexpected_response_shape(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"items":[{"item_title":"Missing item id"}]}'

        with self.assertRaises(RecommendationServiceError):
            get_recommendations("shopper-1")


class HomePageTests(SimpleTestCase):
    @patch("store.views.get_popular_items", return_value=[{
        "parent_asin": "popular-1",
        "item_title": "A popular thing",
        "main_category": "Useful stuff",
        "is_free": True,
    }])
    @patch("store.views.Item.objects.filter", return_value=[])
    @patch("store.views.get_recommendations")
    @patch("store.views.get_sliced_users", return_value=[{"user_id": "shopper-1"}])
    def test_home_renders_api_recommendations(
        self, mock_users, mock_recommendations, mock_catalog, mock_popular
    ):
        mock_recommendations.return_value = {
            "engine_used": "popular",
            "reason": "New shopper",
            "items": [{
                "parent_asin": "item-1",
                "item_title": "A neat thing",
                "main_category": "Useful stuff",
                "is_free": True,
            }],
        }

        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Recommended for shopper-1")
        self.assertContains(response, "Hello,")
        self.assertContains(response, 'aria-label="Select shopper"')
        self.assertContains(response, '<option value="shopper-1" selected>')
        self.assertContains(response, "A neat thing")
        self.assertContains(response, "Popular items")
        self.assertContains(response, "A popular thing")
        self.assertContains(response, "Selected using popular recommendations.")
        self.assertNotContains(response, "Your reviews")
        self.assertNotContains(response, "Recent shopper reviews")
        self.assertNotContains(response, "Today's deals-ish")
        self.assertNotContains(response, "Search Amozon")
        mock_recommendations.assert_called_once_with("shopper-1")

    @patch("store.views.get_recommendations", side_effect=RecommendationServiceError)
    @patch("store.views.get_popular_items", return_value=[])
    @patch("store.views.get_sliced_users", return_value=[{"user_id": "shopper-1"}])
    def test_home_shows_message_when_recommendation_service_fails(
        self, mock_users, mock_popular, mock_recommendations
    ):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Recommendations are temporarily unavailable")

    @patch("store.views.get_popular_items", return_value=[])
    @patch("store.views.Item.objects.filter", return_value=[])
    @patch("store.views.get_recommendations", return_value={
        "engine_used": "popular",
        "items": [],
    })
    @patch("store.views.get_sliced_users", return_value=[
        {"user_id": "shopper-1"},
        {"user_id": "shopper-2"},
    ])
    def test_selected_shopper_is_shown_in_greeting_and_used_for_recommendations(
        self, mock_users, mock_recommendations, mock_catalog, mock_popular
    ):
        response = self.client.get("/", {"user_id": "shopper-2"})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Hello,")
        self.assertContains(response, "Recommended for shopper-2")
        self.assertContains(response, '<option value="shopper-2" selected>')
        mock_recommendations.assert_called_once_with("shopper-2")

    @patch("store.views.get_reviews_by_item", return_value=[{
        "review_id": "review-1",
        "parent_asin": "item-1",
        "user_id": "reviewer-1",
        "review_title": "Works as promised",
        "review_text": "A very useful item.",
        "review_rating": 5,
        "verified_purchase": True,
    }])
    @patch("store.views.get_item", return_value={
        "parent_asin": "item-1",
        "item_title": "A neat thing",
        "main_category": "Useful stuff",
        "price": -1,
        "is_free": False,
        "num_reviews": 0,
    })
    @patch("store.views.get_sliced_users", return_value=[{"user_id": "shopper-1"}])
    def test_product_page_shows_details_and_hides_unknown_price(
        self, mock_users, mock_item, mock_reviews
    ):
        response = self.client.get("/product/item-1/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "A neat thing")
        self.assertContains(response, "Price not listed")
        self.assertNotContains(response, "$-1.00")
        self.assertContains(response, "Customer reviews")
        self.assertContains(response, "Works as promised")
        self.assertContains(response, "A very useful item.")
        mock_reviews.assert_called_once_with("item-1")
