"""Small Flask page server; the browser loads live FastAPI data asynchronously."""

import os
from urllib.parse import urlsplit

from flask import Flask, render_template, request


def create_app(config=None):
    # Local Flask serves static/; Vercel receives the same assets at build time.
    app = Flask(__name__)
    app.config.from_mapping(
        API_BASE_URL=os.getenv("API_BASE_URL"),
        RETRY_WINDOW_MS=300000,
    )
    if config:
        app.config.update(config)
    try:
        retry_window = int(app.config["RETRY_WINDOW_MS"])
        if retry_window <= 0:
            raise ValueError
    except (TypeError, ValueError):
        retry_window = 300000

    def page(template, status=200):
        api_base_url = app.config["API_BASE_URL"]
        if not api_base_url:
            # A local storefront should use the backend from the same checkout.
            local = urlsplit(request.host_url).hostname in {"localhost", "127.0.0.1", "::1"}
            api_base_url = "http://127.0.0.1:8000" if local else "https://amozon-backend-tg7x.onrender.com"
        return render_template(template, client_config={
            "apiBaseURL": api_base_url,
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
