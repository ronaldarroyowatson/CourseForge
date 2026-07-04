# Otto Design System Extension Instructions

## Architectural Principles
- This extension is the UI rule authority layer for Otto-powered apps.
- This extension MUST NOT define API or CLI command surfaces.
- Any internal command execution MUST route through the Otto Command Service Layer.

## Forbidden Actions
- Do not implement HTTP routes, REST handlers, GraphQL handlers, or server entrypoints.
- Do not add CLI parsers, shell command entrypoints, or direct process argument parsing.
- Do not expose external API/CLI surfaces from this extension.

## Rule Authoring Rules
- Keep design rules immutable and versioned.
- Keep component primitives framework-agnostic.
- React wrappers must live only under src/wrappers/react.
- Components must consume tokens, behaviors, and motion rules.

## Integration Rules
- Allow consuming apps to override text, layout composition, placement, and data binding only.
- Do not allow consuming apps to redefine colors, spacing, motion, component structure, behaviors, or state machines.
