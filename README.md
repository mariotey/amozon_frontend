# Amozon storefront

A Flask page server and a browser-based storefront for the Amozon recommendation project. Flask
renders the home/product layouts; plain JavaScript modules fetch live data from FastAPI. There is no
frontend framework, bundler, or npm install.

## Run locally (PowerShell)

From this repository, install dependencies with `uv sync` if needed. Create a local `.env` file
beside `app.py` containing:

```dotenv
API_BASE_URL=https://amozon-backend-tg7x.onrender.com
```

The local file is already created in this workspace and is ignored by Git. A new clone needs its own
`.env`, or an `API_BASE_URL` environment variable. Start Flask:

```powershell
.\.venv\Scripts\python.exe -m flask --app app run --debug
```

Open http://127.0.0.1:5000. The hosted backend may take time to wake up. Stop with Ctrl+C. To use a
local backend, start it on port 8000 and change the `.env` value to `http://127.0.0.1:8000`. An
existing environment variable takes precedence over the `.env` value. Restart Flask after changing
configuration.

`API_BASE_URL` is required on every host; there is no hostname-based default. `python-dotenv` loads
the repository's `.env` when present without overwriting an existing environment variable. Missing
configuration stops startup with a clear error. `RETRY_WINDOW_MS` is an optional Flask factory
config override (default 300000 ms), not an environment variable. Browser requests retry temporary
failures within that window. `/health` checks Flask, not backend readiness.

## Code map

```text
app.py                         Flask routes, client config, local static files
templates/
  base.html                    Shared document, header/drawer, footer, script
  home.html                    Review history and recommendation section layout
  product.html                 Product details and customer review section layout
  not_found.html               Unknown storefront URLs (HTTP 404)
  components/
    header.html                Logo, menu button, shopper slot
    drawer.html                Project, data, and resources accordion
    sections.html              Shared initial section/loading macros
static/
  app.js                       Small entry point: shared state and page lifecycle
  css/
    base.css                   Tokens, resets, buttons, accessibility
    layout.css                 Page shell, headings, breadcrumbs, footer
    header.css                 Store header and shopper picker
    products.css               Cards, grids, product details, images, stars
    reviews.css                Product reviews and review page navigation
    home.css                   History carousel and recommendation explanations
    feedback.css               Loading, empty, error, and not-found states
    drawer.css                 Project drawer, accordions, resources
  scripts/
    config.js                  Fixed sample shoppers
    api.js                     Read-only requests and response validation
    retry.js                   Abortable retries and per-attempt timeout
    navigation.js              Shopper-aware URLs and route parsing
    utils.js                   Escaping and display formatting
    components/
      shopper.js               Accessible picker rendering and interactions
      drawer.js                Drawer open/close/reset behavior
      products.js              Shared cards, images, prices, fractional stars
      feedback.js              Loading/error UI and section request lifecycle
    pages/
      home.js                  Home requests and review carousel lifecycle
      home-view.js             Home review/recommendation renderers
      product.js               Product requests and review page correction
      product-view.js          Product and customer review renderers
tests/                         Flask, API, and browser regression checks
build.py                       Copy static sources for Vercel CDN delivery
vercel.json                    Flask deployment and build command
```

Shared HTML fragments live in `templates/components/`, alongside the page templates in `templates/`.
Flask's standard Jinja loader resolves includes such as `components/header.html`; no custom template
loader is needed. CSS lives in `static/css/`, and interactive JavaScript components live under
`static/scripts/components/`. `app.py` remains the Vercel entry point, and browser asset URLs remain
`/static/...`.

## How a page works

1. Flask renders `home.html` or `product.html`, extending `base.html`. These templates own page
   structure, headings, and initial loading placeholders.
2. `app.js` reads the client config and URL, renders the fixed shopper menu, and starts the relevant
   page controller. A linked shopper ID takes precedence over the first demo shopper; arbitrary
   linked shopper IDs remain supported.
3. The controller asks `api.js` for data through `feedback.js`. Each section has its own request
   controller, retry UI, and error handling. A newer request for that section cancels the previous
   one so stale results cannot replace it.
4. Page renderers display API data using shared formatting/product components. Use the escaping
   helper for API text interpolated into HTML. Jinja autoescapes server-rendered values. Failed
   product images reveal the decorative fallback.
5. Changing shoppers reloads the home sections, or navigates from a product to the home page for the
   selected shopper. Navigation links keep the shopper ID.
6. On `pagehide`, requests, picker listeners, home listeners, and the carousel resize observer are
   released. A browser back/forward cache restore reloads the page to restart cancelled requests.

