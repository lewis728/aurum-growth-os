#!/usr/bin/env python3
"""
Stage 04 Acceptance Test: queueAppointmentReminders idempotency
Tests that the @@unique constraint on ScheduledReminder[appointmentId, messageType]
correctly prevents duplicate rows (simulating skipDuplicates: true).
"""
import subprocess
import json
import sys
import re
import glob
import os
import time

PROJECT_ID = "zugbafsnhwntpzwdkqvd"
MCP_RESULTS_DIR = os.path.expanduser("~/.mcp/tool-results")

def run_sql(query: str) -> tuple:
    """Execute SQL via Supabase MCP. Returns (rows, error_message)."""
    result = subprocess.run(
        ["manus-mcp-cli", "tool", "call", "execute_sql", "--server", "supabase",
         "--input", json.dumps({"project_id": PROJECT_ID, "query": query})],
        capture_output=True, text=True, timeout=30
    )
    output = result.stdout + result.stderr

    # Find the most recently written tool result file
    pattern = os.path.join(MCP_RESULTS_DIR, "*supabase_execute_sql*")
    files = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)

    if files:
        try:
            with open(files[0]) as f:
                content = f.read()
            # Try to parse as JSON
            try:
                data = json.loads(content)
                result_str = data.get("result", "")
            except json.JSONDecodeError:
                result_str = content

            # Check for error
            if '"error"' in result_str or 'Error:' in result_str:
                err_match = re.search(r'"message":"(.*?)(?:"[,}])', result_str, re.DOTALL)
                if err_match:
                    return [], err_match.group(1)[:200]
                return [], f"SQL error: {result_str[:200]}"

            # Extract JSON array from result string
            arr_match = re.search(r'\[.*?\]', result_str, re.DOTALL)
            if arr_match:
                try:
                    return json.loads(arr_match.group(0)), None
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            pass

    # Fallback: parse stdout directly
    if '"error"' in output:
        err_match = re.search(r'"message":"(.*?)(?:"[,}])', output, re.DOTALL)
        if err_match:
            return [], err_match.group(1)[:200]
        return [], "Unknown SQL error"

    arr_match = re.search(r'\[.*?\]', output, re.DOTALL)
    if arr_match:
        try:
            return json.loads(arr_match.group(0)), None
        except json.JSONDecodeError:
            pass

    return [], None

def sql_ok(query: str, label: str = "") -> list:
    rows, err = run_sql(query)
    if err:
        print(f"  [SQL error{' in ' + label if label else ''}]: {err}")
    return rows

def count_reminders() -> int:
    rows, _ = run_sql("SELECT COUNT(*) as count FROM \"ScheduledReminder\" WHERE \"appointmentId\" = 'test-appt-stage04'")
    return int(rows[0]["count"]) if rows else 0

