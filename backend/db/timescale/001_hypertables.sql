-- Executado automaticamente por app.db.init_db() quando o banco é PostgreSQL com TimescaleDB.
-- Idempotente: pode rodar a cada inicialização.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Séries temporais brutas (qualquer granularidade: 1 min, 15 min, 1 h, 1 dia).
SELECT create_hypertable('measurement', by_range('ts', INTERVAL '30 days'),
                         if_not_exists => TRUE, migrate_data => TRUE);

-- Valores de indicadores materializados pelo worker de cálculo.
SELECT create_hypertable('indicator_value', by_range('period_start', INTERVAL '180 days'),
                         if_not_exists => TRUE, migrate_data => TRUE);

-- Compressão de dados antigos (economia de 90%+ em séries industriais).
ALTER TABLE measurement SET (timescaledb.compress, timescaledb.compress_segmentby = 'variable_id');
SELECT add_compression_policy('measurement', INTERVAL '90 days', if_not_exists => TRUE);

-- Agregado contínuo diário: base de todos os cálculos de período.
-- (count permite medir completude; dado ausente não vira zero.)
CREATE MATERIALIZED VIEW IF NOT EXISTS measurement_daily
WITH (timescaledb.continuous) AS
SELECT variable_id,
       time_bucket(INTERVAL '1 day', ts) AS day,
       sum(value)  AS v_sum,
       avg(value)  AS v_avg,
       min(value)  AS v_min,
       max(value)  AS v_max,
       last(value, ts) AS v_last,
       count(value) AS n_valid,
       count(*) FILTER (WHERE quality IN ('bad', 'suspect')) AS n_bad
FROM measurement
GROUP BY variable_id, time_bucket(INTERVAL '1 day', ts)
WITH NO DATA;

SELECT add_continuous_aggregate_policy('measurement_daily',
       start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour',
       schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE);
