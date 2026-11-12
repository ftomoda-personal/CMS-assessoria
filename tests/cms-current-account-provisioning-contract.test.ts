import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STAGING_CURRENT_ACCOUNT_IDENTITY_SQL } from '../server/cms/administrativePgConnector.ts';

const sql = readFileSync(new URL('../server/cms/sql/provision-current-account.sql', import.meta.url), 'utf8');

test('staging exception is limited to the two reviewed, inaccessible extension views', () => {
  const guard = sql.split("if pg_catalog.has_any_column_privilege(rid,t.oid,'SELECT') then")[1];
  assert.ok(guard);
  assert.match(guard, /staging_profile and t\.nspname = 'extensions'/);
  assert.match(guard, /t\.relname in \('pg_stat_statements', 'pg_stat_statements_info'\)/);
  assert.match(guard, /t\.relkind = 'v' and t\.relowner = 'postgres'::pg_catalog\.regrole/);
  assert.match(guard, /and not pg_catalog\.has_schema_privilege\(rid,t\.schema_id,'USAGE'\)/);
  assert.match(guard, /and pg_catalog\.has_table_privilege\(rid,t\.oid,'SELECT'\)/);
  assert.match(guard, /and not pg_catalog\.has_any_column_privilege\(rid,t\.oid,'SELECT WITH GRANT OPTION'\)/);
  assert.match(guard, /a\.grantee = 0 and a\.privilege_type = 'SELECT' and not a\.is_grantable/);
  assert.match(guard, /d\.objid = t\.oid[\s\S]*d\.refclassid = 'pg_catalog\.pg_extension'::pg_catalog\.regclass[\s\S]*d\.deptype = 'e'\s+and e\.extname = 'pg_stat_statements'/);
  assert.match(guard, /raise exception 'Unexpected effective relation access'/);
  assert.match(sql, /has_table_privilege\(rid,t\.oid,'MAINTAIN'\)/);
  assert.match(sql, /has_table_privilege\(rid,t\.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/);
  assert.match(sql, /has_any_column_privilege\(rid,t\.oid,'INSERT,UPDATE,REFERENCES'\)/);
  assert.match(sql, /has_sequence_privilege\(rid,t\.oid,'USAGE,SELECT,UPDATE'\)/);
  assert.match(sql, /has_schema_privilege\(rid,f\.schema_id,'USAGE'\) and pg_catalog\.has_function_privilege\(rid,f\.oid,'EXECUTE'\)/);
});

test('SQL gate and connector inspect both membership directions and grantor', () => {
  assert.match(sql, /staging_ref is not null and staging_ref <> 'uhgeboelkbygidmhlugh'/);
  assert.match(sql, /runtime_id in \(m\.member, m\.roleid, m\.grantor\)/);
  assert.match(sql, /m\.roleid = runtime_id and m\.member = 'postgres'::pg_catalog\.regrole\s+and m\.grantor = 10::pg_catalog\.oid and m\.admin_option and not m\.inherit_option and not m\.set_option/);
  assert.match(sql, /staging_ref is null and membership_count <> 0/);
  assert.match(sql, /staging_ref is not null and \(membership_count <> 1 or approved_count <> 1\)/);
  assert.match(STAGING_CURRENT_ACCOUNT_IDENTITY_SQL, /r\.oid IN \(m\.member, m\.roleid, m\.grantor\)/);
  assert.match(STAGING_CURRENT_ACCOUNT_IDENTITY_SQL, /m\.roleid = r\.oid, m\.member = 'postgres'::pg_catalog\.regrole, m\.grantor::pg_catalog\.int8,\s+m\.admin_option, m\.inherit_option, m\.set_option/);
});
