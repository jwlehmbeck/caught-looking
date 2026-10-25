pgTAP tests. Run with `npm run test:db` while the local stack is up.

Every table gets at least one test proving a forbidden action is rejected.
Each file is wrapped in `begin; ... rollback;` so tests never leave data behind.
