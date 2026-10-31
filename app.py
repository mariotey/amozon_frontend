"""Small Flask page server; the browser loads live FastAPI data asynchronously."""

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, render_template, request


ENV_FILE = Path(__file__).with_name(".env")


def create_app(config=None):
    # Local settings supplement the environment; deployment values take precedence.
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

    def page(template, status=200):
        return render_template(template, client_config={
            "apiBaseURL": app.config["API_BASE_URL"],
            "retryWindowMs": retry_window,
        }), status

    @app.get("/")
    def home():
        return page("home.html")

    @app.get("/product/<item_id>/", strict_slashes=False)
    def product(item_id):
        # Product existence/data is checked by FastAPI after the shell loads.
        return page("product.html")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.errorhandler(404)
    def not_found(error):
        return page("not_found.html", 404)

    @app.after_request
    def disable_page_cache(response):
        if not request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app


app = create_app()
