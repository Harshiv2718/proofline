from datetime import date

from django.test import SimpleTestCase

from followthrough.parser import InputError, parse_notes


class ParserTests(SimpleTestCase):
    def test_preserves_exact_source_line_and_line_number(self):
        quote = "  - ACTION [Maya] Ship export | due:2026-11-12  "
        item = parse_notes("Discussion\n\n" + quote)[0]
        self.assertEqual((item.kind, item.title, item.owner, item.due_date), ("ACTION", "Ship export", "Maya", date(2026, 11, 12)))
        self.assertEqual((item.source_line, item.source_quote), (3, quote))

    def test_handles_ownerless_action_and_decision(self):
        items = parse_notes("ACTION: Add keyboard controls\r\n* DECISION: Start with CSV")
        self.assertEqual([(item.kind, item.title, item.owner, item.due_date) for item in items], [
            ("ACTION", "Add keyboard controls", "", None), ("DECISION", "Start with CSV", "", None)
        ])

    def test_does_not_infer_from_prose_lowercase_or_incomplete_markers(self):
        self.assertEqual(parse_notes("Maya will ship Friday\naction [Maya] Ship\nWe discussed ACTION: Ship\nACTION [Maya]\nDECISION:"), [])

    def test_rejects_invalid_iso_dates_and_metadata(self):
        for marker in ["2026-02-30", "tomorrow", "20261112", "2026-1-2", "", " 2026-11-12"]:
            with self.subTest(marker=marker), self.assertRaises(InputError):
                parse_notes(f"ACTION [Maya] Ship | due:{marker}")
        with self.assertRaises(InputError):
            parse_notes("ACTION: Ship | priority:high")

    def test_rejects_oversized_title_owner_and_suggestion_count(self):
        for notes in ["ACTION: " + "x" * 161, "ACTION [" + "x" * 81 + "] Ship", "\n".join(["ACTION: Ship"] * 101)]:
            with self.subTest(notes=notes[:80]), self.assertRaises(InputError):
                parse_notes(notes)

    def test_allows_exact_limits(self):
        self.assertEqual(len(parse_notes("\n".join(["ACTION [" + "x" * 80 + "] " + "y" * 160] * 100))), 100)