History fetches every API page once per shopper selection, then paginates locally with dots. CSS
chooses 5/3/2 cards on desktop/tablet/mobile. The carousel measures all cached cards to keep its
height stable while sliding; reduced motion skips the slide. Customer reviews on product pages
remain server-paginated. Too-large review page numbers are corrected to the available last page, as
before.

Initial loading markup is rendered by Jinja macros; ongoing loading/retry/error markup is rendered
by `components/feedback.js`. Keep their CSS classes consistent if changing this UI. Home sections
use the short “Loading…” message.

## Sample shoppers and API boundary

`DEMO_SHOPPERS` in `static/scripts/config.js` owns the three fixed IDs and labels. Shopper 1
demonstrates collaborative filtering, Shopper 2 content-based filtering, and Shopper 3 popularity
fallback for the published models/data. The picker makes no discovery request. The backend chooses
the actual engine; the frontend does not force or calculate recommendations. Recheck these IDs after
model/data updates and replace them here if their routes change.

The browser uses these existing endpoints:

- `GET /api/v1/users/{id}/history?verified_only=true&page=…&page_size=100`
- `GET /api/v1/users/{id}/recommendations?n=8`
- `GET /api/v1/items/{asin}`
- `GET /api/v1/items/{asin}/reviews?page=…&page_size=10`

All requests omit credentials. Keep Supabase secrets and model artefacts in the backend. This
project does not train models or write shopper data.

## Where to make changes

- Change page structure in `home.html`/`product.html`; shared layout in `base.html`.
- Change API-backed display markup in the matching `*-view.js` file.
- Change carousel behavior in `pages/home.js`, not the API client.
- Change shopper navigation/keyboard behavior in `components/shopper.js`.
- Change request contracts in `api.js`; retries/timeouts in `retry.js`.
- Change styles in the matching file under `static/css/`. Each component file keeps its responsive
  and reduced-motion rules with its normal styles.

`templates/base.html` lists the stylesheets in cascade order. Shared base/layout styles load first,
followed by component styles. The browser loads these files through separate links, with no CSS
imports, bundler, or additional build step. Keep the link order when editing the template. Add a new
link there if creating another stylesheet; both pages inherit it. Declarations are formatted one per
line so component styles are easier to review and change. `home.css` owns carousel layout and
card-height behavior, while `products.css` owns the shared product grid. The existing Vercel build
copies every CSS file automatically.

Use relative module imports with `.js` extensions. Flask and Vercel serve them from
`/static/scripts/`. Flask serves `static/` directly during local development. Deploy the templates
and JavaScript modules together.

## Verification

Python functions use annotated parameters and return values, with description, `Args`, and `Returns`
sections in their docstrings. Keep source and documentation lines within 100 columns. In VS Code,
select this repository's `.venv` interpreter so Pylance resolves Flask and python-dotenv correctly.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test tests/api.test.mjs
```

With Flask running, exercise the real pages in headless Chrome using fixture API responses (no live
backend or database needed):

```powershell
node tests/browser-smoke.cjs http://127.0.0.1:5000
```

Use Node 22.7+ for the JavaScript checks. The browser runner uses Chrome's standard Windows
installation path; set `BROWSER_PATH` if yours differs or you use another OS. Tests cover shopper
selection/navigation, request validation and cancellation, pagination, loading/errors, drawer
controls, star ratings, and responsive layout. Fixtures test UI behavior, not deployed
recommendation quality.

## Deployment

The editable layout follows Flask conventions: `app.py`, `templates/`, and `static/` at the
repository root, with shared HTML fragments in `templates/components/`. Local Flask serves `static/`
automatically; there is no local build step.

Vercel's
[Flask static assets](https://vercel.com/docs/frameworks/backend/flask#serving-static-assets)
requires CDN assets in `public/`. `vercel.json` keeps the Flask framework preset and runs
`python build.py` during deployment to copy `static/` into `public/static/`. Browser URLs stay
`/static/app.js`, `/static/css/...`, and `/static/scripts/...` on both hosts. `app.py` remains the
deployment entry point.

`public/` is generated output and ignored by Git. Only edit files in `static/`; there is no second
editable asset tree. The copy step uses Python's standard library, with no npm dependencies or
JavaScript compilation. A clean deployment regenerates the output from the checked-in sources. You
can inspect it locally with `python build.py`, but Flask does not need it.

Set `API_BASE_URL=https://amozon-backend-tg7x.onrender.com` in Vercel's environment for each
deployment environment you use (such as Production and Preview), then redeploy. Vercel must provide
this variable; the ignored local `.env` is not part of deployment. The repository no longer supplies
a default backend URL. Serve the site through Flask/Vercel, rather than opening HTML files directly,
because templates and JavaScript modules require HTTP serving.
