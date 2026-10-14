"""No SQL execution, parser, database connection or third-party dependency."""
from pathlib import Path
import re

MIGRATION = Path(__file__).resolve().parents[2] / 'migrations/20261014000000_partner_logo_verification_limiter.sql'
GLOBAL = "(select pg_catalog.count(*) from verification_private.admissions where admitted_at > v_now - interval '60 seconds') >= v_config.global_budget"
ADMIN = "(select pg_catalog.count(*) from verification_private.admissions where admin_id = p_admin_id and admitted_at > v_now - interval '60 seconds') >= v_config.admin_budget"


def check_boundary(sql):
    # Review-sensitive source assertion, deliberately exact; not a behavioral test.
    body = sql.split("as $$", 1)[1].split("$$;", 1)[0]
    body = re.sub(r'--[^\n]*', '', body)
    body = re.sub(r'\s+', ' ', body).strip()
    expected = f"if {GLOBAL} or {ADMIN} then return pg_catalog.jsonb_build_object('status', 'rate-limited'); end if;"
    assert body.count(expected) == 1, 'Actual global/admin rate enforcement changed'
    assert body.count('from verification_private.admissions where') == 3, 'Unexpected admission count/replay query'
    assert body.index('v_now := pg_catalog.clock_timestamp()') < body.index(expected), 'Clock ordering changed'


def main():
    sql = MIGRATION.read_text()
    check_boundary(sql)
    # Prove the source check rejects mutations in EACH actual budget expression.
    for expression in (GLOBAL, ADMIN):
        for before, after in (("admitted_at >", "admitted_at >="),
                              ("'60 seconds'", "'59 seconds'"),
                              ('pg_catalog.count(*)', '0'),
                              ('from verification_private.admissions', 'from verification_private.leases')):
            mutated = sql.replace(expression, expression.replace(before, after), 1)
            try:
                check_boundary(mutated)
            except AssertionError:
                pass
            else:
                raise AssertionError(f'Undetected mutation: {before} -> {after}')
    try:
        check_boundary(sql.replace('admin_id = p_admin_id and admitted_at', 'admitted_at', 1))
    except AssertionError:
        pass
    else:
        raise AssertionError('Undetected missing administrator filter')
    assert sql.index('revoke all on function') < sql.index('DO $privilege_preconditions$') < sql.index('DO $external_review_gate$') < sql.rindex('commit;')
    gate = sql.split('DO $external_review_gate$', 1)[1].split('$external_review_gate$;', 1)[0]
    assert 'raise exception' in gate and 'if ' not in gate.lower(), 'External review gate must be unconditional'
    assert 'grant execute' not in re.sub(r'--[^\n]*', '', sql).lower()
    assert sql.count("volatile security definer set search_path = ''") == 2
    print('Static source checks passed; 9 boundary mutations rejected. No SQL executed.')


if __name__ == '__main__':
    main()
