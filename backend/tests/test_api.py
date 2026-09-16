"""API: autenticação, perfis, cadastro de indicador sem alterar código, comparações e ingestão."""
import io

P = "month:2026-08"


def test_requires_authentication(client):
    assert client.get("/api/hierarchy/tree").status_code == 401
    assert client.get("/health").status_code == 200


def test_login_and_profile(client, auth):
    h = auth("dono.recebimento")
    me = client.get("/api/auth/me", headers=h).json()
    assert me["role"] == "process_owner"
    assert me["scope_paths"], "dono de processo precisa de escopo"
    assert client.post("/api/auth/login", json={"username": "energia", "password": "x"}).status_code == 401


def test_viewer_cannot_write(client, auth):
    h = auth("visualizador")
    r = client.post("/api/opportunities", headers=h, json={
        "title": "teste", "node_id": 5, "problem": "x", "opportunity": "y"})
    assert r.status_code == 403


def test_process_owner_scope_is_enforced(client, auth):
    h = auth("dono.recebimento")
    torre = client.get("/api/nodes?level=area", headers=h).json()
    torre_id = next(n["id"] for n in torre if n["code"] == "torre")
    rec_id = next(n["id"] for n in torre if n["code"] == "recebimento")
    ok = client.post("/api/opportunities", headers=h, json={
        "title": "Oportunidade no escopo", "node_id": rec_id, "problem": "p", "opportunity": "o"})
    assert ok.status_code == 201
    denied = client.post("/api/opportunities", headers=h, json={
        "title": "Fora do escopo", "node_id": torre_id, "problem": "p", "opportunity": "o"})
    assert denied.status_code == 403


def test_hierarchy_tree_has_areas_and_processes(client, auth):
    tree = client.get("/api/hierarchy/tree", headers=auth()).json()
    plant = tree[0]["children"][0]
    areas = {a["name"]: a for a in plant["children"]}
    assert set(areas) == {"Recebimento", "Torre"}
    assert [p["name"] for p in areas["Recebimento"]["children"]] == ["Despalha", "Debulha", "Secador", "Caldeira"]
    assert [p["name"] for p in areas["Torre"]["children"]] == ["Limpeza", "Classificação", "Tratamento", "Ensaque"]
    assert areas["Torre"]["indicators"] > 0


def test_flow_has_process_nodes_and_energy_stream(client, auth):
    h = auth()
    rec_id = next(n["id"] for n in client.get("/api/nodes?level=area", headers=h).json() if n["code"] == "recebimento")
    flow = client.get(f"/api/nodes/{rec_id}/flow?period={P}&compare=prev", headers=h).json()
    labels = [n["label"] for n in flow["nodes"]]
    assert {"Despalha", "Debulha", "Secador", "Caldeira"} <= set(labels)
    energy_edges = [e for e in flow["edges"] if e["stream_type"] == "energy"]
    assert any(e["label"] == "Vapor" for e in energy_edges)
    process_nodes = [n for n in flow["nodes"] if n["kind"] == "process"]
    assert all(n["metrics"]["status_counts"] is not None for n in process_nodes)
    assert any(n["linked_node"] for n in flow["nodes"]), "deve haver ligação para a outra área"


