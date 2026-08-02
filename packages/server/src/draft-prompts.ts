const STACK_RULES = `
You are editing an existing Draftly source project in the current working directory.
The project uses Vite, React, TypeScript, Tailwind CSS v4 and shadcn/ui.
Work directly in the source files. Do not return HTML or paste source code in your final response.
Use the existing dependencies and shadcn components before adding packages or building custom primitives.
Compose complete shadcn structures: Card uses Header/Content/Footer, form controls use Field/FieldGroup,
Select items stay in SelectGroup, and every Dialog/Sheet includes an accessible title.
Use semantic Tailwind tokens rather than one-off colors. Keep className focused on layout and composition;
do not override component colors when a built-in variant exists.
Split substantial interfaces into focused React components. Keep server state, event effects, and rendering
responsibilities separate; use stable keys and never mutate React state.
Build semantic, responsive HTML. Use CSS Grid for major layouts, min-h-dvh for viewport sections, meaningful
alt text, visible focus states, keyboard interaction, and a skip link for page-scale interfaces.
Include intentional loading, empty, error, disabled, hover, active, and focus-visible states wherever relevant.
Use motion to clarify state changes: animate transform and opacity only, keep transitions between 150–300ms,
and honor prefers-reduced-motion. Do not add an animation dependency unless the project already has one.
Avoid generic AI layouts: no purple-blue gradients, no default three-equal-card rows, no everything-centered
composition, no repeated pill badges, no placeholder copy, and no decorative card around every section.
Use realistic, specific copy in the user's language. Keep body text near 65 characters wide and balance headings.
Do not remove the Draftly inspect bridge from src/main.tsx or the locator integration from vite.config.ts.
Run npm run build before finishing. Fix every error you introduce.
Your final response must briefly summarize the files changed.
`.trim();

export function buildGenerateInstruction({
  userPrompt,
  designMd = null,
  variant = 1,
}: {
  userPrompt: string;
  designMd?: string | null;
  variant?: number;
}): string {
  return [
    STACK_RULES,
    `Create a complete interface for this request:\n${userPrompt}`,
    `This is design variant ${variant}. Choose one coherent visual concept and make its layout, type scale,
surface treatment, and interaction model meaningfully distinct from a generic starter.`,
    designMd
      ? 'A DESIGN.md file is present. Treat it as the binding visual design contract.'
      : 'Establish a coherent visual system in src/index.css and the React components.',
    'Replace the starter experience with the finished product. Deliver the complete primary flow, not a hero-only mockup.',
  ].join('\n\n');
}

export function buildIterateInstruction({ instruction }: { instruction: string }): string {
  return [
    STACK_RULES,
    'Inspect the current application before editing it.',
    `Implement this user request:\n${instruction}`,
    'Preserve unrelated behavior and the established design tokens. Reuse existing product components.',
  ].join('\n\n');
}

export function buildSourceEditInstruction({
  instruction,
  context,
  count = 1,
  annotations,
}: {
  instruction: string;
  context: string;
  count?: number;
  annotations?: { context: string; comment: string; styleEdits?: Record<string, string> }[];
}): string {
  if (annotations && annotations.length) {
    const blocks = annotations
      .map((item, index) => {
        const lines = [`Element ${index + 1}:`, item.context];
        if (item.styleEdits && Object.keys(item.styleEdits).length) {
          const preview = Object.entries(item.styleEdits)
            .map(([prop, value]) => `${prop}: ${value}`)
            .join('; ');
          lines.push(
            `The user already previewed these inline styles on this element: ${preview}. Treat them as the intended visual result, but implement them the idiomatic way for this project (prefer semantic Tailwind classes / design tokens over literal inline styles).`,
          );
        }
        lines.push(`Requested change: ${item.comment}`);
        return lines.join('\n');
      })
      .join('\n\n');
    return [
      STACK_RULES,
      `The user annotated ${annotations.length} rendered element(s). Treat each numbered element independently and apply only the change described for it.`,
      'Do not restyle, move, or otherwise modify any element that is not listed below. Keep every unannotated part of the page exactly as it is.',
      blocks,
      instruction?.trim()
        ? `Additional overall guidance (applies only where an element has no specific requested change):\n${instruction}`
        : null,
      'For each element, locate the actual component in the project and make the smallest complete source change. Preserve accessibility and all component states.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  const multiple = count > 1;
  return [
    STACK_RULES,
    multiple
      ? `The user selected ${count} rendered elements that map to the following source contexts:`
      : 'The user selected a rendered element that maps to the following source context:',
    context,
    multiple
      ? `Implement this goal for all of the selected elements:\n${instruction}`
      : `Implement this goal for the selected element:\n${instruction}`,
    'Locate the actual component(s) in the project and make the smallest complete source change. Preserve accessibility and all component states.',
  ].join('\n\n');
}

export function buildImageEditInstruction({ instruction }: { instruction: string }): string {
  return [
    STACK_RULES,
    'A reference screenshot is attached to this task.',
    `Modify the current application to achieve this goal:\n${instruction}`,
    'Use the screenshot as visual evidence while preserving unrelated functionality. Match hierarchy and spacing without replacing working shadcn primitives with static markup.',
  ].join('\n\n');
}
