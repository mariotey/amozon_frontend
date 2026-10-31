"""Route/template/module integration without contacting the recommendation API."""

import json
import os
from pathlib import Path
import posixpath
import re
import unittest
from typing import Any, cast
from unittest.mock import patch

from flask.testing import FlaskClient

# Tests do not depend on a developer's ignored .env file being present.
with patch.dict(os.environ, {"API_BASE_URL": "https://api.example"}):
    from app import create_app


class StorefrontPagesTests(unittest.TestCase):
    """Check page rendering, local configuration, and deployment asset integration."""

    def setUp(self) -> None:
        """
        Create an isolated Flask client for the current regression test.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        self.client = create_app(
            {"TESTING": True, "API_BASE_URL": "https://api.example"}
        ).test_client()

    def test_pages_have_distinct_content_and_shared_navigation(self) -> None:
        """
        Verify page-specific content and shared navigation on the home and product routes.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        for path, present, absent in (
            ("/", 'id="history-content"', 'id="details-content"'),
            ("/product/example/", 'id="details-content"', 'id="history-content"'),
            ("/product/example", 'id="product-reviews-content"', 'id="history-content"'),
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                html = response.get_data(as_text=True)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertIn(present, html)
                self.assertNotIn(absent, html)
                for shared in (
                    'id="home-link"',
                    'id="shoppers"',
                    'id="project-menu"',
                    'class="site-footer"',
                    'type="module" src="/static/app.js"',
                ):
                    self.assertIn(shared, html)

    def test_template_components_resolve_independently_of_working_directory(self) -> None:
        """
        Verify template fragments resolve when the process starts outside the repository.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            previous = os.getcwd()
            try:
                os.chdir(directory)
                app = create_app({"TESTING": True, "API_BASE_URL": "https://api.example"})
                self.assertIn(
                    "project-menu", app.jinja_env.get_template("components/drawer.html").render()
                )
                response = app.test_client().get("/")
                self.assertEqual(response.status_code, 200)
                self.assertIn('id="history-content"', response.get_data(as_text=True))
            finally:
                os.chdir(previous)

    def test_vercel_build_copies_every_asset_without_changing_urls(self) -> None:
        """
        Verify the deployment copy preserves every asset and its locally served URL.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        import tempfile
        from build import prepare_static

        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual(config["framework"], "flask")
        self.assertEqual(config["buildCommand"], "python build.py")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "public/static"
            prepare_static(target)
            source = root / "static"
            expected = {file.relative_to(source) for file in source.rglob("*") if file.is_file()}
            actual = {file.relative_to(target) for file in target.rglob("*") if file.is_file()}
            self.assertEqual(actual, expected)
            # Repeating a deployment copy must preserve all source bytes too.
            prepare_static(target)
            for relative in expected:
                self.assertEqual((target / relative).read_bytes(), (source / relative).read_bytes())
                with self.client.get("/static/" + relative.as_posix()) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.data, (target / relative).read_bytes())

    def test_both_pages_load_all_stylesheets_from_static_css(self) -> None:
        """
        Verify both page templates load every stylesheet in the same cascade order.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        root = Path(__file__).resolve().parents[1]
        expected = {"/static/css/" + path.name for path in (root / "static/css").glob("*.css")}
        previous = None
        for page in ("/", "/product/example/"):
            html = self.client.get(page).get_data(as_text=True)
            styles = re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
            self.assertGreater(len(styles), 1)
            self.assertEqual(set(styles), expected)
            self.assertEqual(len(styles), len(expected))
            if previous is not None:
                self.assertEqual(styles, previous)
            previous = styles
            for url in styles:
                with self.client.get(url) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.content_type.startswith("text/css"))

    def test_home_initial_loading_uses_short_message(self) -> None:
        """
        Verify the initial home sections use the short loading message.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        html = self.client.get("/").get_data(as_text=True)
        self.assertEqual(html.count('class="loading-message">Loading<span'), 2)

    def test_config_uses_explicit_api_url_and_safe_serialization(self) -> None:
        """
        Verify explicit API settings, safe JSON serialization, and retry defaults.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """

        def config(client: FlaskClient, **options: Any) -> dict[str, Any]:
            """
            Read the serialized browser configuration from a rendered test page.

            Args:

            - client(FlaskClient): The Flask client used to request the page.
            - **options(Any): Additional keyword arguments passed to the client request.

            Returns:

            - dict[str, Any]: The browser configuration decoded from the page JSON.
            """
            html = client.get("/", **options).get_data(as_text=True)
            return json.loads(
                cast(
                    re.Match[str],
                    re.search(r'<script id="app-config"[^>]*>(.*?)</script>', html, re.S),
                )[1]
            )

        client = create_app({"TESTING": True, "API_BASE_URL": "https://api.example"}).test_client()
        self.assertEqual(config(client)["apiBaseURL"], "https://api.example")
        self.assertEqual(
            config(client, base_url="https://store.example")["apiBaseURL"], "https://api.example"
        )
        value = "https://api.example/</script><script>unsafe</script>"
        client = create_app(
            {"TESTING": True, "API_BASE_URL": value, "RETRY_WINDOW_MS": 1200}
        ).test_client()
        self.assertEqual(config(client), {"apiBaseURL": value, "retryWindowMs": 1200})
        for invalid in (0, -1, None, "invalid"):
            client = create_app(
                {"TESTING": True, "API_BASE_URL": "https://api.example", "RETRY_WINDOW_MS": invalid}
            ).test_client()
            self.assertEqual(config(client)["retryWindowMs"], 300000)

    def test_local_dotenv_loads_without_overriding_deployment_environment(self) -> None:
        """
        Verify local dotenv settings, deployment precedence, and missing-setting errors.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("API_BASE_URL=https://local.example\n", encoding="utf-8")
            with patch("app.ENV_FILE", env_file), patch.dict(os.environ, {}, clear=True):
                self.assertEqual(create_app().config["API_BASE_URL"], "https://local.example")
                os.environ["API_BASE_URL"] = "https://deployment.example"
                self.assertEqual(create_app().config["API_BASE_URL"], "https://deployment.example")
                env_file.unlink()
                os.environ.pop("API_BASE_URL")
                with self.assertRaisesRegex(RuntimeError, "Set API_BASE_URL"):
                    create_app()

    def test_unknown_paths_health_and_missing_assets(self) -> None:
        """
        Verify unknown URLs, the liveness route, and missing static assets.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        for path in ("/missing", "/product/a/b"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404)
            self.assertIn("Page not found", response.get_data(as_text=True))
        response = self.client.get("/health")
        self.assertEqual(response.json, {"status": "ok"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.get("/static/missing.js").status_code, 404)

    def test_all_module_imports_resolve_to_served_javascript(self) -> None:
        """
        Verify module files and their relative imports are served as JavaScript.

        Args:

        - self(StorefrontPagesTests): The current test case.

        Returns:

        - None: No value is returned.
        """
        root = Path(__file__).resolve().parents[1]
        modules = list((root / "static").rglob("*.js"))
        self.assertGreater(len(modules), 1)
        for module in modules:
            url = "/" + module.relative_to(root).as_posix()
            with self.client.get(url) as response:
                self.assertEqual(response.status_code, 200, url)
                self.assertIn("javascript", response.content_type, url)
            for relative in re.findall(
                r"from\s+['\"]([^'\"]+)['\"]", module.read_text(encoding="utf-8")
            ):
                self.assertTrue(relative.startswith("."), relative)
                imported = posixpath.normpath(posixpath.join(posixpath.dirname(url), relative))
                with self.client.get(imported) as response:
                    self.assertEqual(response.status_code, 200, imported)


if __name__ == "__main__":
    unittest.main()
