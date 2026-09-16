"""Avaliador seguro de fórmulas de indicadores.

As fórmulas são cadastradas como texto (ex.: "E / M", "(E - EV) / HOP", "E * eta / (Pn * H) * 100")
e avaliadas sobre uma árvore sintática restrita (sem eval/exec, sem atributos, sem imports).
Divisão por zero e símbolos sem dados produzem valor indefinido com motivo explícito —
nunca zero silencioso.
"""
from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass, field

MAX_FORMULA_LENGTH = 400
MAX_DEPTH = 32
SYMBOL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,29}$")


class FormulaError(ValueError):
    """Fórmula inválida (erro de cadastro)."""


class UndefinedValue(ArithmeticError):
    """Resultado indefinido em tempo de cálculo (ex.: produção zero)."""


def _if(cond, a, b):
    return a if cond else b


FUNCTIONS: dict[str, tuple[callable, str]] = {
    "min": (min, "menor valor entre argumentos"),
    "max": (max, "maior valor entre argumentos"),
    "abs": (abs, "valor absoluto"),
    "sqrt": (math.sqrt, "raiz quadrada"),
    "log": (math.log, "logaritmo natural"),
    "exp": (math.exp, "exponencial"),
    "round": (round, "arredondamento"),
    "se": (_if, "se(condição, valor_se_verdadeiro, valor_se_falso)"),
}
RESERVED = set(FUNCTIONS) | {"True", "False", "None"}

_BIN_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: None,  # tratado à parte (divisão por zero)
    ast.Pow: None,  # tratado à parte (limites)
}
_CMP_OPS = {
    ast.Gt: lambda a, b: a > b,
    ast.GtE: lambda a, b: a >= b,
    ast.Lt: lambda a, b: a < b,
    ast.LtE: lambda a, b: a <= b,
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
}


@dataclass
class CompiledFormula:
    source: str
    tree: ast.Expression
    symbols: set[str] = field(default_factory=set)


def compile_formula(source: str) -> CompiledFormula:
    source = (source or "").strip()
    if not source:
        raise FormulaError("Fórmula vazia.")
    if len(source) > MAX_FORMULA_LENGTH:
        raise FormulaError(f"Fórmula excede {MAX_FORMULA_LENGTH} caracteres.")
    try:
        tree = ast.parse(source.replace("^", "**"), mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"Erro de sintaxe na posição {exc.offset}: {exc.msg}") from None

    symbols: set[str] = set()

    def visit(node: ast.AST, depth: int) -> None:
        if depth > MAX_DEPTH:
            raise FormulaError("Fórmula excessivamente aninhada.")
        match node:
            case ast.Expression(body=body):
                visit(body, depth + 1)
            case ast.Constant(value=v):
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    raise FormulaError(f"Constante não numérica: {v!r}")
            case ast.Name(id=name):
                if name in RESERVED:
                    raise FormulaError(f"'{name}' é uma função, não um símbolo.")
                if not SYMBOL_RE.match(name):
                    raise FormulaError(f"Símbolo inválido: {name}")
                symbols.add(name)
            case ast.BinOp(left=l, op=op, right=r):
                if type(op) not in _BIN_OPS:
                    raise FormulaError(f"Operador não permitido: {type(op).__name__}")
                visit(l, depth + 1)
                visit(r, depth + 1)
            case ast.UnaryOp(op=op, operand=o):
                if not isinstance(op, (ast.USub, ast.UAdd, ast.Not)):
                    raise FormulaError("Operador unário não permitido.")
                visit(o, depth + 1)
            case ast.Compare(left=l, ops=ops, comparators=comps):
                if any(type(o) not in _CMP_OPS for o in ops):
                    raise FormulaError("Comparação não permitida.")
                visit(l, depth + 1)
                for c in comps:
                    visit(c, depth + 1)
            case ast.BoolOp(values=values):
                for v in values:
                    visit(v, depth + 1)
            case ast.Call(func=ast.Name(id=fname), args=args, keywords=kw):
                if fname not in FUNCTIONS:
                    raise FormulaError(f"Função não permitida: {fname}")
                if kw:
                    raise FormulaError("Argumentos nomeados não são permitidos.")
                if fname == "se" and len(args) != 3:
                    raise FormulaError("se() exige 3 argumentos: se(condição, a, b).")
                for a in args:
                    visit(a, depth + 1)
            case _:
                raise FormulaError(f"Elemento não permitido na fórmula: {type(node).__name__}")

    visit(tree, 0)
    return CompiledFormula(source=source, tree=tree, symbols=symbols)


def evaluate(compiled: CompiledFormula, values: dict[str, float | None]) -> float:
    """Avalia a fórmula. Lança UndefinedValue com motivo legível quando o resultado não existe."""
    missing = [s for s in sorted(compiled.symbols) if values.get(s) is None]
    if missing:
        raise UndefinedValue(f"sem dados para: {', '.join(missing)}")

    def ev(node: ast.AST):
        match node:
            case ast.Expression(body=body):
                return ev(body)
            case ast.Constant(value=v):
                return float(v)
            case ast.Name(id=name):
                return float(values[name])
            case ast.BinOp(left=l, op=ast.Div(), right=r):
                num, den = ev(l), ev(r)
                if den == 0:
                    raise UndefinedValue("divisão por zero (denominador nulo no período)")
                return num / den
            case ast.BinOp(left=l, op=ast.Pow(), right=r):
                base, expo = ev(l), ev(r)
                if abs(expo) > 10:
                    raise UndefinedValue("expoente fora do limite permitido")
                return base**expo
            case ast.BinOp(left=l, op=op, right=r):
                return _BIN_OPS[type(op)](ev(l), ev(r))
            case ast.UnaryOp(op=ast.USub(), operand=o):
                return -ev(o)
            case ast.UnaryOp(op=ast.UAdd(), operand=o):
                return ev(o)
            case ast.UnaryOp(op=ast.Not(), operand=o):
                return not ev(o)
            case ast.Compare(left=l, ops=ops, comparators=comps):
                left = ev(l)
                for op, comp in zip(ops, comps, strict=True):
                    right = ev(comp)
                    if not _CMP_OPS[type(op)](left, right):
                        return False
                    left = right
                return True
            case ast.BoolOp(op=ast.And(), values=vs):
                return all(ev(v) for v in vs)
            case ast.BoolOp(op=ast.Or(), values=vs):
                return any(ev(v) for v in vs)
            case ast.Call(func=ast.Name(id=fname), args=args):
                fn = FUNCTIONS[fname][0]
                if fname == "se":
                    return ev(args[1]) if ev(args[0]) else ev(args[2])
                try:
                    return fn(*[ev(a) for a in args])
                except (ValueError, TypeError) as exc:
                    raise UndefinedValue(f"{fname}(): {exc}") from None
        raise UndefinedValue("expressão não suportada")  # pragma: no cover

    try:
        result = ev(compiled.tree)
    except OverflowError:
        raise UndefinedValue("estouro numérico") from None
    result = float(result)
    if math.isnan(result) or math.isinf(result):
        raise UndefinedValue("resultado não numérico")
    return result
