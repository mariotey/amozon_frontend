"""Small Flask page server; the browser loads live FastAPI data asynchronously."""

import os
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, render_template, request, send_from_directory

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"


def create_app(config=None):
    # Vercel serves public/ from its CDN. A matching route supports local Flask.
    app = Flask(__name__, static_folder=None)
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

    def page(status=200):
        api_base_url = app.config["API_BASE_URL"]
        if not api_base_url:
            # A local storefront should use the backend from the same checkout.
            local = urlsplit(request.host_url).hostname in {"localhost", "127.0.0.1", "::1"}
            api_base_url = "http://127.0.0.1:8000" if local else "https://amozon-backend-tg7x.onrender.com"
        return render_template("index.html", client_config={
            "apiBaseURL": api_base_url,
            "retryWindowMs": retry_window,
        }), status

    @app.get("/")
    def home():
        return page()

    @app.get("/product/<item_id>/", strict_slashes=False)
    def product(item_id):
        # Product existence/data is checked by FastAPI after the shell loads.
        return page()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/static/<path:filename>")
    def public_asset(filename):
        return send_from_directory(PUBLIC / "static", filename)

    @app.errorhandler(404)
    def not_found(error):
        return page(404)

    @app.after_request
    def disable_page_cache(response):
        if not request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app


app = create_app()
