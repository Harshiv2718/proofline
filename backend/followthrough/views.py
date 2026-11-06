from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET

from .models import Workspace


@require_GET
def session(request):
    workspace_id = request.session.get("workspace_id")
    workspace = Workspace.objects.filter(id=workspace_id).first() if workspace_id else None
    if workspace is None:
        workspace = Workspace.objects.create()
        request.session["workspace_id"] = str(workspace.id)
    response = JsonResponse({"csrfToken": get_token(request), "workspaceId": str(workspace.id)})
    response["Cache-Control"] = "no-store"
    return response


@require_GET
def health(request):
    return JsonResponse({"status": "ok", "service": "proofline", "extractor": "deterministic-rules-v1"})
