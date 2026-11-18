# Stage 1 permissions and invariants

Every business route requires a current session and verified email. Workspace operations check active membership directly in PostgreSQL. Unrelated workspaces return 404. No browser role is authoritative.

| Action | OWNER | ADMIN | MEMBER | VIEWER |
| --- | --- | --- | --- | --- |
| Read own workspace/member list | Yes | Yes | Yes | Yes |
| Invite MEMBER/VIEWER, manage links, approve joins | Yes | Yes | No | No |
| Invite/promote ADMIN | Yes | No | No | No |
| Change/remove MEMBER/VIEWER | Yes | Yes | No | No |
| Change/remove ADMIN | Yes | No | No | No |
| Direct change/removal of OWNER | No | No | No | No |
| Explicit ownership transfer | Yes | No | No | No |

Transfer promotes a verified active target and demotes the old owner to ADMIN atomically. Workspace locks serialize transfer, role changes, removal and invitation/link acceptance.

Invitations store a SHA-256 hash of a 256-bit random token and bind acceptance to the normalized verified email. Repeated acceptance returns existing membership; removal prevents reuse. Resend rotates tokens and cancels queued mail. Already-in-flight delivery may still arrive after revocation, but the token is rejected.

Join links grant only MEMBER. Expiry, revocation, limits and approval are server-side. Unique link/user requests prevent repeat consumption. Approval rechecks capacity, expiry and user verification.

Removal preserves audit history and denies subsequent REST access. UI revalidates periodically and on focus. No sockets exist yet; socket eviction belongs to Stage 3.

Cookies are library-managed and HTTP-only; production requires HTTPS and secure cookies. Mutations require exact APP_ORIGIN. Process-local throttles must become shared and be tested before claiming horizontal scaling.