def test_period_comparisons(client, auth):
    h = auth()
    for spec, compare in [("week:2026-W32", "prev"), ("month:2026-08", "prev"), ("year:2026", "prev"),
                          ("crop_year:CY2026", "prev"), ("season:SF2026", "prev"),
                          ("custom:2026-08-01..2026-08-15", "prev"), ("month:2026-08", "yoy")]:
        r = client.get(f"/api/compare?period={spec}&compare={compare}", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["period"]["spec"] == spec
        assert body["energy"]["current"]["energy_mwh"] > 0
        assert body["indicators"]
    sf = client.get("/api/compare?period=season:SF2026&compare=prev", headers=h).json()
    assert sf["comparison_period"]["spec"] == "season:SF2025"


def test_partial_period_comparison_is_aligned(client, auth):
    r = client.get("/api/periods/resolve?spec=month:2026-09&compare=prev", headers=auth()).json()
    assert r["current"]["partial"] and r["previous"]["aligned"]
    assert r["current"]["days"] == r["previous"]["days"]


def test_dashboard_overview(client, auth):
    d = client.get(f"/api/dashboard/overview?period={P}&compare=prev", headers=auth()).json()
    assert {a["node"]["name"] for a in d["areas"]} == {"Recebimento", "Torre"}
    assert len(d["processes"]) == 8
    assert d["energy"]["current"]["energy_mwh"] > 0
    assert sum(d["status_counts"].values()) == d["indicator_count"]
    assert d["off_target"] and d["worsening"] and d["improving"]
    assert d["intensity_heatmap"][0]["cells"]


def test_drilldown_chain(client, auth):
    """Recebimento → Secador → USE de ventilação → motor → indicador → histórico."""
    h = auth()
    rec = next(n for n in client.get("/api/nodes?level=area", headers=h).json() if n["code"] == "recebimento")
    node = client.get(f"/api/nodes/{rec['id']}", headers=h).json()
    secador = next(c for c in node["children"] if c["name"] == "Secador")
    uses = client.get(f"/api/uses?node_id={secador['id']}", headers=h).json()
    ven = next(u for u in uses if "ventilação" in u["name"].lower())
    use_detail = client.get(f"/api/uses/{ven['id']}?period={P}&compare=prev", headers=h).json()
    motor = next(e for e in use_detail["use"]["equipment"] if e["tag"].endswith("VEN-01"))
    eq = client.get(f"/api/equipment/{motor['id']}?period={P}&compare=prev", headers=h).json()
    kwht = next(i for i in eq["indicators"] if i["code"].endswith("KWHT"))
    assert kwht["unit"] == "kWh/t"
    hist = client.get(f"/api/indicators/{kwht['id']}/history?period={P}&grain=week&window=26", headers=h).json()
    assert len(hist["points"]) == 26
    assert hist["trend"]["classification"]
    detail = client.get(f"/api/indicators/{kwht['id']}?period={P}&compare=prev", headers=h).json()
    assert [p["name"] for p in detail["indicator"]["path"]][-2:] == ["Recebimento", "Secador"]


def test_create_indicator_without_touching_code(client, auth):
    """Critério de aceitação: novo indicador cadastrado pela aplicação já é calculado e listado."""
    h = auth()
    vars_ = client.get("/api/variables?node_id=7", headers=h).json()
    energy = next(v for v in vars_ if v["code"] == "REC-SEC.EAT")
    water = next(v for v in vars_ if v["code"] == "REC-SEC.AGUA")
    units = client.get("/api/catalogs/units", headers=h).json()
    unit = next(u for u in units if u["symbol"] == "kWh/t")
    payload = {
        "code": "IDE-TESTE-AGUA", "name": "Energia elétrica por água evaporada", "kind": "extrinsic",
        "category": "intensidade", "node_id": energy["node"]["id"], "formula": "E / W", "unit_id": unit["id"],
        "direction": "lower_better", "decimals": 2,
        "bindings": [
            {"symbol": "E", "source_type": "variable", "variable_id": energy["id"]},
            {"symbol": "W", "source_type": "variable", "variable_id": water["id"]},
        ],
        "targets": [{"valid_from": "2023-09-01", "target_value": 40.0, "baseline_value": 42.0, "scope": "all"}],
    }
    check = client.post("/api/indicators/validate", headers=h,
                        json={"formula": payload["formula"], "bindings": payload["bindings"]}).json()
    assert check["valid"]
    preview = client.post("/api/indicators/preview", headers=h, json={**payload, "period": P}).json()
    assert preview["evaluation"]["value"] > 0

    created = client.post("/api/indicators", headers=h, json=payload)
    assert created.status_code == 201, created.text
    new_id = created.json()["id"]
    ev = client.get(f"/api/indicators/{new_id}?period={P}&compare=prev", headers=h).json()
    assert ev["current"]["value"] == preview["evaluation"]["value"]
    assert ev["current"]["status"] in ("normal", "atencao", "critico")
    listed = client.get(f"/api/indicators?node_id={payload['node_id']}&period={P}", headers=h).json()
    assert new_id in [i["id"] for i in listed["items"]]
    client.delete(f"/api/indicators/{new_id}", headers=h)


def test_invalid_formula_is_rejected(client, auth):
    h = auth()
    r = client.post("/api/indicators/validate", headers=h, json={"formula": "__import__('os')", "bindings": []})
    assert r.json()["valid"] is False
    bad = client.post("/api/indicators", headers=h, json={
        "code": "IDE-BAD", "name": "ruim", "kind": "extrinsic", "node_id": 5, "formula": "A / B",
        "unit_id": 1, "bindings": [{"symbol": "A", "source_type": "constant", "constant_value": 1}]})
    assert bad.status_code == 422 and "sem vínculo" in bad.json()["detail"]


def test_create_area_and_process_appears_in_tree(client, auth):
    """Critério de aceitação: nova área sem reconstruir a aplicação."""
    h = auth("admin")
    plant = next(n for n in client.get("/api/nodes?level=plant", headers=h).json())
    area = client.post("/api/nodes", headers=h, json={
        "code": "teste.area", "name": "Área de Teste", "level": "area", "parent_id": plant["id"], "sort_order": 9})
    assert area.status_code == 201
    area_id = area.json()["id"]
    proc = client.post("/api/nodes", headers=h, json={
        "code": "teste.area.p1", "name": "Etapa 1", "level": "process", "parent_id": area_id})
    assert proc.status_code == 201
    tree = client.get("/api/hierarchy/tree", headers=h).json()
    names = [a["name"] for a in tree[0]["children"][0]["children"]]
    assert "Área de Teste" in names
    flow = client.get(f"/api/nodes/{area_id}/flow?metrics=false", headers=h).json()
    assert flow["auto_generated"] and flow["nodes"][0]["label"] == "Etapa 1"
    client.delete(f"/api/nodes/{proc.json()['id']}", headers=h)
    client.delete(f"/api/nodes/{area_id}", headers=h)


def test_matrices(client, auth):
    h = auth()
    m = client.get(f"/api/matrix/process-use?period={P}", headers=h).json()
    assert len(m["rows"]) == 8 and m["categories"]
    rec_row = next(r for r in m["rows"] if r["node"]["name"] == "Caldeira")
    assert "caldeira" in rec_row["cells"]
    full = client.get(f"/api/matrix/indicators?period={P}&compare=prev", headers=h).json()
    row = full["items"][0]
    assert {"formula", "unit", "responsible", "data_sources", "bindings"} <= set(row)


def test_trends_endpoint_classifies(client, auth):
    t = client.get(f"/api/trends?period={P}&grain=week&window=26&limit=30", headers=auth()).json()
    assert t["items"] and t["counts"]["deterioracao"] >= 1
    assert t["items"][0]["trend"]["classification"] == "deterioracao"
    assert t["items"][0]["series"]


def test_baseline_observed_vs_expected(client, auth):
    h = auth()
    bls = client.get("/api/baselines", headers=h).json()
    sec = next(b for b in bls if b["code"] == "BL-SEC-TER")
    assert sec["model"]["r2"] > 0.8
    ev = client.get(f"/api/baselines/{sec['id']}/evaluate?period={P}&grain=week", headers=h).json()
    assert ev["total_expected"] > 0 and ev["points"]
    assert ev["savings"] > 0, "após o retrofit o observado deve ficar abaixo do esperado pela baseline"


def test_data_quality_reports_missing_days(client, auth):
    h = auth()
    q = client.get(f"/api/variables/quality?period={P}", headers=h).json()
    worst = q["items"][0]
    assert worst["completeness_pct"] < 100
    assert worst["expected_days"] == 31


def test_csv_ingestion_rejects_blank_values(client, auth):
    h = auth()
    var = client.get("/api/variables?node_id=7", headers=h).json()[0]
    csv = f"variable_code;ts;value;quality\n{var['code']};2026-09-14T00:00:00;123,5;good\n" \
          f"{var['code']};2026-09-14T00:00:00;;good\nINEXISTENTE;2026-09-14T00:00:00;1;good\n"
    r = client.post("/api/ingestion/csv", headers=h,
                    files={"file": ("dados.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["rows_ok"] == 1 and rep["rows_rejected"] == 2
    assert any("não é convertido em zero" in e["error"] for e in rep["errors"])
    assert any("não cadastrada" in e["error"] for e in rep["errors"])


def test_openapi_is_documented(client):
    spec = client.get("/openapi.json").json()
    assert spec["info"]["title"]
    assert "/api/indicators" in spec["paths"]
    assert len(spec["paths"]) > 30
