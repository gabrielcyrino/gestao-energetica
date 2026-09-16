"""Conversão de unidades dentro da mesma grandeza (energy, mass, time, volume...)."""
from __future__ import annotations

from dataclasses import dataclass


class UnitError(ValueError):
    pass


@dataclass(frozen=True)
class UnitInfo:
    id: int
    symbol: str
    quantity: str
    factor_to_base: float
    offset_to_base: float = 0.0


def convert(value: float, src: UnitInfo, dst: UnitInfo) -> float:
    if src.id == dst.id:
        return value
    if src.quantity != dst.quantity:
        raise UnitError(f"Não é possível converter {src.symbol} ({src.quantity}) em {dst.symbol} ({dst.quantity}).")
    base = value * src.factor_to_base + src.offset_to_base
    return (base - dst.offset_to_base) / dst.factor_to_base


def conversion_factor(src: UnitInfo, dst: UnitInfo) -> float:
    """Fator multiplicativo (válido para grandezas sem offset)."""
    if src.offset_to_base or dst.offset_to_base:
        raise UnitError("Conversão com offset não é multiplicativa.")
    return convert(1.0, src, dst)
