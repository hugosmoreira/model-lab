"""Exercise the real migrations in an owned, network-isolated PostgreSQL container.

No host database, port, volume, credential or operator data is used. Docker may
download the pinned public test image; PostgreSQL itself has no network access.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import threading
import time
import uuid

IMAGE = "postgres:17-alpine@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3"
ROOT = Path(__file__).resolve().parent.parent


def main():
    name = "model-lab-annotation-test-" + uuid.uuid4().hex

    def docker(*args, text=None, timeout=60):
        return subprocess.run(["docker", *args], input=text, text=True,
                              capture_output=True, timeout=timeout, check=False)

    def sql(statement, code=None):
        result = docker("exec", "-i", name, "psql", "-X", "-qAt", "-U", "postgres",
                        "-v", "ON_ERROR_STOP=1", text="\\set VERBOSITY verbose\n" + statement)
        if code is None:
            assert result.returncode == 0, result.stderr
        else:
            assert result.returncode != 0 and code in result.stderr, result.stderr
        return result.stdout.strip()

    def insert(run, note="'synthetic'", sample=1):
        return ("insert into annotations(run_id,endpoint_id,sample_index,note,author) "
                f"values ('{run}','fixture/model',{sample},{note},'fixture');")

    try:
        created = docker("run", "-d", "--rm", "--name", name, "--network", "none",
                         "--tmpfs", "/var/lib/postgresql/data", "-e",
                         "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE, timeout=180)
        assert created.returncode == 0, created.stderr
        deadline = time.monotonic() + 60
        # The image's initialization server uses only its Unix socket. Wait for
        # final TCP readiness on container loopback, not that temporary server.
        while docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres").returncode != 0:
            assert time.monotonic() < deadline, "PostgreSQL startup timed out"
            time.sleep(0.5)
        sql((ROOT / "supabase/migrations/0001_init.sql").read_text())
        sql("""
insert into providers(id,name,kind) values ('fixture','Fixture','local');
insert into model_definitions(id,family,short_name,identity_color,context_window_tokens)
  values ('fixture','fixture','fixture','#000000',1000);
insert into model_endpoints(id,model_id,provider_id,deployment)
  values ('fixture/model','fixture','fixture','local');
insert into runs(id,fingerprint,name,mode,status,pack_slug,pack_version,prompt_hash,
                 samples_per_model,model_count,budget_ceiling_usd,runner_version)
  select id,'fixture',id,'build-arena','completed','fixture','1','fixture',1,1,0,'fixture'
  from unnest(array['race','other','legacy','rollback','snapshot']) id;
insert into run_models(run_id,endpoint_id,status)
  select id,'fixture/model','completed' from runs;
insert into samples(run_id,endpoint_id,sample_index,global_index,status,score_value)
  select id,'fixture/model',1,1,'scored',8 from runs;
insert into annotations(run_id,endpoint_id,sample_index,note)
  select 'race','fixture/model',1,'old' from generate_series(1,999);
insert into annotations(run_id,endpoint_id,sample_index,note)
  select 'snapshot','fixture/model',1,'old' from generate_series(1,999);
insert into annotations(run_id,endpoint_id,sample_index,note)
  select 'legacy','fixture/model',1,'old' from generate_series(1,1002);
insert into annotations(run_id,endpoint_id,sample_index,note)
  values ('legacy','missing/old',99,repeat('x',50000));
insert into annotations(run_id,endpoint_id,sample_index,note)
  select 'restored-parent','fixture/model',1,'orphan' from generate_series(1,1001);
""")
        sql((ROOT / "supabase/migrations/0002_evaluation_integrity.sql").read_text())
        sql((ROOT / "supabase/migrations/0003_annotation_limits.sql").read_text())
        assert sql("select annotation_count from runs where id='legacy'") == "1003"
        assert sql("select octet_length(note) from annotations where endpoint_id='missing/old'") == "50000"
        sql(insert("legacy"), "ML002")
        sql(insert("rollback", sample=99), "23503")
        assert sql("select annotation_count from runs where id='rollback'") == "0"
        sql("begin;" + insert("rollback") + "rollback;")
        assert sql("select annotation_count from runs where id='rollback'") == "0"
        sql(insert("rollback", "repeat('雪',12000)"), "ML003")
        sql(insert("rollback", "repeat('雪',4000)"))
        assert sql("select annotation_count from runs where id='rollback'") == "1"
        sql(insert("missing"), "23503")
        sql("""
insert into runs(id,fingerprint,name,mode,status,pack_slug,pack_version,prompt_hash,
                 samples_per_model,model_count,budget_ceiling_usd,runner_version)
  values ('restored-parent','fixture','Restored','build-arena','completed','fixture','1','fixture',1,1,0,'fixture');
insert into run_models(run_id,endpoint_id,status) values ('restored-parent','fixture/model','completed');
insert into samples(run_id,endpoint_id,sample_index,global_index,status,score_value)
  values ('restored-parent','fixture/model',1,1,'scored',8);
""")
        assert sql("select annotation_count from runs where id='restored-parent'") == "1001"
        sql(insert("restored-parent"), "ML002")

        for run, isolation in [("race", "read committed"), ("snapshot", "repeatable read")]:
            barrier = threading.Barrier(6)

            def contender(_):
                barrier.wait(timeout=15)
                return docker("exec", "-i", name, "psql", "-X", "-qAt", "-U", "postgres",
                              "-v", "ON_ERROR_STOP=1", text=("\\set VERBOSITY verbose\n"
                              f"begin isolation level {isolation};" + insert(run) + "commit;"))

            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(contender, range(6)))
            assert sum(result.returncode == 0 for result in results) == 1, [r.stderr for r in results]
            for result in results:
                if result.returncode:
                    assert "ML002" in result.stderr or (isolation == "repeatable read" and "40001" in result.stderr), result.stderr
            assert sql(f"select count(*) from annotations where run_id='{run}'") == "1000"
            assert sql(f"select annotation_count from runs where id='{run}'") == "1000"

        sql(insert("other"))
        assert sql("select annotation_count from runs where id='other'") == "1"
        assert sql("select count(*) from samples where score_value<>8") == "0"
        print("PostgreSQL annotation migration PASS: legacy preservation, UTF-8 bounds, rollback, independent quotas, concurrent final-slot admission at two isolation levels.")
    finally:
        # The generated name refers only to this script's disposable container.
        docker("rm", "-f", name)


if __name__ == "__main__":
    main()
