from django.conf import settings
from django.urls import path
from graphene_django.views import GraphQLView

from followthrough.views import health, session

urlpatterns = [
    path("api/session/", session),
    path("api/health/", health),
    path("graphql/", GraphQLView.as_view(graphiql=settings.DEBUG)),
]
