"""Small Flask page server; the browser loads live FastAPI data asynchronously."""

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, Response, render_template, request
from werkzeug.exceptions import NotFound

ENV_FILE = Path(__file__).with_name(".env")


def create_app(config: dict[str, Any] | None = None) -> Flask:
    # Local settings supplement the environment; deployment values take precedence.
    """
    Create the storefront application with explicit API settings and page routes.

    Args:

    - config(dict[str, Any] | None): Optional Flask configuration overrides.

    Returns:

    - Flask: The configured storefront application.
    """
    load_dotenv(ENV_FILE)
    # Local Flask serves static/; Vercel receives the same assets at build time.
    app = Flask(__name__)
    app.config.from_mapping(
        API_BASE_URL=os.getenv("API_BASE_URL"),
        RETRY_WINDOW_MS=300000,
    )
    if config:
        app.config.update(config)
    if not app.config["API_BASE_URL"]:
        raise RuntimeError("Set API_BASE_URL in the environment or the local .env file.")
    try:
        retry_window = int(app.config["RETRY_WINDOW_MS"])
        if retry_window <= 0:
            raise ValueError
    except (TypeError, ValueError):
        retry_window = 300000

    def page(template: str, status: int = 200) -> tuple[str, int]:
        """
        Render a page template with the browser configuration and HTTP status.

        Args:

        - template(str): The page template filename.
        - status(int): The HTTP response status.

        Returns:

        - tuple[str, int]: Rendered HTML and its HTTP status.
        """
        return (
            render_template(
                template,
                client_config={
                    "apiBaseURL": app.config["API_BASE_URL"],
                    "retryWindowMs": retry_window,
                },
            ),
            status,
        )

    @app.get("/")
    def home() -> tuple[str, int]:
        """
        Render the home page containing shopper reviews and recommendations.

        Args:

        - None: This function takes no arguments.

        Returns:

        - tuple[str, int]: The home page HTML and HTTP status.
        """
        return page("home.html")

    @app.get("/product/<item_id>/", strict_slashes=False)
    def product(item_id: str) -> tuple[str, int]:
        # Product existence/data is checked by FastAPI after the shell loads.
        """
        Render a product page shell; the browser retrieves product data from FastAPI.

        Args:

        - item_id(str): The product identifier carried in the page URL.

        Returns:

        - tuple[str, int]: The product page HTML and HTTP status.
        """
        return page("product.html")

    @app.get("/health")
    def health() -> dict[str, str]:
        """
        Report that the Flask process can respond to requests.

        Args:

        - None: This function takes no arguments.

        Returns:

        - dict[str, str]: A process liveness status; backend readiness is not checked.
        """
        return {"status": "ok"}

    @app.errorhandler(404)
    def not_found(error: NotFound) -> tuple[str, int]:
        """
        Render the storefront error page for an unknown URL.

        Args:

        - error(NotFound): The routing exception raised for the missing resource.

        Returns:

        - tuple[str, int]: The error page HTML and HTTP 404 status.
        """
        return page("not_found.html", 404)

    @app.after_request
    def disable_page_cache(response: Response) -> Response:
        """
        Prevent browser caching of page responses while retaining static asset caching.

        Args:

        - response(Response): The outgoing Flask response.

        Returns:

        - Response: The same response with page cache headers applied.
        """
        if not request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app


app = create_app()
