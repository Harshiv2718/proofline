import functools

import graphene
from graphql import GraphQLError

from . import services
from .models import Task


def handle_errors(function):
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except services.ServiceError as exc:
            raise GraphQLError(str(exc), extensions={"code": exc.code}) from exc
    return wrapped


class SuggestionKind(graphene.Enum):
    ACTION = "ACTION"
    DECISION = "DECISION"


class ReviewState(graphene.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class ReviewDecision(graphene.Enum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"


class TaskStatus(graphene.Enum):
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"


class SuggestionType(graphene.ObjectType):
    id = graphene.ID(required=True)
    kind = graphene.Field(SuggestionKind, required=True)
    title = graphene.String(required=True)
    owner = graphene.String(required=True)
    due_date = graphene.Date()
    source_line = graphene.Int(required=True)
    source_quote = graphene.String(required=True)
    review_state = graphene.Field(ReviewState, required=True)
    task_id = graphene.ID()

    def resolve_kind(root, info):
        return str(root.kind)

    def resolve_review_state(root, info):
        return str(root.review_state)

    def resolve_task_id(root, info):
        try:
            return root.task.id
        except Task.DoesNotExist:
            return None


class MeetingType(graphene.ObjectType):
    id = graphene.ID(required=True)
    title = graphene.String(required=True)
    meeting_date = graphene.Date(required=True)
    notes = graphene.String(required=True)
    created_at = graphene.DateTime(required=True)
    suggestions = graphene.List(graphene.NonNull(SuggestionType), required=True)

    def resolve_suggestions(root, info):
        return root.suggestions.all()


class TaskType(graphene.ObjectType):
    id = graphene.ID(required=True)
    title = graphene.String(required=True)
    owner = graphene.String(required=True)
    due_date = graphene.Date()
    status = graphene.Field(TaskStatus, required=True)
    version = graphene.Int(required=True)
    meeting_id = graphene.ID(required=True)
    meeting_title = graphene.String(required=True)
    suggestion_id = graphene.ID(required=True)
    source_line = graphene.Int(required=True)
    source_quote = graphene.String(required=True)
    updated_at = graphene.DateTime(required=True)

    def resolve_status(root, info):
        return str(root.status)

    def resolve_meeting_id(root, info):
        return root.suggestion.meeting_id

    def resolve_meeting_title(root, info):
        return root.suggestion.meeting.title

    def resolve_source_line(root, info):
        return root.suggestion.source_line

    def resolve_source_quote(root, info):
        return root.suggestion.source_quote


class MetricsType(graphene.ObjectType):
    total_tasks = graphene.Int(required=True)
    done_tasks = graphene.Int(required=True)
    overdue_tasks = graphene.Int(required=True)
    completion_rate = graphene.Float(required=True)
    review_rate = graphene.Float(required=True)
    pending_suggestions = graphene.Int(required=True)
    meetings_count = graphene.Int(required=True)
    as_of = graphene.Date(required=True)


class DashboardType(graphene.ObjectType):
    meetings = graphene.List(graphene.NonNull(MeetingType), required=True)
    tasks = graphene.List(graphene.NonNull(TaskType), required=True)
    metrics = graphene.Field(MetricsType, required=True)


class Query(graphene.ObjectType):
    dashboard = graphene.Field(DashboardType, required=True)

    @handle_errors
    def resolve_dashboard(root, info):
        return services.dashboard(services.get_workspace(info.context))


class ImportMeeting(graphene.Mutation):
    class Arguments:
        title = graphene.String(required=True)
        notes = graphene.String(required=True)
        meeting_date = graphene.Date(required=True)

    meeting = graphene.Field(MeetingType, required=True)
    duplicate = graphene.Boolean(required=True)

    @handle_errors
    def mutate(root, info, title, notes, meeting_date):
        meeting, duplicate = services.import_meeting(services.get_workspace(info.context), title, notes, meeting_date)
        return ImportMeeting(meeting=meeting, duplicate=duplicate)


class ReviewSuggestion(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        decision = graphene.Argument(ReviewDecision, required=True)
        title = graphene.String()
        owner = graphene.String()
        due_date = graphene.Date()

    suggestion = graphene.Field(SuggestionType, required=True)
    task = graphene.Field(TaskType)

    @handle_errors
    def mutate(root, info, id, decision, **edits):
        suggestion, task = services.review_suggestion(services.get_workspace(info.context), id, decision.value, **edits)
        return ReviewSuggestion(suggestion=suggestion, task=task)


class UpdateTask(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        status = graphene.Argument(TaskStatus, required=True)
        expected_version = graphene.Int(required=True)

    task = graphene.Field(TaskType, required=True)

    @handle_errors
    def mutate(root, info, id, status, expected_version):
        task = services.update_task(services.get_workspace(info.context), id, status.value, expected_version)
        return UpdateTask(task=task)


class SeedDemo(graphene.Mutation):
    dashboard = graphene.Field(DashboardType, required=True)

    @handle_errors
    def mutate(root, info):
        return SeedDemo(dashboard=services.seed_demo(services.get_workspace(info.context)))


class Mutation(graphene.ObjectType):
    import_meeting = ImportMeeting.Field()
    review_suggestion = ReviewSuggestion.Field()
    update_task = UpdateTask.Field()
    seed_demo = SeedDemo.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)
