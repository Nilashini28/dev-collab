# DevCollab visual system

Reference: https://www.tasteskill.dev/ (observed 22 October 2026). The reference uses Geist, a warm #f5f4f2 paper canvas, #0a0a0a ink, 14px navigation, an 88px/600 desktop headline and rounded monochrome controls. DevCollab adapts those proportions to its longer headline and dense application surfaces rather than copying the reference's brand or marketing assets.

Shared tokens live in apps/web/src/taste-theme.css. Primary surfaces are paper, white, warm gray and near-black; muted olive and sand are reserved for illustrative depth, with semantic error/success colors retained. All application pages use self-hosted Geist. Primary controls are black/white pills, inputs have restrained 11px corners, cards use thin warm-gray borders and 16–22px corners. Headings scale from 29px on mobile dashboards to 78px on the landing page. The new vector code-bracket mark is shared by navigation, the workspace preview and favicon.

The marketing hero contains an interactive layered workspace illustration. Gather, Connect and Create switch its sample task content; the illustration is explicitly labeled a preview. GSAP drives pointer depth, entrances and scroll reveals. Shared PageMotion animates route/tab navigation only, not query refreshes or chat messages. Workspace card interactions use existing restrained depth and hover motion. Reduced motion disables page transitions, tilt, marquees, pinning and animated sculpture effects. Responsive navigation preserves access to all project tabs.

Implementation: main.tsx imports Geist and the shared theme; components.tsx defines the new mark; Landing.tsx contains the product illustration; PageMotion.tsx handles shared route motion; styles.css legacy violet declarations are neutralized; taste-theme.css applies the consistent tokens to auth, chooser, workspace, membership, project board, sprint, chat, notifications, GitHub, resources, assistant, wiki, modals and drawers. No backend behavior or authorization was changed.

The font is distributed via @fontsource/geist, with the package's included license. DevCollab branding and illustrations are original code-native assets. No imagery or brand marks from the reference site were copied.


Verification: `npm run build` passed TypeScript and the production bundle (existing Mermaid chunk-size warnings remain). `npm run test:browser` passed all 14 real-session regression flows with no uncaught errors, including Geist/paper-palette assertions, the interactive landing preview, consistent workspace styling, invitations, board, sprints, chat, Contributions, assistant/wiki, mobile overflow and reduced motion. Desktop landing/auth/team/dashboard/board and mobile landing screenshots were visually reviewed. No lint command is configured. Backend tests were not rerun for this presentation-only change.

Final screenshot review also corrected dark feature-card paragraph contrast and placed preview controls below the card stack.


## Chat and team-card refinement

Chat metadata now sits outside the colored bubble, removing the old square message-container backgrounds. Incoming messages use warm white with a soft sage border; outgoing messages use forest #344f42 with #f9fcf6 text. Calculated text contrast is 8.66:1 for outgoing messages, 11.31:1 for incoming messages and 4.53:1 for timestamps. The composer and conversation list use the same restrained sage palette.

The Meet your team card replaces the low-contrast wireframe with the original TeamSculpture component: layered vector team tiles, extruded edges, dimensional shadows and a gentle CSS float. The sculpture remains visible on mobile and uses a static 3D pose for reduced motion. No AI image service, external photo or provider configuration is required.

Files: apps/web/src/components.tsx, pages/Workspace.tsx, taste-theme.css. Chat behavior and team membership actions are unchanged.

Chat and team-card refinement was visually reviewed in the refreshed chat and workspace screenshots. TypeScript/production build passed; existing Mermaid bundle-size warnings remain.

Final chat/team-card verification: all 14 browser flows passed, with no uncaught errors or mobile horizontal overflow.
