"""Storefront routes: immediate page shells and browser-fetched sections."""

from django.urls import path
from . import views

urlpatterns = [
    path('sections/<str:name>/', views.section, name='store-section'),
    path('', views.home, name='home'),
    path('product/<str:item_id>/', views.product, name='product')
]