def main():
    print("=== Stage 04 Acceptance Test: queueAppointmentReminders Idempotency ===\n")

    # ── Step 1: Force-clean all test data ────────────────────────────────────
    print("Step 1: Force-cleaning test data...")
    sql_ok("DELETE FROM \"ScheduledReminder\" WHERE \"appointmentId\" = 'test-appt-stage04'")
    sql_ok("DELETE FROM \"Appointment\" WHERE id = 'test-appt-stage04'")
    sql_ok("DELETE FROM \"Lead\" WHERE id = 'test-lead-stage04'")
    sql_ok("DELETE FROM \"CampaignBlueprint\" WHERE id = 'test-bp-stage04'")
    sql_ok("DELETE FROM \"CommandLog\" WHERE id IN ('test-log-01', 'test-log-02')")
    print("  Done.\n")

    # ── Step 2: Insert CampaignBlueprint ─────────────────────────────────────
    print("Step 2: Inserting test CampaignBlueprint...")
    sql_ok("""
        INSERT INTO "CampaignBlueprint" (
            id, "tenantId", status, vertical, "businessName",
            "targetLocation", "dailyBudgetUsd",
            creative, "mediaBuying", deployment, voice, crm,
            "orchestrationLog", "createdAt", "updatedAt"
        ) VALUES (
            'test-bp-stage04', 'org_test_tenant', 'ACTIVE',
            'aesthetics.anti_wrinkle_filler', 'Test Clinic',
            'London', 20.0,
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
            '[]'::jsonb, NOW(), NOW()
        )
    """, "BP insert")
    # Verify
    rows, _ = run_sql("SELECT id FROM \"CampaignBlueprint\" WHERE id = 'test-bp-stage04'")
    if not rows:
        print("FAIL: CampaignBlueprint not found after insert")
        sys.exit(1)
    print(f"  Verified: {rows}\n")

    # ── Step 3: Insert Lead ───────────────────────────────────────────────────
    print("Step 3: Inserting test Lead...")
    sql_ok("""
        INSERT INTO "Lead" (
            id, "blueprintId", "tenantId", "firstName", "lastName",
            phone, status, "createdAt", "updatedAt"
        ) VALUES (
            'test-lead-stage04', 'test-bp-stage04', 'org_test_tenant',
            'Test', 'User', '+447700900000', 'new', NOW(), NOW()
        )
    """, "Lead insert")
    rows, _ = run_sql("SELECT id FROM \"Lead\" WHERE id = 'test-lead-stage04'")
    if not rows:
        print("FAIL: Lead not found after insert")
        sys.exit(1)
    print(f"  Verified: {rows}\n")

    # ── Step 4: Insert Appointment ────────────────────────────────────────────
    print("Step 4: Inserting test Appointment (48h in future)...")
    sql_ok("""
        INSERT INTO "Appointment" (
            id, "blueprintId", "leadId", "tenantId",
            "scheduledAt", confirmed, "createdAt", "updatedAt"
        ) VALUES (
            'test-appt-stage04', 'test-bp-stage04', 'test-lead-stage04',
            'org_test_tenant',
            NOW() + INTERVAL '48 hours', false, NOW(), NOW()
        )
    """, "Appt insert")
    rows, _ = run_sql("SELECT id FROM \"Appointment\" WHERE id = 'test-appt-stage04'")
    if not rows:
        print("FAIL: Appointment not found after insert")
        sys.exit(1)
    print(f"  Verified: {rows}\n")

    # ── Step 5: First call — insert 3 reminder rows ───────────────────────────
    print("Step 5: First call — inserting 3 ScheduledReminder rows...")
    _, err = run_sql("""
        INSERT INTO "ScheduledReminder" (
            id, "appointmentId", "tenantId", "messageType", "messageBody",
            "toNumber", "sendAt", status, attempts, "createdAt"
        ) VALUES
        (
            'test-rem-conf', 'test-appt-stage04', 'org_test_tenant',
            'confirmation',
            'Hi Test User, your consultation has been confirmed.',
            '+447700900000', NOW(), 'pending', 0, NOW()
        ),
        (
            'test-rem-day', 'test-appt-stage04', 'org_test_tenant',
            'day_before',
            'Hi Test User, your consultation is tomorrow.',
            '+447700900000', NOW() + INTERVAL '24 hours', 'pending', 0, NOW()
        ),
        (
            'test-rem-hour', 'test-appt-stage04', 'org_test_tenant',
            'hour_before',
            'Hi Test User, your consultation is in 1 hour.',
            '+447700900000', NOW() + INTERVAL '47 hours', 'pending', 0, NOW()
        )
        ON CONFLICT ("appointmentId", "messageType") DO NOTHING
    """)
    if err:
        print(f"FAIL on first insert: {err}")
        sys.exit(1)

    count1 = count_reminders()
    print(f"  Rows after first call: {count1}")
    if count1 != 3:
        print(f"FAIL: Expected 3 rows, got {count1}")
        sys.exit(1)
    print("  ✅ PASS: 3 rows inserted on first call\n")

    # ── Step 6: Second call — should insert 0 new rows ───────────────────────
    print("Step 6: Second call — should insert 0 new rows (skipDuplicates)...")
    _, err = run_sql("""
        INSERT INTO "ScheduledReminder" (
            id, "appointmentId", "tenantId", "messageType", "messageBody",
            "toNumber", "sendAt", status, attempts, "createdAt"
        ) VALUES
        (
            'test-rem-conf-2', 'test-appt-stage04', 'org_test_tenant',
            'confirmation',
            'Hi Test User, your consultation has been confirmed.',
            '+447700900000', NOW(), 'pending', 0, NOW()
        ),
        (
            'test-rem-day-2', 'test-appt-stage04', 'org_test_tenant',
            'day_before',
            'Hi Test User, your consultation is tomorrow.',
            '+447700900000', NOW() + INTERVAL '24 hours', 'pending', 0, NOW()
        ),
        (
            'test-rem-hour-2', 'test-appt-stage04', 'org_test_tenant',
            'hour_before',
            'Hi Test User, your consultation is in 1 hour.',
            '+447700900000', NOW() + INTERVAL '47 hours', 'pending', 0, NOW()
        )
        ON CONFLICT ("appointmentId", "messageType") DO NOTHING
    """)
    if err:
        print(f"FAIL on second insert: {err}")
        sys.exit(1)

    count2 = count_reminders()
    print(f"  Rows after second call: {count2}")
    if count2 != 3:
        print(f"FAIL: Expected still 3 rows after second call, got {count2}")
        sys.exit(1)
    print("  ✅ PASS: 0 new rows inserted on second call (@@unique + ON CONFLICT DO NOTHING)\n")

    # ── Step 7: Verify row content ────────────────────────────────────────────
    print("Step 7: Verifying row content...")
    rows3, _ = run_sql("""
        SELECT "messageType", "toNumber", status
        FROM "ScheduledReminder"
        WHERE "appointmentId" = 'test-appt-stage04'
        ORDER BY "messageType"
    """)
    for row in rows3:
        print(f"  {row['messageType']:12s} | {row['toNumber']} | {row['status']}")
    print()

    # ── Cleanup ───────────────────────────────────────────────────────────────
    print("Step 8: Cleaning up test data...")
    sql_ok("DELETE FROM \"ScheduledReminder\" WHERE \"appointmentId\" = 'test-appt-stage04'")
    sql_ok("DELETE FROM \"Appointment\" WHERE id = 'test-appt-stage04'")
    sql_ok("DELETE FROM \"Lead\" WHERE id = 'test-lead-stage04'")
    sql_ok("DELETE FROM \"CampaignBlueprint\" WHERE id = 'test-bp-stage04'")
    sql_ok("DELETE FROM \"CommandLog\" WHERE id IN ('test-log-01', 'test-log-02')")
    print("  Cleaned.\n")

    print("=" * 65)
    print("✅ Stage 04 Idempotency Test: ALL PASSED")
    print("  - 3 rows inserted on first call (confirmation + day_before + hour_before)")
    print("  - 0 rows inserted on second call (@@unique + ON CONFLICT DO NOTHING)")
    print("=" * 65)

if __name__ == "__main__":
    main()
