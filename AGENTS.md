# Project Guidelines

## Application

- Build the application with Astro.
- Keep the initial architecture small and prefer Astro's built-in capabilities.
- Add dependencies only when they are required by an implemented feature.

## Testing and Infrastructure

- Do not add test harnesses, test frameworks, fixture suites, end-to-end test setups, mock servers, or permanent test files.
- Temporary development checks are allowed only to confirm that current work functions. Remove their files, scripts, configuration, and dependencies before finalizing the work.
- Use the production build as the normal persistent verification command.
- Do not add infrastructure such as CI/CD workflows, containers, deployment configuration, infrastructure as code, environment provisioning, monitoring, or observability systems.

## Code Style

- Write comments only when they explain necessary context that the code cannot express clearly.
- Keep comments brief and avoid narrating straightforward code.
- Prefer simple, readable implementations over premature abstractions.
- Preserve accessibility and semantic HTML in user-facing pages.

## Commands

- `npm run dev`: start the local Astro development server.
- `npm run build`: create and verify the production build.
- `npm run preview`: preview the production build locally.
