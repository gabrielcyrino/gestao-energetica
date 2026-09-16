"""Hierarquia configurável: árvore, caminhos (breadcrumb) e subárvores."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Equipment, HierarchyNode, Indicator, SignificantEnergyUse


def recompute_path(db: Session, node: HierarchyNode) -> None:
    """Recalcula path do nó e descendentes (usar após criar/mover nó)."""
    parent = db.get(HierarchyNode, node.parent_id) if node.parent_id else None
    node.path = f"{parent.path if parent else '/'}{node.id}/"
    db.flush()
    for child in db.scalars(select(HierarchyNode).where(HierarchyNode.parent_id == node.id)):
        recompute_path(db, child)


def subtree_ids(db: Session, node: HierarchyNode) -> list[int]:
    return list(db.scalars(select(HierarchyNode.id).where(HierarchyNode.path.startswith(node.path))))


def ancestors(db: Session, node: HierarchyNode) -> list[HierarchyNode]:
    ids = [int(x) for x in node.path.strip("/").split("/") if x]
    nodes = {n.id: n for n in db.scalars(select(HierarchyNode).where(HierarchyNode.id.in_(ids)))}
    return [nodes[i] for i in ids if i in nodes]


def breadcrumb(db: Session, node: HierarchyNode) -> list[dict]:
    return [{"id": n.id, "code": n.code, "name": n.name, "level": n.level} for n in ancestors(db, node)]


def area_of(db: Session, node: HierarchyNode) -> HierarchyNode | None:
    for n in ancestors(db, node):
        if n.level == "area":
            return n
    return None


def tree(db: Session) -> list[dict]:
    nodes = list(db.scalars(select(HierarchyNode).where(HierarchyNode.active.is_(True)).order_by(HierarchyNode.sort_order)))
    use_counts = dict(db.execute(select(SignificantEnergyUse.node_id, func.count()).group_by(SignificantEnergyUse.node_id)).all())
    eq_counts = dict(
        db.execute(
            select(SignificantEnergyUse.node_id, func.count(Equipment.id))
            .join(Equipment, Equipment.use_id == SignificantEnergyUse.id)
            .group_by(SignificantEnergyUse.node_id)
        ).all()
    )
    ind_counts = dict(db.execute(select(Indicator.node_id, func.count()).where(Indicator.active.is_(True)).group_by(Indicator.node_id)).all())
    by_id = {
        n.id: {
            "id": n.id,
            "code": n.code,
            "name": n.name,
            "level": n.level,
            "parent_id": n.parent_id,
            "sort_order": n.sort_order,
            "color_slot": n.color_slot,
            "path": n.path,
            "uses": use_counts.get(n.id, 0),
            "equipment": eq_counts.get(n.id, 0),
            "indicators": ind_counts.get(n.id, 0),
            "children": [],
        }
        for n in nodes
    }
    roots = []
    for n in nodes:
        item = by_id[n.id]
        if n.parent_id and n.parent_id in by_id:
            by_id[n.parent_id]["children"].append(item)
        else:
            roots.append(item)

    def rollup(item):
        for c in item["children"]:
            rollup(c)
            for k in ("uses", "equipment", "indicators"):
                item[k] += c[k]

    for r in roots:
        rollup(r)
    return roots
