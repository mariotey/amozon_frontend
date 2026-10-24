# Technical guide

## Structure and request flow

The app uses Django 6.0, plain JavaScript/CSS, WhiteNoise for static files, and Gunicorn for deployment. Use Python 3.13, matching `.python-version`; dependencies are declared in `pyproject.toml` and locked in `uv.lock`.

| Location | Purpose |
| --- | --- |
| `manage.py` | Command-line entry point for running Django and project checks |
| `ecommerce/__init__.py`, `store/__init__.py` | Empty Python package markers |
| `ecommerce/settings.py` | Backend address, timeouts, allowed hosts, and static-file configuration |
| `ecommerce/urls.py` | Delegates website routes to `store/urls.py` |
| `ecommerce/wsgi.py` | Exposes `application`, the entry point used by Gunicorn |
| `ecommerce/asgi.py` | Alternative server entry point; not used by the documented Gunicorn command |
| `store/apps.py` | Django app configuration for the storefront |
| `store/urls.py`, `store/views.py` | Page routes and independently loaded sections |
| `store/api_client.py` | Backend HTTP requests, response validation, and error handling |
| `store/templates/loading.html`, `store/templates/partials/` | Initial page and live section markup |
| `store/static/store/` | Styling, moving dots, and browser retry behavior |
| `store/tests.py` | API-client and section-response tests |
| `store/data/` | Parquet datasets and an extraction notebook; not used by the live views |
| `pyproject.toml`, `uv.lock`, `.python-version` | Dependency declarations, locked versions, and selected Python version |
| `.gitignore` | Excludes secrets, environments, generated static files, and tool caches |
| `README.md`, `TECHNICAL.md` | Management overview and developer/operations guide |

`/` and `/product/<item_id>/` render immediately. JavaScript requests `/sections/<name>/`, which calls FastAPI and returns JSON containing rendered HTML. Sections load independently; recommendations wait for shopper loading. The active pages use `loading.html` and partials, rather than the older complete `home.html` and `product.html` templates.

Backend calls have a 10-second timeout. Browser requests have a maximum 15-second timeout and retry after a delay of up to four seconds, within a shared initial two-minute window. Manual retries start a new window. There is no application data cache; page and section responses disable caching. Browser requests reach Django, so the browser does not call FastAPI directly.

### Templates and supporting data

`base.html` provides the shared header, shopper area, and footer. `loading.html` adds the initial section placeholders. The partials `shoppers.html`, `popular.html`, `recommendations.html`, `details.html`, and `reviews.html` render the corresponding live sections. `loading_section.html` supplies the loading dots, and `product_card.html` is shared by the product lists. `styles.css` defines layout and animation; `loading.js` manages fetching, retries, and replacing placeholders.

The optional `store/data/data_extractor.ipynb` selects sample shoppers and related products/reviews from an external `../../../Recommender/data/output` directory, writes the three local Parquet files, and can populate a local Redis instance with pickled records without expiry. It is a standalone data-preparation workflow, not part of website startup. Its pandas, Parquet-engine, Redis-client, and notebook dependencies are not included in the app's declared dependencies. Running its write cells overwrites the output files or Redis keys; it is not required for deployment.

The sample files are `user.parquet` (shoppers), `item.parquet` (products), and `user-item-interaction.parquet` (reviews/interactions). Generated `staticfiles/`, virtual environments, and cache directories are local artifacts rather than maintained source files. There is no current `store/models.py` or `.env.example` in the repository, even if an editor still shows an older tab.

## Local setup

Install Python 3.13 and `uv`, then run from the repository root:

```sh
uv sync --frozen
uv run python manage.py collectstatic --noinput
uv run python manage.py runserver --insecure
```

Open `http://127.0.0.1:8000/`. The development-only `--insecure` flag serves static assets with the current `DEBUG=False` setting. Do not use this server for deployment. No local database or migrations are required by the current storefront.

Configuration is currently hardcoded in `ecommerce/settings.py`, including `BACKEND_API_URL` and `BACKEND_API_TIMEOUT`. The app does not load `.env` files; adding environment variables alone will not override these values.

## Backend contract

The FastAPI service must be deployed separately and return JSON from these GET endpoints:

| Endpoint | Expected response |
| --- | --- |
| `/api/v1/randomusers?n=5` | List of shoppers with string `user_id` values |
| `/api/v1/popular_items?limit=5` | List of product objects |
| `/api/v1/users/<user_id>/recommendations?n=8` | Object with `items`; optional `engine_used` and `reason` |
| `/api/v1/items/<parent_asin>` | Product object, or HTTP 404 for a missing product |
| `/api/v1/items/<parent_asin>/reviews?page=1&page_size=10` | Object with `items`, integer `total_count`, and integer `page_count` |

Product links use `parent_asin`. Templates display fields such as `item_title`, `main_category`, `price`, `is_free`, `avg_rating`, and `num_reviews`. Product images are not currently rendered. Backend connection errors, invalid JSON, and rejected payloads become HTTP 503 section responses so the browser can retry.

## Deployment

Example commands for a Render Python web service with Python 3.13 and `uv` available:

**Build command**

```sh
uv sync --frozen && uv run python manage.py collectstatic --noinput
```

**Start command** (Linux hosting shell)

```sh
uv run gunicorn ecommerce.wsgi:application --bind 0.0.0.0:$PORT
```

WhiteNoise serves collected assets from `staticfiles/`. The current allowed hosts include localhost and `.onrender.com`; another domain requires a settings update. Verify the configured backend address is reachable from the deployed app. These commands describe the app's entry points; this repository does not contain an automated deployment configuration.

The configured signing key is explicitly public and demo-only. Before introducing authentication, sessions, or signed tokens, replace it with a privately managed key and review the deployment settings.

## Checks and troubleshooting

```sh
uv run python manage.py check
uv run python manage.py test
node --check store/static/store/loading.js
```

The last command requires Node.js only for a JavaScript syntax check; Node.js is not needed to run the website. Tests mock the backend and do not verify a live deployment or browser animation.

- **Dots become a retry button:** check backend availability and Django logs. Requests may wake a sleeping service, but cannot repair a failed deployment.
- **No results message:** the backend responded successfully with no matching data.
- **Missing styles or JavaScript:** check `collectstatic` output and static asset responses. JavaScript is required to load live sections.
