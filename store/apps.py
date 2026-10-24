"""Register the storefront Django application."""

from django.apps import AppConfig


class StoreConfig(AppConfig):
    """Identify the store package to Django app discovery."""
    name = 'store'
