"""Resolução de períodos de análise e regras de comparação.

Especificações textuais (usadas em URLs e APIs):
    day:2026-08-03            week:2026-W32           month:2026-08
    year:2026                 crop_year:CY2026        season:SV2026
    custom:2026-08-01..2026-08-31                      last:30  (últimos 30 dias com dados)

Crop Year e safra vêm do banco (datas configuráveis). Nenhum ano civil é assumido.
Períodos em andamento são recortados na última data com dados e marcados como parciais;
a comparação com o período anterior é feita em base equivalente (mesmo nº de dias decorridos).
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, replace
from datetime import date, timedelta

MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
MONTHS_PT_FULL = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]


class PeriodError(ValueError):
    pass


@dataclass(frozen=True)
class NamedRange:
    code: str
    name: str
    start: date
    end: date
    group: str | None = None  # season_type para safras


@dataclass(frozen=True)
class ResolvedPeriod:
    spec: str
    kind: str
    label: str
    short_label: str
    start: date
    end: date
    eff_start: date
    eff_end: date
    partial: bool = False
    aligned: bool = False  # recortado para base equivalente de comparação

    @property
    def days(self) -> int:
        return max(0, (self.eff_end - self.eff_start).days + 1)

    @property
    def is_empty(self) -> bool:
        return self.eff_end < self.eff_start

    def to_dict(self) -> dict:
        return {
            "spec": self.spec,
            "kind": self.kind,
            "label": self.label,
            "short_label": self.short_label,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "eff_start": self.eff_start.isoformat(),
            "eff_end": self.eff_end.isoformat(),
            "days": self.days,
            "partial": self.partial,
            "aligned": self.aligned,
        }


def _fmt(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}"


def _fmt_full(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29/02
        return d.replace(year=d.year + years, day=28)


class PeriodContext:
    def __init__(self, crop_years: list[NamedRange], seasons: list[NamedRange], data_start: date, data_end: date):
        self.crop_years = sorted(crop_years, key=lambda r: r.start)
        self.seasons = sorted(seasons, key=lambda r: r.start)
        self.data_start = data_start
        self.data_end = data_end

    # ------------------------------------------------------------------ parsing
    def resolve(self, spec: str) -> ResolvedPeriod:
        if not spec or ":" not in spec:
            raise PeriodError(f"Especificação de período inválida: {spec!r}")
        kind, key = spec.split(":", 1)
        try:
            match kind:
                case "day":
                    d = date.fromisoformat(key)
                    return self._make(spec, kind, f"Dia {_fmt_full(d)}", _fmt_full(d), d, d)
                case "week":
                    y, w = key.split("-W")
                    start = date.fromisocalendar(int(y), int(w), 1)
                    end = start + timedelta(days=6)
                    return self._make(
                        spec, kind, f"Semana {int(w)}/{y} ({_fmt(start)}–{_fmt(end)})", f"S{int(w)}/{y}", start, end
                    )
                case "month":
                    y, m = (int(x) for x in key.split("-"))
                    start, end = date(y, m, 1), month_end(y, m)
                    return self._make(
                        spec, kind, f"{MONTHS_PT_FULL[m - 1]} de {y}", f"{MONTHS_PT[m - 1]}/{y}", start, end
                    )
                case "year":
                    y = int(key)
                    return self._make(spec, kind, f"Ano {y}", str(y), date(y, 1, 1), date(y, 12, 31))
                case "crop_year":
                    r = self._find(self.crop_years, key, "Crop Year")
                    return self._make(
                        spec, kind, f"{r.name} ({_fmt_full(r.start)}–{_fmt_full(r.end)})", r.code, r.start, r.end
                    )
                case "season":
                    r = self._find(self.seasons, key, "Safra")
                    return self._make(
                        spec, kind, f"{r.name} ({_fmt_full(r.start)}–{_fmt_full(r.end)})", r.name, r.start, r.end
                    )
                case "custom":
                    a, b = key.split("..")
                    start, end = date.fromisoformat(a), date.fromisoformat(b)
                    if end < start:
                        raise PeriodError("Data final anterior à inicial.")
                    return self._make(
                        spec, kind, f"{_fmt_full(start)} a {_fmt_full(end)}", f"{_fmt(start)}–{_fmt(end)}", start, end
                    )
                case "last":
                    n = int(key)
                    if n < 1 or n > 3660:
                        raise PeriodError("Janela deve estar entre 1 e 3660 dias.")
                    end = self.data_end
                    start = end - timedelta(days=n - 1)
                    return self._make(spec, kind, f"Últimos {n} dias", f"{n}d", start, end)
        except PeriodError:
            raise
        except (ValueError, TypeError) as exc:
            raise PeriodError(f"Período inválido {spec!r}: {exc}") from None
        raise PeriodError(f"Tipo de período desconhecido: {kind}")

    def _find(self, ranges: list[NamedRange], code: str, what: str) -> NamedRange:
        for r in ranges:
            if r.code == code:
                return r
        raise PeriodError(f"{what} '{code}' não cadastrado(a).")

    def _make(self, spec, kind, label, short, start: date, end: date) -> ResolvedPeriod:
        eff_start = max(start, self.data_start)
        eff_end = min(end, self.data_end)
        partial = end > self.data_end or start < self.data_start
        return ResolvedPeriod(spec, kind, label, short, start, end, eff_start, eff_end, partial)

    # ------------------------------------------------------------------ comparação
    def previous(self, p: ResolvedPeriod) -> ResolvedPeriod:
        """Período imediatamente anterior equivalente (semana anterior, mês anterior, safra anterior do mesmo tipo)."""
        match p.kind:
            case "day":
                d = p.start - timedelta(days=1)
                return self.resolve(f"day:{d.isoformat()}")
            case "week":
                d = p.start - timedelta(days=7)
                y, w, _ = d.isocalendar()
                return self.resolve(f"week:{y}-W{w:02d}")
            case "month":
                d = p.start - timedelta(days=1)
                return self.resolve(f"month:{d.year}-{d.month:02d}")
            case "year":
                return self.resolve(f"year:{p.start.year - 1}")
            case "crop_year":
                prev = [r for r in self.crop_years if r.end < p.start]
                if not prev:
                    raise PeriodError("Não há Crop Year anterior cadastrado.")
                return self.resolve(f"crop_year:{prev[-1].code}")
            case "season":
                cur = self._find(self.seasons, p.spec.split(":", 1)[1], "Safra")
                prev = [r for r in self.seasons if r.group == cur.group and r.start < cur.start]
                if not prev:
                    raise PeriodError(f"Não há safra anterior do tipo '{cur.group}'.")
                return self.resolve(f"season:{prev[-1].code}")
            case "custom" | "last":
                length = (p.end - p.start).days + 1
                end = p.start - timedelta(days=1)
                start = end - timedelta(days=length - 1)
                return self.resolve(f"custom:{start.isoformat()}..{end.isoformat()}")
        raise PeriodError(f"Sem regra de período anterior para {p.kind}")

    def year_over_year(self, p: ResolvedPeriod) -> ResolvedPeriod:
        """Mesmo período do ano/ciclo anterior."""
        match p.kind:
            case "week":
                y, w, _ = p.start.isocalendar()
                try:
                    return self.resolve(f"week:{y - 1}-W{w:02d}")
                except PeriodError:
                    return self.resolve(f"week:{y - 1}-W52")
            case "month":
                return self.resolve(f"month:{p.start.year - 1}-{p.start.month:02d}")
            case "year" | "crop_year" | "season":
                return self.previous(p)
            case _:
                s, e = shift_year(p.start, -1), shift_year(p.end, -1)
                return self.resolve(f"custom:{s.isoformat()}..{e.isoformat()}")

    def comparison(self, a: ResolvedPeriod, compare: str | None) -> ResolvedPeriod:
        if not compare or compare == "prev":
            b = self.previous(a)
        elif compare == "yoy":
            b = self.year_over_year(a)
        else:
            b = self.resolve(compare)
        return self.align(a, b)

    def align(self, a: ResolvedPeriod, b: ResolvedPeriod) -> ResolvedPeriod:
        """Se A está em andamento, B é recortado para o mesmo número de dias decorridos."""
        if not a.partial or a.end <= self.data_end:
            return b
        elapsed = (a.eff_end - a.start).days
        eff_end = min(b.end, b.start + timedelta(days=elapsed), self.data_end)
        return replace(b, eff_end=eff_end, aligned=True)

    # ------------------------------------------------------------------ opções para seletores
    def default_spec(self) -> str:
        d = self.data_end
        if d == month_end(d.year, d.month):
            return f"month:{d.year}-{d.month:02d}"
        prev = date(d.year, d.month, 1) - timedelta(days=1)
        return f"month:{prev.year}-{prev.month:02d}"

    def options(self) -> dict:
        weeks, months, years = [], [], []
        d = self.data_end
        while True:
            y, w, _ = d.isocalendar()
            start = date.fromisocalendar(y, w, 1)
            if start + timedelta(days=6) < self.data_start:
                break
            weeks.append(self.resolve(f"week:{y}-W{w:02d}").to_dict())
            d = start - timedelta(days=1)
        y, m = self.data_end.year, self.data_end.month
        while date(y, m, 1) >= date(self.data_start.year, self.data_start.month, 1):
            months.append(self.resolve(f"month:{y}-{m:02d}").to_dict())
            y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        for yy in range(self.data_end.year, self.data_start.year - 1, -1):
            years.append(self.resolve(f"year:{yy}").to_dict())
        cys = [
            self.resolve(f"crop_year:{r.code}").to_dict()
            for r in reversed(self.crop_years)
            if r.end >= self.data_start and r.start <= self.data_end
        ]
        seasons = []
        for r in reversed(self.seasons):
            if r.end >= self.data_start and r.start <= self.data_end:
                item = self.resolve(f"season:{r.code}").to_dict()
                item["season_type"] = r.group
                seasons.append(item)
        return {
            "data_start": self.data_start.isoformat(),
            "data_end": self.data_end.isoformat(),
            "default": self.default_spec(),
            "week": weeks,
            "month": months,
            "year": years,
            "crop_year": cys,
            "season": seasons,
        }


# ---------------------------------------------------------------------- buckets temporais
def auto_grain(start: date, end: date) -> str:
    days = (end - start).days + 1
    if days <= 62:
        return "day"
    if days <= 280:
        return "week"
    return "month"


def bucket_start(d: date, grain: str) -> date:
    match grain:
        case "day":
            return d
        case "week":
            return d - timedelta(days=d.weekday())
        case "month":
            return date(d.year, d.month, 1)
        case "quarter":
            return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)
        case "year":
            return date(d.year, 1, 1)
    raise PeriodError(f"Granularidade inválida: {grain}")


def bucket_end(start: date, grain: str) -> date:
    match grain:
        case "day":
            return start
        case "week":
            return start + timedelta(days=6)
        case "month":
            return month_end(start.year, start.month)
        case "quarter":
            m = start.month + 2
            return month_end(start.year, m)
        case "year":
            return date(start.year, 12, 31)
    raise PeriodError(f"Granularidade inválida: {grain}")


def iter_buckets(start: date, end: date, grain: str) -> list[tuple[date, date]]:
    """Buckets recortados ao intervalo [start, end]."""
    out = []
    b = bucket_start(start, grain)
    while b <= end:
        e = bucket_end(b, grain)
        out.append((max(b, start), min(e, end)))
        b = e + timedelta(days=1)
    return out


def bucket_label(start: date, grain: str) -> str:
    match grain:
        case "day":
            return _fmt(start)
        case "week":
            y, w, _ = start.isocalendar()
            return f"S{w}/{str(y)[2:]}"
        case "month":
            return f"{MONTHS_PT[start.month - 1]}/{str(start.year)[2:]}"
        case "quarter":
            return f"T{(start.month - 1) // 3 + 1}/{str(start.year)[2:]}"
        case "year":
            return str(start.year)
    return start.isoformat()
