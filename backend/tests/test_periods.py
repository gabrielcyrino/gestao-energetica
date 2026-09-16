from datetime import date

import pytest

from app.engine.periods import (
    NamedRange,
    PeriodContext,
    PeriodError,
    auto_grain,
    bucket_label,
    iter_buckets,
)

CROPS = [
    NamedRange("CY2025", "Crop Year 2025", date(2024, 9, 1), date(2025, 8, 31)),
    NamedRange("CY2026", "Crop Year 2026", date(2025, 9, 1), date(2026, 8, 31)),
    NamedRange("CY2027", "Crop Year 2027", date(2026, 9, 1), date(2027, 8, 31)),
]
SEASONS = [
    NamedRange("SV2025", "Safra Verão 2025", date(2025, 1, 15), date(2025, 6, 10), "verao"),
    NamedRange("SF2025", "Safrinha 2025", date(2025, 6, 11), date(2025, 9, 15), "safrinha"),
    NamedRange("SV2026", "Safra Verão 2026", date(2026, 1, 15), date(2026, 6, 10), "verao"),
    NamedRange("SF2026", "Safrinha 2026", date(2026, 6, 11), date(2026, 9, 15), "safrinha"),
]


@pytest.fixture
def ctx():
    return PeriodContext(CROPS, SEASONS, date(2023, 9, 1), date(2026, 9, 14))


def test_week_month_year_parsing(ctx):
    w = ctx.resolve("week:2026-W32")
    assert (w.start, w.end) == (date(2026, 8, 3), date(2026, 8, 9))
    assert "Semana 32/2026" in w.label
    m = ctx.resolve("month:2026-08")
    assert (m.start, m.end) == (date(2026, 8, 1), date(2026, 8, 31))
    assert ctx.resolve("year:2025").days == 365


def test_previous_week_month_year(ctx):
    assert ctx.previous(ctx.resolve("week:2026-W32")).spec == "week:2026-W31"
    assert ctx.previous(ctx.resolve("month:2026-01")).spec == "month:2025-12"
    assert ctx.previous(ctx.resolve("year:2026")).spec == "year:2025"


def test_crop_year_is_not_calendar_year(ctx):
    cy = ctx.resolve("crop_year:CY2026")
    assert (cy.start, cy.end) == (date(2025, 9, 1), date(2026, 8, 31))
    assert ctx.previous(cy).spec == "crop_year:CY2025"


def test_season_previous_is_same_season_type(ctx):
    """Safrinha 2026 compara com Safrinha 2025 — não com a Safra Verão imediatamente anterior."""
    assert ctx.previous(ctx.resolve("season:SF2026")).spec == "season:SF2025"
    assert ctx.previous(ctx.resolve("season:SV2026")).spec == "season:SV2025"


def test_custom_previous_has_same_length(ctx):
    p = ctx.resolve("custom:2026-03-01..2026-03-10")
    prev = ctx.previous(p)
    assert (prev.start, prev.end) == (date(2026, 2, 19), date(2026, 2, 28))
    assert prev.days == p.days


def test_partial_period_is_clipped_and_comparison_aligned(ctx):
    cur = ctx.resolve("month:2026-09")
    assert cur.partial and cur.eff_end == date(2026, 9, 14)
    prev = ctx.comparison(cur, "prev")
    assert prev.aligned and prev.eff_end == date(2026, 8, 14)
    assert prev.days == cur.days


def test_year_over_year(ctx):
    assert ctx.year_over_year(ctx.resolve("month:2026-08")).spec == "month:2025-08"
    assert ctx.year_over_year(ctx.resolve("week:2026-W32")).spec == "week:2025-W32"


def test_unknown_crop_year_raises(ctx):
    with pytest.raises(PeriodError):
        ctx.resolve("crop_year:CY2099")
    with pytest.raises(PeriodError):
        ctx.resolve("banana:2026")


def test_options_lists_only_periods_with_data(ctx):
    opts = ctx.options()
    assert opts["default"] == "month:2026-08"
    assert [c["spec"] for c in opts["crop_year"]][0] == "crop_year:CY2027"
    assert all(s["season_type"] in ("verao", "safrinha") for s in opts["season"])


def test_buckets_and_grain():
    assert auto_grain(date(2026, 8, 1), date(2026, 8, 31)) == "day"
    assert auto_grain(date(2026, 1, 1), date(2026, 8, 31)) == "week"
    assert auto_grain(date(2024, 1, 1), date(2026, 8, 31)) == "month"
    weeks = iter_buckets(date(2026, 8, 1), date(2026, 8, 31), "week")
    assert weeks[0] == (date(2026, 8, 1), date(2026, 8, 2))  # bucket recortado no início
    assert bucket_label(date(2026, 8, 3), "week") == "S32/26"
    assert len(iter_buckets(date(2026, 1, 1), date(2026, 12, 31), "month")) == 12
