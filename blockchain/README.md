# blockchain/

The tamper-evident integrity layer is implemented in the backend, not here:
`backend/src/services/blockchain/auditChain.js`.

- Every SOS, zone violation, risk escalation and incident open/resolve is hashed
  (SHA-256 over the event's *immutable* fields) and stored as an `AuditProof`
  linked to the previous proof (`chainHash = sha256(prev | seq | type | dataHash)`).
- `GET /api/blockchain` lists proofs, `GET /api/blockchain/verify/:proofId`
  re-hashes the live record and compares, `GET /api/blockchain/verify-chain`
  walks the whole chain. All are admin-only. The admin UI is `/admin/blockchain`
  plus a per-incident "Audit proofs" panel on `/admin/incidents`.
- MongoDB stays the system of record; only hashes and ids are chained.
- Assumes a single backend instance (writes are serialised in-process).

Still optional / not built: anchoring batches of hashes to a public testnet
(see `docs/PHASE0_PLAN.md` section 10).
