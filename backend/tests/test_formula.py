import math

import pytest

from app.engine.formula import FormulaError, UndefinedValue, compile_formula, evaluate


def ev(src, **values):
    return evaluate(compile_formula(src), values)


def test_basic_arithmetic_and_symbols():
    c = compile_formula("(E - EV) / P * 1000")
    assert c.symbols == {"E", "EV", "P"}
    assert ev("(E - EV) / P * 1000", E=1200, EV=200, P=500) == pytest.approx(2000.0)


def test_power_operator_accepts_caret():
    assert ev("E ^ 2", E=3) == 9


def test_functions_and_conditional():
    assert ev("min(A, B)", A=3, B=7) == 3
    assert ev("se(P > 0, E / P, 0)", P=0, E=10) == 0
    assert ev("sqrt(X)", X=16) == 4


def test_division_by_zero_is_undefined_not_zero():
    with pytest.raises(UndefinedValue) as exc:
        ev("E / P", E=100, P=0)
    assert "divisão por zero" in str(exc.value)


def test_missing_value_is_undefined():
    with pytest.raises(UndefinedValue) as exc:
        ev("E / P", E=100, P=None)
    assert "sem dados" in str(exc.value)


@pytest.mark.parametrize(
    "src",
    [
        "__import__('os').system('dir')",
        "E.__class__",
        "open('x')",
        "lambda: 1",
        "[1, 2]",
        "{'a': 1}",
        "E if P else 0",
        "E; P",
        "print(E)",
    ],
)
def test_unsafe_expressions_are_rejected(src):
    with pytest.raises(FormulaError):
        compile_formula(src)


def test_empty_and_syntax_errors():
    with pytest.raises(FormulaError):
        compile_formula("")
    with pytest.raises(FormulaError):
        compile_formula("E /")


def test_overflow_is_undefined():
    with pytest.raises(UndefinedValue):
        ev("E ^ 11", E=10)
    assert not math.isnan(ev("E ^ 2", E=10))
