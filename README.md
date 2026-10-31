# Amozon storefront

The Flask app serves the storefront pages; the browser fetches products, reviews,
and recommendations from the FastAPI backend.

## Run locally (PowerShell)

From this repository, install dependencies with `uv sync` if needed, then run:

```powershell
$env:API_BASE_URL = "https://amozon-backend-tg7x.onrender.com"
.\.venv\Scripts\python.exe -m flask --app app run --debug
```

Open http://127.0.0.1:5000. The hosted backend may need time to wake up.
To test a local backend instead, start it on port 8000 and set
`$env:API_BASE_URL = "http://127.0.0.1:8000"` before starting Flask.
Restart Flask after changing this variable. Without an override, localhost uses
port 8000 and public storefront hosts use the hosted backend.

## Sample shoppers

`DEMO_SHOPPERS` in `public/static/app.js` owns the three fixed IDs and labels.
Shopper 1 demonstrates collaborative filtering, Shopper 2 content-based filtering,
and Shopper 3 the popularity fallback for the currently published data/models.
The picker renders locally without a discovery request. Histories and
recommendations still use the regular user endpoints, and the backend chooses
the actual recommendation engine.

After model or dataset updates, request recommendations for each configured ID
and check for the intended engine and nonempty results. Update the IDs here if
needed; arbitrary shopper IDs in page URLs remain supported.
