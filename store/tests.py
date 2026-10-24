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
    def test_rejects_unexpected_response_shape(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"items":[{"item_title":"Missing item id"}]}'

        with self.assertRaises(RecommendationServiceError):
            get_recommendations("shopper-1")


class HomePageTests(SimpleTestCase):
    @patch("store.views.Item.objects.filter", return_value=[])
    @patch("store.views.get_recommendations")
    @patch("store.views.get_reviews_by_user", return_value=[])
    @patch("store.views.get_sliced_users", return_value=[{"user_id": "shopper-1"}])
    def test_home_renders_api_recommendations(
        self, mock_users, mock_reviews, mock_recommendations, mock_catalog
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
        self.assertContains(response, "Recommended for you")
        self.assertContains(response, "A neat thing")
        self.assertContains(response, "Suggested by popular")
        mock_recommendations.assert_called_once_with("shopper-1")

    @patch("store.views.get_recommendations", side_effect=RecommendationServiceError)
    @patch("store.views.get_reviews_by_user", return_value=[])
    @patch("store.views.get_sliced_users", return_value=[{"user_id": "shopper-1"}])
    def test_home_shows_message_when_recommendation_service_fails(
        self, mock_users, mock_reviews, mock_recommendations
    ):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Recommendations are temporarily unavailable")

    @patch("store.views.search_items", return_value=[{
        "parent_asin": "item-1",
        "item_title": "A neat thing",
        "main_category": "Useful stuff",
        "is_free": True,
    }])
    @patch("store.views.get_reviews_by_user", return_value=[])
    @patch("store.views.get_sliced_users", return_value=[{"user_id": "shopper-1"}])
    @patch("store.views.get_recommendations")
    def test_search_shows_catalog_results_without_fetching_recommendations(
        self, mock_recommendations, mock_users, mock_reviews, mock_search
    ):
        response = self.client.get("/", {"q": "neat", "user_id": "shopper-1"})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Results for “neat”')
        self.assertContains(response, "A neat thing")
        mock_search.assert_called_once_with("neat")
        mock_recommendations.assert_not_called()
