import uuid

from django.db import models


class Workspace(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    demo_seeded = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class Meeting(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="meetings")
    title = models.CharField(max_length=160)
    meeting_date = models.DateField()
    notes = models.TextField()
    import_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-meeting_date", "-created_at"]
        constraints = [models.UniqueConstraint(fields=["workspace", "import_hash"], name="unique_workspace_import")]


class Suggestion(models.Model):
    class Kind(models.TextChoices):
        ACTION = "ACTION"
        DECISION = "DECISION"

    class ReviewState(models.TextChoices):
        PENDING = "PENDING"
        ACCEPTED = "ACCEPTED"
        REJECTED = "REJECTED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="suggestions")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    title = models.CharField(max_length=160)
    owner = models.CharField(max_length=80, blank=True)
    due_date = models.DateField(null=True, blank=True)
    source_line = models.PositiveIntegerField()
    source_quote = models.TextField()
    review_state = models.CharField(max_length=8, choices=ReviewState.choices, default=ReviewState.PENDING)

    class Meta:
        ordering = ["source_line"]
        constraints = [models.UniqueConstraint(fields=["meeting", "source_line"], name="unique_meeting_source_line")]


class Task(models.Model):
    class Status(models.TextChoices):
        TODO = "TODO"
        IN_PROGRESS = "IN_PROGRESS"
        DONE = "DONE"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    suggestion = models.OneToOneField(Suggestion, on_delete=models.CASCADE, related_name="task")
    title = models.CharField(max_length=160)
    owner = models.CharField(max_length=80, blank=True)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=11, choices=Status.choices, default=Status.TODO)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "id"]
