# Amozon storefront

Amozon is a demonstration shopping website that shows how personalized product recommendations can be presented to shoppers. It is a parody of an online marketplace, with no real purchases or payments, and is not affiliated with Amazon.

## What it offers

- Select a sample shopper to explore their product recommendations.
- Browse popular products.
- Open product details, ratings, and customer reviews.

## How it works

This repository contains the website and its presentation layer. A separate FastAPI service supplies shopper IDs, products, recommendations, and reviews. The recommendation engine and its underlying database are outside this repository.

The page layout appears immediately, with moving dots while each section loads. Requests can wake the backend if its hosting service has put it to sleep. The website retries for up to two minutes before offering a **Try again** button. Successful responses with no results show an empty-state message instead.

## Current scope

This is a browsing and recommendation demo, rather than a complete commerce platform. Selecting a shopper is a demonstration feature, not a sign-in process. Products currently use illustrated category placeholders rather than product photographs.

The website requires JavaScript and an available backend to display live content. It does not cache product data or provide offline results.

For setup, deployment, and maintenance, see [the technical guide](TECHNICAL.md).
