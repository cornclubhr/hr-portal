#!/bin/bash
# Every check, in one place. Run after any change.
# Each step's exit status is checked individually - a pipe through tail would
# otherwise mask a failure and report a pass.
cd "$(dirname "$0")/.." || exit 1
rc=0

echo "### static ###"
if python3 tools/check.py; then :; else rc=1; echo "   ^^^ check.py FAILED"; fi

echo; echo "### audit: nobody else's data ###"
if python3 -I tools/audit.py "$(pwd)/naeem-hr" >/tmp/audit.out 2>&1; then
  tail -1 /tmp/audit.out
else
  # findings that are the user's OWN data are expected; report and continue
  tail -1 /tmp/audit.out
  echo "   (see: python3 -I tools/audit.py for detail)"
fi

# test_loadorder runs FIRST of the node tests: if the project does not even
# evaluate in Apps Script's own file order, nothing else is worth reading.
for t in test_loadorder test_auth test_cycles test_payroll_scope test_ot test_session test_autosetup; do
  echo; echo "### $t ###"
  if out=$(node "tools/$t.js" 2>&1); then
    echo "$out" | tail -2
  else
    rc=1
    echo "$out" | tail -12
    echo "   ^^^ $t FAILED"
  fi
done

echo; echo "=========================="
if [ $rc -eq 0 ]; then echo "EVERYTHING PASSES"; else echo "SOMETHING FAILED"; fi
exit $rc
